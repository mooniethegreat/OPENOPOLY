import React, { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { advanceMoneyFeed, enqueueMoneyFlights, flightNoise, moneyNotes, MONEY_FLIGHT_DURATION } from './money-flight.js';
import { money } from './themes.js';
import './money-flight.css';

const noteColors = { 500: '#e7ae73', 100: '#e9d3ae', 50: '#d5b9df', 20: '#b9d6a8', 10: '#b4d5e4', 5: '#e9bdca', 1: '#f0e9cc' };
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function Banknote({ value }) {
  return <svg viewBox="0 0 184 92" aria-hidden="true" focusable="false">
    <rect x="1" y="1" width="182" height="90" rx="3" fill={noteColors[value]} stroke="#544d35" strokeWidth="2" />
    <rect x="7" y="7" width="170" height="78" rx="2" fill="none" stroke="#61563c" strokeWidth="1.5" />
    <path d="M12 28V12h29M143 12h29v16M12 64v16h29M143 80h29V64" fill="none" stroke="#61563c" strokeWidth="2" />
    <ellipse cx="92" cy="47" rx="42" ry="26" fill="#fff8" stroke="#61563c" />
    <text x="92" y="20" textAnchor="middle" fontFamily="Georgia,serif" fontSize="10" fontWeight="bold" fill="#423c2c" letterSpacing="1.4">MONOPOLY</text>
    <text x="92" y="60" textAnchor="middle" fontFamily="Georgia,serif" fontSize="36" fontWeight="bold" fill="#423c2c">{value}</text>
    <text x="21" y="35" fontFamily="Georgia,serif" fontSize="18" fontWeight="bold" fill="#423c2c">{value}</text>
    <text x="163" y="72" textAnchor="end" fontFamily="Georgia,serif" fontSize="18" fontWeight="bold" fill="#423c2c">{value}</text>
    <text x="92" y="80" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="6" fill="#423c2c" letterSpacing="1.5">MONOPOLY MONEY</text>
  </svg>;
}

function flightGeometry(flight) {
  const width = window.innerWidth, height = window.innerHeight;
  const visibleRect = node => {
    const rect = node?.getBoundingClientRect();
    if (!rect || getComputedStyle(node).visibility === 'hidden') return null;
    const box = { left: Math.max(12, rect.left), right: Math.min(width - 12, rect.right), top: Math.max(12, rect.top), bottom: Math.min(height - 12, rect.bottom) };
    return box.right - box.left >= 32 && box.bottom - box.top >= 24 ? box : null;
  };
  const scene = document.querySelector('.board-scene:not(.scene-preview)');
  let board = visibleRect(scene);
  if (!board || board.right - board.left < 150 || board.bottom - board.top < 180) board = visibleRect(scene?.querySelector('.scene-viewport'));
  if (!board) return null;
  const center = { x: (board.left + board.right) / 2, y: board.top + (board.bottom - board.top) * .45 };
  const bank = { x: board.right - Math.min(70, (board.right - board.left) * .18), y: board.top + Math.min(130, (board.bottom - board.top) * .3) };
  const pot = { x: center.x, y: center.y + 32 };
  const cards = [...document.querySelectorAll('.player-card[data-player-id],.player-hud[data-player-id]')];
  const point = (id, label) => {
    if (!id) return label === 'Center pot' ? pot : bank;
    const bounds = cards.filter(card => card.dataset.playerId === id).map(visibleRect).find(Boolean) || visibleRect(document.querySelector('[data-testid="players-toggle"]'));
    return bounds ? { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 } : { x: center.x, y: Math.min(height - 40, board.bottom + 20) };
  };
  const spread = Math.min(140, (board.right - board.left) * .25);
  const captionMargin = Math.min(width / 2 - 8, width <= 600 ? 116 : 141);
  return { source: point(flight.from, flight.fromLabel), target: point(flight.to, flight.toLabel), center, spread, bank: !flight.from ? point(null, flight.fromLabel) : !flight.to ? point(null, flight.toLabel) : null, caption: { x: clamp(center.x, captionMargin, width - captionMargin), y: clamp(Math.min(center.y + 82, board.bottom - 95), 12, height - 105) } };
}

const MoneyBurst = memo(function MoneyBurst({ flight, reducedMotion, now }) {
  const element = useRef(null);
  const notes = moneyNotes(flight.amount);
  useLayoutEffect(() => {
    const root = element.current, geometry = flightGeometry(flight);
    if (!root || !geometry) return;
    const { source, target, center, spread, caption, bank } = geometry;
    const elapsed = clamp(now() - flight.startsAt, 0, MONEY_FLIGHT_DURATION);
    if (elapsed >= MONEY_FLIGHT_DURATION) return;
    const animations = [];
    const cancel = () => animations.forEach(animation => { try { animation.cancel(); } catch {} });
    if (typeof root.animate !== 'function') return;
    try {
    const animate = (node, frames) => {
      const animation = node.animate(frames, { duration: MONEY_FLIGHT_DURATION, easing: 'linear', fill: 'both' });
      animations.push(animation);
      animation.currentTime = elapsed;
    };
    const reducedFrames = [{ opacity: 0 }, { opacity: .95, offset: .12 }, { opacity: .95, offset: .72 }, { opacity: 0 }];
    root.querySelectorAll('.money-flight-note').forEach((node, index) => {
      const random = salt => flightNoise(flight.seq, index, salt);
      const scatter = { x: center.x + (random(1) - .5) * spread * 2, y: center.y + (random(2) - .5) * Math.min(110, spread) };
      const angle = (random(3) - .5) * 110;
      const transform = (point, scale, rotation, pitch = 0, yaw = 0) => `translate3d(${point.x - 46}px,${point.y - 23}px,0) perspective(700px) rotate(${rotation}deg) rotateX(${pitch}deg) rotateY(${yaw}deg) scale(${scale})`;
      if (reducedMotion) {
        node.style.transform = transform({ x: center.x + (index - (notes.length - 1) / 2) * 12, y: center.y }, .8, (index - notes.length / 2) * 6);
        animate(node, reducedFrames);
      } else animate(node, [
        { opacity: 0, transform: transform(source, .3, angle - 45, 0, 25) },
        { opacity: 1, transform: transform({ x: source.x + (scatter.x - source.x) * .45, y: Math.min(source.y, scatter.y) - 75 - random(4) * 30 }, .88, angle - 20, -24, 35), offset: .16 },
        { opacity: 1, transform: transform(scatter, 1, angle, 40, -12), offset: .36 },
        { opacity: 1, transform: transform({ x: scatter.x + 10, y: scatter.y - 22 }, .98, angle + 12, -12, 15), offset: .54 },
        { opacity: .95, transform: transform({ x: scatter.x + (target.x - scatter.x) * .6, y: scatter.y + (target.y - scatter.y) * .5 - 45 }, .82, angle - 15, 12, -20), offset: .78 },
        { opacity: 0, transform: transform(target, .16, angle + 30, 0, 25) },
      ]);
    });
    const captionNode = root.querySelector('.money-flight-caption');
    captionNode.style.left = `${caption.x}px`; captionNode.style.top = `${caption.y}px`;
    animate(captionNode, [{ opacity: 0, transform: 'translate(-50%,8px)' }, { opacity: 1, transform: 'translate(-50%,0)', offset: .18 }, { opacity: 1, transform: 'translate(-50%,0)', offset: .74 }, { opacity: 0, transform: 'translate(-50%,-7px)' }]);
    if (bank) {
      const marker = root.querySelector('.money-flight-bank');
      marker.style.left = `${bank.x}px`; marker.style.top = `${bank.y}px`;
      animate(marker, reducedFrames);
    }
    // Browser compositor owns all movement. There are no per-frame DOM reads,
    // camera updates or cash actions, and every animation is canceled on cleanup.
    } catch {
      // Cosmetic browser/compositor failures must never take down the game UI.
      cancel();
    }
    return cancel;
  }, [flight, reducedMotion, now]);
  return <div ref={element} className={`money-flight-burst ${reducedMotion ? 'reduced-motion' : ''}`} data-testid="money-flight" data-money-id={flight.id} data-money-seq={flight.seq} data-money-from={flight.from || 'bank'} data-money-to={flight.to || 'bank'} data-money-amount={flight.amount} data-money-start={flight.startsAt} data-money-end={flight.endsAt}>
    {notes.map((value, index) => <span className="money-flight-note" data-denomination={value} key={index}><Banknote value={value} /></span>)}
    {(!flight.from || !flight.to) && <span className="money-flight-bank">{!flight.from ? flight.fromLabel : flight.toLabel}</span>}
    <div className="money-flight-caption"><strong>{money(flight.amount)}</strong><span>{flight.fromLabel} <b>→</b> {flight.toLabel}</span><small>{flight.reason}</small></div>
  </div>;
});

export default function MoneyFlight({ room, presentation }) {
  const cursor = useRef(null), clock = useRef(null);
  const [flights, setFlights] = useState([]);
  const [, tick] = useState(0);
  const now = useRef(() => clock.current ? clock.current.serverTime + Math.max(0, performance.now() - clock.current.monotonic) : Date.now()).current;
  if (Number.isFinite(presentation?.serverTime) && (!clock.current || clock.current.scope !== room?.code || clock.current.serverTime !== presentation.serverTime)) clock.current = { scope: room?.code, serverTime: presentation.serverTime, monotonic: performance.now() };
  useEffect(() => {
    const previousScope = cursor.current?.scope;
    const update = advanceMoneyFeed(cursor.current, room);
    cursor.current = update.cursor;
    if (document.visibilityState === 'hidden' || !room?.game || update.cursor?.scope !== previousScope) setFlights([]);
    else if (update.payments.length) setFlights(current => enqueueMoneyFlights(current, update.payments, now()));
  }, [room, now]);
  useEffect(() => {
    if (!flights.length) return;
    const time = now();
    const next = Math.min(...flights.flatMap(item => item.startsAt > time ? [item.startsAt] : item.endsAt > time ? [item.endsAt] : []));
    if (!Number.isFinite(next)) { setFlights([]); return; }
    const timeout = setTimeout(() => { const time = now(); setFlights(items => items.filter(item => item.endsAt > time)); tick(value => value + 1); }, Math.max(8, next - time + 4));
    return () => clearTimeout(timeout);
  }, [flights, now]);
  useEffect(() => {
    const hide = () => { if (document.visibilityState === 'hidden') setFlights([]); };
    document.addEventListener('visibilitychange', hide);
    const leave = () => setFlights([]);
    window.addEventListener('pagehide', leave);
    return () => { document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', leave); };
  }, []);
  if (!room?.game || cursor.current?.scope !== room.code) return null;
  const time = now();
  return <div className="money-flight-layer" aria-hidden="true" data-testid="money-flight-layer">{flights.filter(item => time >= item.startsAt && time < item.endsAt).map(flight => <MoneyBurst key={`${room.code}:${flight.id}`} flight={flight} reducedMotion={Boolean(presentation?.reducedMotion)} now={now} />)}</div>;
}
