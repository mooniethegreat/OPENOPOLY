import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Banknote, Box, Car, Compass, House, Landmark, Lightbulb, LockKeyhole, Maximize2, Minus, Navigation, Plus, RotateCcw, RotateCw, Shield, TrainFront, Waves } from 'lucide-react';
import { getBoard } from '../shared/board.js';
import { useGame } from './game-context.jsx';
import { displayToken, money, spaceName } from './themes.js';
import { usePresentation } from './presentation.jsx';
import { boardPoint } from './presentation-state.js';
import { dicePose } from './dice-geometry.js';
import { billboardOffset, boardHeading, DEFAULT_BOARD_YAW, fitBoardWindow, keepBoardFocusVisible, nearestBoardNorth, projectBoardPoint, projectedBoardBounds } from './board-camera.js';
import './board-scene.css';
import MeshToken from './MeshToken.jsx';

export const TOKEN_OPTIONS = [
  { id: 'hat', name: 'Top hat', x: 117, y: 855, w: 40, h: 43 },
  { id: 'car', name: 'Race car', x: 178, y: 852, w: 60, h: 49 },
  { id: 'dog', name: 'Scottie dog', x: 166, y: 779, w: 54, h: 53 },
  { id: 'ship', name: 'Battleship', x: 245, y: 854, w: 49, h: 43 },
  { id: 'cat', name: 'Cat', x: 60, y: 846, w: 46, h: 58 },
  { id: 'penguin', name: 'Penguin', x: 62, y: 774, w: 34, h: 62 },
  { id: 'thimble', name: 'Thimble', x: 248, y: 791, w: 29, h: 42 },
  { id: 'duck', name: 'Rubber duck', x: 112, y: 786, w: 43, h: 49 },
];
const ALIASES = { topHat: 'hat', 'top-hat': 'hat', racecar: 'car', raceCar: 'car', battleship: 'ship', scottie: 'dog', rubberDuck: 'duck', 'rubber-duck': 'duck' };
const clamp = (number, low, high) => Math.min(high, Math.max(low, number));
const compactQuery = '(max-width:600px), (max-width:1000px) and (max-height:500px) and (pointer:coarse)';
let labelMeasure;
function boardLabel(name, side) {
  const text = name.replace(/\bAvenue\b/g, 'Ave.').replace(/\bRailroad\b/g, 'R.R.').replace(/\bPlace\b/g, 'Pl.').replace(/\bCompany\b/g, 'Co.')
    .replace(/\bCommunity\b/g, 'Comm.').replace(/\bService\b/g, 'Svc.').replace(/\bStation\b/g, 'Stn.').replace(/\bOriginal\b/g, 'Orig.').replace(/\bAmphitheatre\b/g, 'Amph.').replace(/\bMountains\b/g, 'Mtns.')
    .replace(/Mediterranean/g, 'Mediter\u00adranean').replace(/Connecticut/g, 'Connec\u00adticut').replace(/Pennsylvania/g, 'Pennsyl\u00advania').replace(/Cucamonga/g, 'Cuca\u00admonga').replace(/Contingency/g, 'Contin\u00adgency').replace(/California/g, 'Cali\u00adfornia').replace(/Riverside/g, 'River\u00adside').replace(/Bernardino/g, 'Bernar\u00addino').replace(/Arrowhead/g, 'Arrow\u00adhead');
  const lateral = side === 'left' || side === 'right';
  const base = lateral ? 16 : 18;
  if (typeof document === 'undefined') return { text, size: base };
  labelMeasure ||= document.createElement('canvas').getContext('2d');
  if (!labelMeasure) return { text, size: base };
  labelMeasure.font = `750 ${base}px 'DM Sans', Arial`;
  return { text, size: base, spaceWidth: labelMeasure.measureText(' ').width, hyphenWidth: labelMeasure.measureText('-').width, words: text.split(/\s+/).map(word => ({ width: labelMeasure.measureText(word.replace(/\u00ad/g, '')).width, parts: word.split('\u00ad').map(part => labelMeasure.measureText(part).width) })) };
}

function labelLayout(label, side, tilt, yaw) {
  const lateral = side === 'left' || side === 'right';
  const w = lateral ? 94 : 70, h = lateral ? 54 : 65;
  const angle = yaw * Math.PI / 180, pitch = tilt * Math.PI / 180;
  const width = Math.min(lateral ? 91 : 65, Math.abs(w * Math.cos(angle)) + Math.abs(h * Math.sin(angle))) - 2;
  const height = (Math.abs(w * Math.sin(angle)) + Math.abs(h * Math.cos(angle))) * Math.cos(pitch) - 2;
  if (!label.words) return { width, size: label.size };
  // Font measurements are cached per board/font. Rotation only fits these numeric widths.
  const linesAt = size => {
    const ratio = size / label.size, space = label.spaceWidth * ratio, hyphen = label.hyphenWidth * ratio;
    let lines = 1, used = 0;
    for (const word of label.words) {
      const full = word.width * ratio;
      if (full <= width) {
        if (used && used + space + full > width) { lines++; used = 0; }
        used += (used ? space : 0) + full;
      } else {
        if (used) { lines++; used = 0; }
        for (let index = 0; index < word.parts.length; index++) {
          const part = word.parts[index] * ratio, last = index === word.parts.length - 1;
          if (part + (last ? 0 : hyphen) > width) return Infinity;
          used = part;
          if (!last) { lines++; used = 0; }
        }
      }
    }
    return lines;
  };
  let size = label.size;
  while (size > 10 && linesAt(size) * size * 1.05 > height) size -= .25;
  return { width, size };
}

export function Token({ token = 'hat', size = 38, className = '', material = 'silver', finish, tilt = 58, yaw = -24, fallback = false }) {
  const id = displayToken(token);
  const data = TOKEN_OPTIONS.find(item => item.id === (ALIASES[id] || id)) || TOKEN_OPTIONS[0];
  if (!fallback) return <MeshToken token={data.id} size={size} className={className} material={material} finish={finish} tilt={tilt} yaw={yaw} label={data.name} />;
  const scale = size / Math.max(data.w, data.h);
  return <span className={`token-photo ${className}`} role="img" aria-label={data.name} style={{ width: size, height: size }}><span style={{ width: data.w * scale, height: data.h * scale, backgroundSize: `${1000 * scale}px ${1000 * scale}px`, backgroundPosition: `${-data.x * scale}px ${-data.y * scale}px` }} /></span>;
}

const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };

// A server timestamp drives the six physical faces; there is no cosmetic looping roll.
export function Dice({ value = 1, rolling = false, progress = 0, index = 0, className = '', grounded = false, size = 56 }) {
  const number = PIPS[value] ? value : 1;
  const pose = dicePose({ value: number, rolling, progress, index, size });
  const rotation = `translateZ(${grounded ? pose.height : 0}px) rotateZ(${pose.z}deg) rotateX(${pose.x}deg) rotateY(${pose.y}deg)`;
  return <span className={`physical-die ${rolling ? 'is-tumbling' : ''} ${grounded ? 'is-grounded' : ''} ${className}`} style={{ '--die-size': `${size}px` }} role="img" aria-label={rolling ? 'Dice rolling' : `Die: ${number}`} data-value={rolling ? undefined : number} data-ground-height={grounded ? pose.height : undefined}><span className="physical-die-cube" style={{ transform: rotation }}>{[1, 2, 3, 4, 5, 6].map(face => <span key={face} className={`physical-die-face die-face-${face}`} aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} className={PIPS[face].includes(i + 1) ? 'die-pip is-visible' : 'die-pip'} />)}</span>)}</span></span>;
}

export function SpaceIcon({ type, size = 22, className = '' }) {
  const props = { size, strokeWidth: 1.8, className };
  if (type === 'railroad') return <TrainFront {...props} />;
  if (type === 'utility') return <Lightbulb {...props} />;
  if (type === 'chest') return <Box {...props} />;
  if (type === 'chance') return <span className={`chance-mark ${className}`}>?</span>;
  if (type === 'tax') return <Banknote {...props} />;
  return null;
}

function tilePlacement(index) {
  if (index <= 10) return { gridColumn: 11 - index, gridRow: 11, side: 'bottom' };
  if (index <= 20) return { gridColumn: 1, gridRow: 21 - index, side: 'left' };
  if (index <= 30) return { gridColumn: index - 19, gridRow: 1, side: 'top' };
  return { gridColumn: 11, gridRow: index - 29, side: 'right' };
}

function Corner({ space, inland }) {
  if (space.type === 'go') return <><span className="scene-corner-kicker">COLLECT $200</span><b className="scene-go">{inland ? 'GO IE' : 'GO'}</b><ArrowRight className="scene-corner-icon" /><small>AS YOU PASS</small></>;
  if (space.type === 'jail') return <><LockKeyhole className="scene-corner-icon" /><b>{inland ? 'TRAFFIC JAM' : 'IN JAIL'}</b><small>{inland ? 'DETOUR' : 'JUST VISITING'}</small></>;
  if (space.type === 'freeParking') return <><Car className="scene-corner-icon" /><b>{inland ? 'I ♥ INLAND EMPIRE' : 'FREE PARKING'}</b><small>{inland ? 'COLLECT CENTER POT' : 'TAKE A BREAK'}</small></>;
  return <><Shield className="scene-corner-icon" /><b>{inland ? 'GO TO TRAFFIC JAM' : 'GO TO JAIL'}</b><small>DO NOT PASS GO</small></>;
}

function Building({ hotel = false, style = {} }) {
  return <span className={`scene-building ${hotel ? 'is-hotel' : ''}`} style={style} aria-hidden="true"><i className="building-front" /><i className="building-back" /><i className="building-side" /><i className="building-other-side" /><i className="building-roof" />{hotel && <i className="building-sign">H</i>}</span>;
}

const CITY = [
  { x: 247, y: 264, w: 76, d: 62, h: 54, color: '#c0ae89', kind: 'civic', cap: 'pediment' },
  { x: 344, y: 232, w: 58, d: 62, h: 91, color: '#b8a57e', kind: 'deco', upper: 30, cap: 'spire' },
  { x: 421, y: 259, w: 74, d: 56, h: 66, color: '#cdbf9e', kind: 'mansard', cap: 'mansard' },
  { x: 512, y: 232, w: 55, d: 64, h: 101, color: '#77908a', kind: 'glass', upper: 31, cap: 'lantern' },
  { x: 586, y: 276, w: 59, d: 48, h: 61, color: '#c1a478', kind: 'clock', upper: 24, cap: 'pyramid' },
  { x: 665, y: 265, w: 44, d: 60, h: 78, color: '#8d9b91', kind: 'hotel', cap: 'mansard' },
  { x: 277, y: 361, w: 74, d: 43, h: 33, color: '#bdb294', kind: 'arcade', cap: 'pediment' },
  { x: 372, y: 350, w: 48, d: 49, h: 46, color: '#a4a18a', kind: 'pavilion', cap: 'cupola' },
  { x: 448, y: 360, w: 66, d: 40, h: 37, color: '#b8a78b', kind: 'terrace', cap: 'terrace' },
  { x: 557, y: 354, w: 77, d: 48, h: 39, color: '#baa783', kind: 'market', cap: 'gable' },
];
const TREES = [[220, 253], [231, 342], [218, 419], [699, 343], [731, 406], [695, 470], [721, 657], [661, 709], [587, 716], [255, 708], [295, 660]];

const MiniatureCity = memo(function MiniatureCity({ inland }) {
  return <div className="scene-miniature" aria-hidden="true">
    <div className="miniature-road road-horizontal"><i /><i /><i /></div><div className="miniature-road road-vertical" />
    <div className="miniature-park park-north" /><div className="miniature-park park-south"><span className="miniature-pond" /><span className="park-path" /></div>
    {CITY.map((building, i) => <span key={i} className={`miniature-building miniature-${building.kind} roof-${building.cap}`} style={{ left: building.x, top: building.y, '--b-width': `${building.w}px`, '--b-depth': `${building.d}px`, '--b-height': `${building.h}px`, '--b-color': building.color }} data-city-silhouette={building.kind}>
      <i className="miniature-front">{building.kind === 'clock' && <b className="miniature-clock-face">◷</b>}</i><i className="miniature-back" /><i className="miniature-side" /><i className="miniature-other-side" /><i className="miniature-roof" />
      {building.upper && <span className="miniature-setback" style={{ '--b-height': `${building.upper}px`, transform: `translateZ(${building.h}px)` }}><i className="miniature-front" /><i className="miniature-back" /><i className="miniature-side" /><i className="miniature-other-side" /><i className="miniature-roof" /></span>}
      <i className="miniature-cap" style={{ transform: `translateZ(${building.h + (building.upper || 0) + 4}px)` }} /><i className="miniature-cornice" />
      {['spire','lantern','cupola'].includes(building.cap) && <i className={`miniature-finial finial-${building.cap}`} style={{ transform: `translateZ(${building.h + (building.upper || 0) + 8}px) rotateX(-90deg)` }} />}
    </span>)}
    {TREES.map(([x, y], i) => <span key={i} className="miniature-tree" style={{ left: x, top: y, '--tree-size': `${24 + i % 3 * 5}px` }}><i /><i /><i /></span>)}
    <span className="miniature-car car-one" /><span className="miniature-car car-two" />
    <div className="miniature-plaza"><Landmark /><span>{inland ? 'INLAND EMPIRE' : 'OPENOPOLY CITY'}</span></div>
  </div>;
});

function tokenPoint(index) {
  const point = boardPoint(index);
  if (index < 0) return point;
  if (index === 0) return { x: 895, y: 912 };
  if (index === 10) return { x: 75, y: 912 };
  if (index % 10 === 0) return { x: point.x < 480 ? point.x + 28 : point.x - 28, y: point.y < 480 ? point.y + 29 : point.y - 29 };
  if (index < 10) return { ...point, y: 818 };
  if (index < 20) return { ...point, x: 148 };
  if (index < 30) return { ...point, y: 148 };
  return { ...point, x: 812 };
}

function SceneToken({ player, current, position, movement, offset, tilt, yaw }) {
  const from = tokenPoint(movement?.from ?? position);
  const to = movement ? tokenPoint(movement.to) : from;
  const t = movement ? movement.progress * movement.progress * (3 - 2 * movement.progress) : 0;
  const x = from.x + (to.x - from.x) * t + offset.x;
  const y = from.y + (to.y - from.y) * t + offset.y;
  const lift = movement ? movement.hop * (movement.direct ? 90 : 23) : 0;
  return <span className={`scene-token ${current ? 'is-current' : ''} ${movement ? 'is-moving' : ''}`} style={{ left: x, top: y, '--player-color': player.color, '--token-lift': `${lift}px` }} title={`${player.name} · ${position < 0 ? 'starting in the center' : `space ${position}`}`} data-player-id={player.id} data-position={position} data-moving={Boolean(movement)} data-step-from={movement?.from} data-step-to={movement?.to} aria-label={`${player.name}'s token`}>
    <span className="token-floor-shadow" /><span className="token-model"><span className="token-pedestal" /><span className="token-standing"><Token token={player.token} size={48} tilt={tilt} yaw={yaw} /><span className="scene-token-name">{player.name}</span></span></span>
  </span>;
}

export function Board({ preview = false }) {
  const context = useGame() || {};
  const { room, setSelected, selected } = context;
  const fallbackPresentation = usePresentation(context.presentation ? null : room);
  const presentation = context.presentation || fallbackPresentation;
  const game = room?.game;
  const theme = room?.theme || 'classic';
  const inland = theme === 'inland-empire' || game?.edition === 'inland';
  const board = getBoard(game || theme);
  const players = game?.players || room?.players?.map(player => ({ ...player, position: inland ? -1 : 0 })) || [];
  const actorId = presentation.active ? presentation.playerId : game?.currentPlayerId;
  const current = players.find(player => player.id === actorId);
  const visualPosition = presentation.positions[actorId] ?? current?.position ?? 0;
  const focusPosition = presentation.movement?.to ?? visualPosition;
  const focusSpace = board.find(space => (space.index ?? space.id) === focusPosition);
  const viewportRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 1000, height: 720 });
  const [compact, setCompact] = useState(() => !preview && window.matchMedia(compactQuery).matches);
  const [safeWindow, setSafeWindow] = useState(null);
  const [camera, setCamera] = useState({ zoom: 1, x: 0, y: 0, yaw: DEFAULT_BOARD_YAW });
  const [follow, setFollow] = useState(false);
  const [flat, setFlat] = useState(false);
  const [rotationMode, setRotationMode] = useState(false);
  const [manipulating, setManipulating] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);
  const gesture = useRef({ pointers: new Map(), moved: false, suppressUntil: 0 });
  const cameraRef = useRef(camera);
  const cameraFrame = useRef(null);
  const cameraGeometry = useRef(null);
  const directTimer = useRef(null);
  const followRef = useRef(follow);
  followRef.current = follow;

  // Native input can arrive faster than the display. Commit only the latest camera per frame.
  const updateCamera = update => {
    const candidate = typeof update === 'function' ? update(cameraRef.current) : update;
    if (![candidate.x, candidate.y, candidate.zoom, candidate.yaw].every(Number.isFinite)) return;
    const next = { ...candidate, zoom: clamp(candidate.zoom, .8, 3.2) };
    const geometry = cameraGeometry.current;
    const bounds = projectedBoardBounds(geometry.scale * next.zoom, geometry.tilt, next.yaw);
    // Keep an edge of the table reachable, even after a pointer reports a distant position.
    const limitX = Math.max(0, (bounds.width + geometry.width) / 2 - 96);
    const limitY = Math.max(0, (bounds.height + geometry.height) / 2 - 96);
    next.x = clamp(next.x, -limitX, limitX);
    next.y = clamp(next.y, -limitY, limitY);
    cameraRef.current = next;
    if (cameraFrame.current === null) cameraFrame.current = requestAnimationFrame(() => {
      cameraFrame.current = null;
      setCamera(cameraRef.current);
    });
  };
  const directInput = () => {
    setManipulating(true);
    clearTimeout(directTimer.current);
    directTimer.current = setTimeout(() => {
      if (!gesture.current.moved || !gesture.current.pointers.size) setManipulating(false);
    }, 140);
  };
  const clearGesture = () => {
    const state = gesture.current, pointers = [...state.pointers.keys()];
    if (state.moved) state.suppressUntil = Date.now() + 180;
    state.pointers.clear(); state.origin = null; state.mode = null; state.moved = false;
    for (const id of pointers) {
      if (viewportRef.current?.hasPointerCapture(id)) viewportRef.current.releasePointerCapture(id);
    }
    setManipulating(false);
  };

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setDimensions({ width, height });
    });
    observer.observe(element); return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const query = window.matchMedia(compactQuery);
    const update = () => setCompact(!preview && query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [preview]);

  useEffect(() => {
    const viewport = viewportRef.current, app = viewport?.closest('.app.at-table');
    if (!viewport) return;
    const measure = () => {
      const rect = viewport.getBoundingClientRect();
      let top = 16, bottom = dimensions.height - 22, left = compact ? 12 : preview ? 14 : 26, right = dimensions.width - left;
      if (compact && app) {
        const visible = selector => [...app.querySelectorAll(selector)].map(node => node.getBoundingClientRect()).filter(box => box.width && box.height && box.bottom > rect.top && box.top < rect.bottom);
        top = Math.max(16, ...visible('.app-header,.turn-strip,.scene-location').map(box => box.bottom - rect.top + 14));
        const actions = visible('.turn-action-dock,.shared-game-decision');
        const sideActions = dimensions.width > dimensions.height ? actions.filter(box => box.left > rect.left + dimensions.width * .4) : [];
        if (sideActions.length) {
          right = Math.min(right, ...sideActions.map(box => box.left - rect.left - 14));
          bottom = Math.min(dimensions.height - 22, ...visible('.player-hud').map(box => box.top - rect.top - 22));
        } else bottom = Math.min(dimensions.height - 22, ...[...actions, ...visible('.player-hud')].map(box => box.top - rect.top - 22));
        if (bottom - top < 130) { top = Math.min(top, dimensions.height * .38); bottom = Math.max(top + 130, bottom); }
      }
      if (!compact && app) {
        const cameraBar = app.querySelector('.scene-camera-bar')?.getBoundingClientRect();
        if (cameraBar?.width && cameraBar.top > rect.top + 120) bottom = Math.min(bottom, cameraBar.top - rect.top - 12);
        const drawer = app.querySelector('.game-drawer')?.getBoundingClientRect();
        if (drawer && drawer.width && drawer.left > rect.left + 180 && drawer.left < rect.right && drawer.bottom > rect.top) right = Math.min(right, drawer.left - rect.left - 16);
      }
      const safeTop = compact ? top : preview ? 16 : 24;
      const next = { left, top: safeTop, width: Math.max(100, right - left), height: Math.max(100, preview ? dimensions.height - 36 : bottom - safeTop) };
      setSafeWindow(previous => previous && ['left','top','width','height'].every(key => Math.abs(previous[key] - next[key]) < .5) ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (app) for (const node of app.querySelectorAll(compact ? '.app-header,.turn-strip,.scene-location,.turn-action-dock,.shared-game-decision,.player-hud' : '.game-drawer,.scene-camera-bar')) observer.observe(node);
    return () => observer.disconnect();
  }, [dimensions.width, dimensions.height, compact, preview, game?.phase, Boolean(game?.pendingMortgage), room?.status, context.panel]);

  useEffect(() => {
    let active = true;
    document.fonts?.ready.then(() => { if (active) setFontsReady(true); });
    const releaseOutside = event => {
      if (gesture.current.pointers.has(event.pointerId) && !viewportRef.current?.contains(event.target)) clearGesture();
    };
    const cancel = () => clearGesture();
    const hidden = () => { if (document.hidden) clearGesture(); };
    window.addEventListener('blur', cancel);
    window.addEventListener('pointerup', releaseOutside);
    window.addEventListener('pointercancel', cancel);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      active = false;
      cancelAnimationFrame(cameraFrame.current);
      cameraFrame.current = null;
      clearTimeout(directTimer.current);
      directTimer.current = null;
      window.removeEventListener('blur', cancel);
      window.removeEventListener('pointerup', releaseOutside);
      window.removeEventListener('pointercancel', cancel);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);

  useEffect(() => {
    if (game && followRef.current) updateCamera(value => ({ ...value, zoom: 1.22, x: 0, y: 0 }));
  }, [game?.currentPlayerId]);

  useEffect(() => {
    if (presentation.active && followRef.current) updateCamera(value => ({ ...value, zoom: 1.3, x: 0, y: 0 }));
  }, [presentation.presentation?.id]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || preview) return;
    const zoom = event => {
      event.preventDefault();
      directInput();
      updateCamera(value => ({ ...value, zoom: clamp(value.zoom * Math.exp(-event.deltaY * 0.0015), 0.8, 3.2) }));
    };
    viewport.addEventListener('wheel', zoom, { passive: false });
    return () => viewport.removeEventListener('wheel', zoom);
  }, [preview]);

  const tilt = flat ? 0 : preview || room?.status === 'lobby' ? 54 : compact ? 30 : 34;
  const framing = safeWindow || { left: 26, top: 24, width: Math.max(100, dimensions.width - 52), height: Math.max(100, dimensions.height - 65) };
  const fitted = useMemo(() => fitBoardWindow(framing.width, framing.height, tilt, camera.yaw), [framing.width, framing.height, tilt, camera.yaw]);
  cameraGeometry.current = { ...dimensions, scale: fitted.scale, tilt };
  const zoom = follow && presentation.rolling ? Math.min(camera.zoom, 1.13) : camera.zoom;
  const scale = fitted.scale * zoom;
  const focus = presentation.rolling ? { x: 480, y: 525 } : boardPoint(focusPosition);
  const projectedFocus = projectBoardPoint(focus, tilt, camera.yaw);
  const focusWeight = follow && game ? clamp((zoom - 1) / .5, 0, 1) : 0;
  const desired = { x: camera.x + fitted.x * zoom - projectedFocus.x * scale * focusWeight, y: camera.y + fitted.y * zoom - projectedFocus.y * scale * focusWeight };
  const position = follow && game ? keepBoardFocusVisible(desired, { ...focus, z: 48 }, scale, tilt, camera.yaw, framing.width, framing.height, compact ? 40 : 55) : desired;
  const cameraX = position.x, cameraY = position.y;
  const labelLift = billboardOffset(tilt, camera.yaw);
  const labels = useMemo(() => new Map(board.map(space => {
    const name = spaceName(space, inland ? 'inland-empire' : 'classic');
    return [space.id, { name, ...boardLabel(name, tilePlacement(space.index ?? space.id).side) }];
  })), [board, inland, context.themeDataReady, fontsReady]);
  const pointerOrigin = event => ({ x: event.clientX, y: event.clientY, cameraX: cameraX - fitted.x * zoom, cameraY: cameraY - fitted.y * zoom, zoom, yaw: cameraRef.current.yaw });
  const capturePointer = id => {
    const viewport = viewportRef.current;
    if (!viewport || viewport.hasPointerCapture(id)) return true;
    try { viewport.setPointerCapture(id); return true; }
    catch { clearGesture(); return false; }
  };
  const pointerDown = event => {
    if (preview || event.pointerType === 'mouse' && event.button !== 0 && event.button !== 2) return;
    const state = gesture.current;
    if (event.pointerType !== 'mouse' || event.button === 0 || event.buttons === 3) event.preventDefault();
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
    state.moved = false; state.origin = pointerOrigin(event);
    state.mode = rotationMode ? 'rotate' : event.buttons === 3 ? 'chord' : 'pan';
    if (state.pointers.size === 2) {
      const [a, b] = [...state.pointers.values()];
      state.mode = 'pinch';
      state.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y); state.pinchZoom = cameraRef.current.zoom;
      for (const id of state.pointers.keys()) if (!capturePointer(id)) break;
    }
  };
  const pointerMove = event => {
    const state = gesture.current;
    if (!state.pointers.has(event.pointerId) || !state.origin) return;
    if (event.pointerType === 'mouse') {
      if (!event.buttons || state.mode === 'chord' && event.buttons !== 3) { clearGesture(); return; }
      // A second mouse button changes buttons on pointermove; it does not send pointerdown.
      if (!rotationMode && event.buttons === 3 && state.mode !== 'chord') {
        state.mode = 'chord'; state.origin = { ...pointerOrigin(event), x: event.clientX, y: event.clientY };
      }
      if (event.buttons === 2 && state.mode !== 'chord' && !rotationMode) return;
    }
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
    const dx = event.clientX - state.origin.x, dy = event.clientY - state.origin.y;
    if (state.pointers.size === 2 && state.mode === 'pinch') {
      const [a, b] = [...state.pointers.values()]; state.moved = true;
      directInput();
      updateCamera(value => ({ ...value, zoom: clamp(state.pinchZoom * Math.hypot(a.x - b.x, a.y - b.y) / (state.pinchDistance || 1), 0.8, 3.2) }));
    } else if (Math.hypot(dx, dy) > 5 || state.moved) {
      if (!capturePointer(event.pointerId)) return;
      state.moved = true; directInput();
      if (state.mode === 'rotate' || state.mode === 'chord') updateCamera(value => ({ ...value, yaw: state.origin.yaw + dx * .45 }));
      else {
        setFollow(false);
        updateCamera(value => ({ ...value, zoom: state.origin.zoom, x: state.origin.cameraX + dx, y: state.origin.cameraY + dy }));
      }
    }
  };
  const pointerUp = event => { if (gesture.current.pointers.has(event.pointerId)) clearGesture(); };
  const contextMenu = event => {
    const state = gesture.current;
    if (state.pointers.size && (state.mode === 'rotate' || state.mode === 'chord' || event.buttons === 3) || Date.now() < state.suppressUntil) event.preventDefault();
  };
  const inspect = (id, event) => { if (!preview && (event?.detail === 0 || Date.now() > gesture.current.suppressUntil)) setSelected?.(id); };
  const overview = () => { clearGesture(); setFollow(false); updateCamera(value => ({ ...value, zoom: 1, x: 0, y: 0 })); };
  const followTurn = () => { clearGesture(); setFollow(true); updateCamera(value => ({ ...value, zoom: 1.3, x: 0, y: 0 })); };
  const resetCamera = () => { clearGesture(); setFollow(false); setFlat(false); setRotationMode(false); updateCamera(value => ({ zoom: 1, x: 0, y: 0, yaw: nearestBoardNorth(value.yaw) })); };
  const occupied = useMemo(() => {
    const groups = new Map();
    for (const player of players.filter(player => !player.bankrupt)) {
      const position = presentation.positions[player.id] ?? player.position ?? 0;
      const group = groups.get(position) || []; group.push(player.id); groups.set(position, group);
    }
    return groups;
  }, [players, presentation.positions]);
  const hasRolled = Boolean(presentation.active && presentation.presentation?.dice || game?.log?.some(event => event.type === 'roll'));

  return <div className={`board-scene ${preview ? 'scene-preview' : ''} ${inland ? 'scene-inland' : 'scene-classic'} ${presentation.moving ? 'scene-in-motion' : ''} ${flat ? 'scene-flat' : ''} ${manipulating ? 'scene-manipulating' : ''} ${rotationMode ? 'scene-rotate-mode' : ''}`} data-presentation-id={presentation.active ? presentation.presentation?.id : ''} data-presentation-stage={presentation.stage} data-presentation-elapsed={presentation.elapsed} data-server-time={presentation.serverTime} data-clock-offset={presentation.clockOffset} data-camera-mode={follow ? 'follow' : 'free'} data-camera-heading={boardHeading(camera.yaw)} data-camera-zoom={camera.zoom} data-camera-yaw={camera.yaw} data-camera-x={camera.x} data-camera-y={camera.y}>
    <svg width="0" height="0" className="scene-filter-defs" aria-hidden="true"><defs><filter id="monopoly-metal-cutout" colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  -1 -1 -1 0 2.88" result="keyed" /><feComposite in="keyed" in2="SourceGraphic" operator="in" /></filter></defs></svg>
    <div className="scene-ambient" aria-hidden="true" />
    <div className="scene-viewport" ref={viewportRef} style={{ perspectiveOrigin: `${framing.left + framing.width / 2}px ${framing.top + framing.height / 2}px` }} data-safe-left={framing.left} data-safe-top={framing.top} data-safe-width={framing.width} data-safe-height={framing.height} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={clearGesture} onLostPointerCapture={pointerUp} onContextMenu={contextMenu} aria-label={`${inland ? 'Inland Empire-opoly' : 'Classic Openopoly'} board. Drag to ${rotationMode ? 'rotate' : 'pan'}; hold both mouse buttons to rotate; scroll or pinch to zoom.`}>
      <div className="scene-camera" style={{ left: framing.left + framing.width / 2, top: framing.top + framing.height / 2, transform: `translate3d(${cameraX}px, ${cameraY}px, 0) scale(${scale})`, '--scene-tilt': `${tilt}deg`, '--scene-untilt': `${-tilt}deg`, '--scene-unyaw': `${-camera.yaw}deg`, '--label-compensate-x': `${labelLift.x}px`, '--label-compensate-y': `${labelLift.y}px` }}>
        <div className="scene-world" style={{ transform: `rotateX(${tilt}deg) rotateZ(${camera.yaw}deg)` }}>
          <div className="scene-platform" aria-hidden="true"><span className="platform-front" /><span className="platform-side" /><span className="platform-label">{inland ? 'INLAND EMPIRE-OPOLY' : 'OPENOPOLY'}</span></div>
          <div className="scene-board monopoly-board" role="group" aria-label="40 board spaces">
            <div className="scene-center"><div className="center-lawn" /><div className="center-boundary" /></div>
            {board.map(space => {
              const index = space.index ?? space.id;
              const placement = tilePlacement(index);
              const property = game?.properties?.[space.id];
              const owner = players.find(player => player.id === property?.ownerId);
              const corner = index % 10 === 0;
              const label = labels.get(space.id), name = label.name;
              const labelFit = labelLayout(label, placement.side, tilt, camera.yaw);
              const landed = Boolean(game && focusPosition === index);
              return <button type="button" key={space.id} className={`scene-tile board-tile side-${placement.side} ${corner ? 'scene-corner' : ''} type-${space.type} ${property?.mortgaged ? 'is-mortgaged' : ''} ${landed ? 'is-landed' : ''} ${selected === space.id ? 'is-selected' : ''}`} style={{ gridColumn: placement.gridColumn, gridRow: placement.gridRow, '--property-color': space.color || '#668181', '--owner-color': owner?.color || 'transparent' }} onClick={event => inspect(space.id, event)} title={`${name}${space.price ? ` · ${money(space.price)}` : ''}${owner ? ` · ${owner.name}` : ''}`} aria-label={`${name}${space.price ? `, ${money(space.price)}` : ''}${owner ? `, owned by ${owner.name}` : ''}`} data-space-id={space.id} tabIndex={preview ? -1 : 0}>
                {corner ? <div className="scene-corner-content"><Corner space={space} inland={inland} /></div> : <>
                  {space.type === 'property' && <span className="scene-property-band" />}
                  <span className="scene-tile-copy"><span className="scene-tile-name" style={{ fontSize: labelFit.size, '--label-width': `${labelFit.width}px` }}>{label.text}</span>{space.type !== 'property' && <span className="scene-space-icon">{space.type === 'utility' && index === 28 ? <Waves size={23} /> : <SpaceIcon type={space.type} size={23} />}</span>}<span className="scene-tile-price">{space.price ? money(space.price) : space.type === 'tax' ? `PAY ${money(space.amount)}` : ''}</span></span>
                  {owner && <span className="scene-owner-marker" title={`Owned by ${owner.name}`} />}
                  {property?.mortgaged && <span className="scene-mortgage">MORTGAGED</span>}
                </>}
                <span className="scene-space-number" aria-hidden="true">{index.toString().padStart(2, '0')}</span>
              </button>;
            })}
          </div>
          <MiniatureCity inland={inland} />
          <div className={`scene-brand ${inland ? 'brand-inland' : ''}`} aria-hidden="true">{inland ? <><span>INLAND EMPIRE</span><b>OPOLY</b></> : <b>OPENOPOLY</b>}</div>
          <div className="scene-card-deck scene-chest" aria-hidden="true"><Box /><b>{inland ? 'BIG FUN' : 'COMMUNITY CHEST'}</b><span>DRAW A CARD</span></div>
          <div className="scene-card-deck scene-chance" aria-hidden="true"><b className="deck-question">?</b><b>{inland ? 'CONTINGENCY' : 'CHANCE'}</b><span>DRAW A CARD</span></div>
          {board.filter(space => game?.properties?.[space.id]?.houses > 0).map(space => {
            const property = game.properties[space.id], point = boardPoint(space.id);
            const hotel = property.houses === 5, count = hotel ? 1 : property.houses;
            const horizontal = space.id < 10 || space.id > 20 && space.id < 30;
            return <span className="scene-development" key={space.id} style={{ left: point.x, top: point.y }} aria-label={`${hotel ? 'Hotel' : `${count} houses`} on ${space.name}`}>{Array.from({ length: count }, (_, index) => <Building key={index} hotel={hotel} style={{ left: horizontal ? (index - (count - 1) / 2) * 18 : (space.id < 20 ? 42 : -42), top: horizontal ? (space.id < 10 ? -47 : 43) : (index - (count - 1) / 2) * 18 }} />)}</span>;
          })}
          <div className="scene-dice-table" aria-label={presentation.rolling ? 'Dice rolling' : `Dice ${presentation.dice[0]} and ${presentation.dice[1]}`}>
            <span className="dice-floor-shadow" />{presentation.dice.map((value, index) => {
              const remaining = presentation.rolling ? 1 - presentation.rollProgress : 0;
              const bounce = presentation.rolling ? Math.abs(Math.sin(presentation.rollProgress * Math.PI * 3.5)) * remaining * 70 : 0;
              return <span key={index} className={`scene-thrown-die thrown-die-${index}`} style={{ transform: `translate3d(${(index ? 1 : -1) * remaining * 100}px, ${-remaining * 95}px, ${bounce}px)` }}><Dice value={value} rolling={presentation.rolling} progress={presentation.rollProgress} index={index} grounded size={62} /></span>;
            })}<span className="scene-dice-total">{presentation.rolling ? 'ROLLING' : hasRolled ? `${presentation.dice[0] + presentation.dice[1]}${presentation.dice[0] === presentation.dice[1] ? ' · DOUBLES' : ''}` : 'READY TO ROLL'}</span>
          </div>
          {players.filter(player => !player.bankrupt).map(player => {
            const position = presentation.positions[player.id] ?? player.position ?? 0;
            const group = occupied.get(position) || [player.id], order = group.indexOf(player.id), spread = Math.min(group.length - 1, 3);
            const offset = { x: group.length > 1 ? (order % 4 - spread / 2) * 41 : 0, y: order >= 4 ? 35 : 0 };
            return <SceneToken key={player.id} player={player} current={player.id === actorId} position={position} movement={presentation.movements[player.id]} offset={offset} tilt={tilt} yaw={camera.yaw} />;
          })}
        </div>
      </div>
    </div>
    {!preview && <>
      <div className="scene-location"><span className="scene-location-color" style={{ background: focusSpace?.color || current?.color || 'var(--ui-accent)' }} /><div><small>{presentation.rolling ? 'DICE IN PLAY' : presentation.moving ? 'MOVING TO' : current ? `${current.name.toUpperCase()} · SPACE ${focusPosition < 0 ? 'CENTER' : focusPosition}` : 'THE BOARD'}</small><button type="button" onClick={() => focusSpace && inspect(focusSpace.id)} disabled={!focusSpace || presentation.rolling}>{presentation.rolling ? 'Rolling dice…' : focusSpace ? spaceName(focusSpace, inland ? 'inland-empire' : 'classic') : inland ? 'Inland Empire-opoly' : 'Classic Openopoly'}</button></div>{focusSpace?.price && !presentation.rolling ? <span className="scene-location-price">{money(focusSpace.price)}</span> : null}</div>
      <div className="scene-bank-stock"><span><House size={13} />{game?.bank?.houses ?? 32}</span><span><Landmark size={13} />{game?.bank?.hotels ?? 12}</span>{inland && <span className="scene-pot">POT <b>{money(game?.centerPot || 0)}</b></span>}</div>
      <div className="scene-camera-bar" role="toolbar" aria-label="Board camera">
        <div className="scene-zoom-controls"><button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => updateCamera(value => ({ ...value, zoom: clamp(value.zoom - 0.2, 0.8, 3.2) }))} disabled={camera.zoom <= 0.8}><Minus size={17} /></button><span>{Math.round(camera.zoom * 100)}%</span><button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => updateCamera(value => ({ ...value, zoom: clamp(value.zoom + 0.2, 0.8, 3.2) }))} disabled={camera.zoom >= 3.2}><Plus size={17} /></button></div>
        <button type="button" className={!follow && camera.zoom === 1 ? 'is-active' : ''} onClick={overview} title="Show the whole board" aria-label="Overview"><Maximize2 size={16} /><span className="camera-label-full">Overview</span><span className="camera-label-compact">Board</span></button>
        <button type="button" className={follow ? 'is-active' : ''} onClick={() => follow ? (setFollow(false), updateCamera(value => ({ ...value, x: cameraX - fitted.x * zoom, y: cameraY - fitted.y * zoom }))) : followTurn()} aria-pressed={follow} title="Follow the active token at a readable zoom" aria-label="Follow turn"><Navigation size={16} /><span className="camera-label-full">Follow turn</span><span className="camera-label-compact">Follow</span></button>
        <button type="button" className={rotationMode ? 'is-active' : ''} onClick={() => { clearGesture(); setRotationMode(value => !value); }} aria-pressed={rotationMode} title="Toggle rotation mode, then drag the board" aria-label="Rotate board"><RotateCw size={16} /><span>Rotate</span></button>
      </div>
      <div className="scene-view-controls" role="group" aria-label="Board view">
        <button type="button" onClick={() => { clearGesture(); setFlat(value => !value); }} aria-pressed={flat} title={flat ? 'Angled table view' : 'Top view'} aria-label={flat ? 'Angled table view' : 'Top view'}><Compass size={17} /></button>
        <button type="button" onClick={resetCamera} title="Reset camera" aria-label="Reset camera"><RotateCcw size={16} /></button>
      </div>
      <span className={`scene-camera-hint ${rotationMode ? 'is-rotation-hint' : ''}`}>{rotationMode ? 'Drag to rotate · Scroll or pinch to zoom' : 'Drag to pan · Both mouse buttons to rotate · Scroll to zoom'}</span>
    </>}
  </div>;
}

