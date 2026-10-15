import React, { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getBoard } from '../shared/board.js';
import { useGame } from './game-context.jsx';
import { spaceName } from './themes.js';
import EmoteArt, { emoteName } from './EmoteArt.jsx';
import { EMOTE_IMPACT_FRACTION } from './emote-visual.js';
import './emote-effects.css';

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
function emoteGeometry(event, lane) {
  const width = innerWidth, height = innerHeight;
  const scene = document.querySelector('.board-scene:not(.scene-preview) .scene-viewport');
  const bounds = scene?.getBoundingClientRect();
  if (!bounds) return null;
  const center = { x: clamp(bounds.left + bounds.width / 2 + (lane - 1) * 42, 45, width - 45), y: clamp(bounds.top + bounds.height * .46 + lane * 12, 90, height - 150) };
  const point = node => {
    const rect = node?.getBoundingClientRect();
    if (!rect || rect.width < 8 || rect.height < 8 || getComputedStyle(node).visibility === 'hidden') return null;
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    return x > 8 && x < width - 8 && y > 20 && y < height - 20 ? { x,y } : null;
  };
  const playerPoint = id => {
    for (const selector of ['.player-card[data-player-id]','.player-hud[data-player-id]','.scene-token[data-player-id]']) {
      const candidates = [...document.querySelectorAll(selector)].filter(node => node.dataset.playerId === id);
      for (const node of candidates) { const position = point(node); if (position) return position; }
    }
    return point(document.querySelector('[data-testid="players-toggle"]'));
  };
  let target = center, fallback = false;
  if (event.target.kind === 'player') { target = playerPoint(event.target.playerId) || center; fallback = target === center; }
  if (event.target.kind === 'property') {
    const tile = [...document.querySelectorAll('.scene-tile[data-space-id]')].find(node => Number(node.dataset.spaceId) === event.target.propertyId);
    const projected = point(tile), hit = projected && document.elementFromPoint(projected.x, projected.y);
    if (projected && hit?.closest('.scene-tile') === tile) target = projected;
    else fallback = true;
  }
  return { source: playerPoint(event.senderId) || { x: clamp(bounds.left + 35, 35, width - 35), y: clamp(bounds.bottom - 70, 70, height - 70) }, target, fallback, caption: { x: clamp(target.x, Math.min(110,width / 2), width - Math.min(110,width / 2)), y: clamp(target.y + 39, 35, height - 62) } };
}

const EmoteBurst = memo(function EmoteBurst({ event, lane, sender, destination, now, reducedMotion, pickerOpen }) {
  const element = useRef(null);
  const [geometryPass, setGeometryPass] = useState(0);
  useEffect(() => {
    if (pickerOpen) return;
    // Closing the sender's drawer restores the board's safe width. Seek this
    // same event once after that finite camera transition, before the toss lands.
    if (reducedMotion) {
      const frame = requestAnimationFrame(() => setGeometryPass(value => value + 1));
      return () => cancelAnimationFrame(frame);
    }
    const camera = document.querySelector('.scene-camera');
    let completed = false;
    const finish = () => { if (completed) return; completed = true; clearTimeout(timeout); camera?.removeEventListener('transitionend', settled); setGeometryPass(value => value + 1); };
    const settled = event => { if (event.target === camera && event.propertyName === 'transform') finish(); };
    const timeout = setTimeout(finish, 740);
    camera?.addEventListener('transitionend', settled);
    return () => { completed = true; clearTimeout(timeout); camera?.removeEventListener('transitionend', settled); };
  }, [pickerOpen, reducedMotion]);
  useLayoutEffect(() => {
    const root = element.current, geometry = emoteGeometry(event, lane), animations = [];
    if (!root || !geometry || typeof root.animate !== 'function') return;
    const elapsed = now() - event.startedAt, duration = event.endsAt - event.startedAt;
    if (elapsed >= duration) return;
    const cancel = () => animations.forEach(animation => { try { animation.cancel(); } catch {} });
    try {
      const { source, target, caption, fallback } = geometry;
      root.dataset.targetFallback = String(fallback);
      const animate = (node, frames) => { const animation = node.animate(frames, { duration, fill: 'both', easing: 'linear' }); animations.push(animation); animation.currentTime = Math.max(0, elapsed); };
      const sticker = root.querySelector('.emote-sticker');
      const transform = (point, rotation = 0, scale = 1, stretch = 1) => `translate3d(${point.x - 30}px,${point.y - 30}px,0) rotate(${rotation}deg) scale(${scale},${scale * stretch})`;
      if (reducedMotion) { sticker.style.transform = transform(target); animate(sticker,[{opacity:0},{opacity:1,offset:.08},{opacity:1,offset:.82},{opacity:0}]); }
      else if (event.kind === 'poop') animate(sticker,[
        {opacity:0,transform:transform(source,-35,.35)},
        {opacity:1,transform:transform({x:source.x+(target.x-source.x)*.45,y:Math.min(source.y,target.y)-95},160,.8),offset:.12},
        {opacity:1,transform:transform(target,360,1,.7),offset:EMOTE_IMPACT_FRACTION},
        {opacity:1,transform:transform(target,360,1,1.06),offset:.3},
        {opacity:1,transform:transform(target,360,1),offset:.36},
        {opacity:1,transform:transform(target,360,1),offset:.8},
        {opacity:0,transform:transform({x:target.x,y:target.y-8},360,.85)},
      ]);
      else animate(sticker,[
        {opacity:0,transform:transform({x:target.x,y:target.y+24},-12,.25)},
        {opacity:1,transform:transform({x:target.x,y:target.y-10},6,1.12),offset:.13},
        {opacity:1,transform:transform(target,-3,.95),offset:.23},
        {opacity:1,transform:transform(target,0,1),offset:.34},
        {opacity:1,transform:transform(target,0,1),offset:.82},
        {opacity:0,transform:transform({x:target.x,y:target.y-10},0,.85)},
      ]);
      const label = root.querySelector('.emote-caption'); label.style.left=`${caption.x}px`; label.style.top=`${caption.y}px`;
      animate(label,[{opacity:0},{opacity:0,offset:event.kind === 'poop' && !reducedMotion ? .23 : .05},{opacity:1,offset:.32},{opacity:1,offset:.82},{opacity:0}]);
      if (event.kind === 'poop' && !reducedMotion) root.querySelectorAll('.emote-fleck').forEach((node,index) => { const angle = (index * 95 + 15) * Math.PI / 180; animate(node,[{opacity:0,transform:`translate(${target.x}px,${target.y}px) scale(.3)`},{opacity:0,offset:EMOTE_IMPACT_FRACTION},{opacity:1,transform:`translate(${target.x+Math.cos(angle)*42}px,${target.y+Math.sin(angle)*42}px) scale(1)`,offset:.32},{opacity:0,transform:`translate(${target.x+Math.cos(angle)*52}px,${target.y+Math.sin(angle)*52}px) scale(.3)`,offset:.48},{opacity:0}]); });
    } catch { cancel(); }
    return cancel;
  }, [event, lane, now, reducedMotion, pickerOpen, geometryPass]);
  return <div ref={element} className="emote-burst" data-testid="shared-emote" data-emote-id={event.id} data-emote-kind={event.kind} data-emote-target={event.target.kind} data-emote-start={event.startedAt} data-emote-end={event.endsAt} data-geometry-pass={geometryPass}>
    <span className="emote-sticker"><EmoteArt kind={event.kind} /></span>
    <span className="emote-caption"><b>{sender}</b><span>{emoteName(event.kind)} → {destination}</span></span>
    {event.kind === 'poop' && !reducedMotion && [0,1,2,3].map(index=><i className="emote-fleck" key={index}>✦</i>)}
  </div>;
});

export default function EmoteLayer() {
  const { room, emotes = [], emoteServerNow = Date.now, presentation, panel } = useGame();
  if (!room || !emotes.length) return null;
  const board = getBoard(room.game || room.theme);
  const name = id => room.players.find(player => player.id === id)?.name || 'Player';
  return <div className="emote-layer" aria-hidden="true" data-testid="emote-layer">{emotes.filter(event=>event.roomCode === room.code && event.endsAt > emoteServerNow()).slice(-3).map(event=><EmoteBurst key={`${room.code}:${event.id}`} event={event} lane={[...event.id].reduce((sum,char)=>sum+char.charCodeAt(0),0)%3} sender={name(event.senderId)} destination={event.target.kind === 'table' ? 'Everyone' : event.target.kind === 'player' ? name(event.target.playerId) : spaceName(board.find(space=>space.id === event.target.propertyId),room.theme)} now={emoteServerNow} reducedMotion={Boolean(presentation?.reducedMotion)} pickerOpen={panel === 'emotes'} />)}</div>;
}

