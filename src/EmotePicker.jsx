import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Search, Users } from 'lucide-react';
import { getBoard } from '../shared/board.js';
import { useGame } from './game-context.jsx';
import { committedPayment } from './payment-feedback.js';
import { spaceName } from './themes.js';
import EmoteArt, { EMOTE_OPTIONS, emoteName } from './EmoteArt.jsx';
import './emote-effects.css';

export default function EmotePicker() {
  const { room, players, playerId, connected, sendEmote, emoteStatus = {}, emoteServerNow = Date.now, setPanel } = useGame();
  const [kind, setKind] = useState(null), [target, setTarget] = useState({ kind: 'table' });
  const [explicitTarget, setExplicitTarget] = useState(false), [choosingTarget, setChoosingTarget] = useState(false), [properties, setProperties] = useState(false), [query, setQuery] = useState('');
  const [, tick] = useState(0);
  const isUno = room.gameType === 'uno' || room.game?.kind === 'uno';
  const board = isUno ? [] : getBoard(room.game || room.theme);
  const cooling = (emoteStatus.cooldownUntil || 0) > emoteServerNow();
  const disabled = !connected || emoteStatus.pending || cooling;
  useEffect(() => {
    const remaining = (emoteStatus.cooldownUntil || 0) - emoteServerNow();
    if (remaining <= 0) return;
    const timer = setTimeout(() => tick(value => value + 1), remaining + 12);
    return () => clearTimeout(timer);
  }, [emoteStatus.cooldownUntil, emoteServerNow]);
  const targetLabel = target.kind === 'table' ? 'Everyone' : target.kind === 'player' ? players.find(player => player.id === target.playerId)?.name || 'Player' : spaceName(board.find(space => space.id === target.propertyId), room.theme);
  const recent = useMemo(() => {
    if (isUno) return null;
    for (const event of [...(room.game?.log || [])].reverse()) {
      const payment = committedPayment(room, event);
      if (!payment || payment.from !== playerId && payment.to !== playerId) continue;
      const other = payment.from === playerId ? payment.to : payment.from;
      if (other && players.some(player => player.id === other)) return { target: { kind: 'player', playerId: other }, label: `React to ${players.find(player => player.id === other).name}` };
      if (Number.isInteger(event.propertyId) && board.some(space => space.id === event.propertyId)) return { target: { kind: 'property', propertyId: event.propertyId }, label: `React to ${spaceName(board.find(space => space.id === event.propertyId), room.theme)}` };
      return null;
    }
    return null;
  }, [room, players, playerId]);
  const selectTarget = value => { setTarget(value); setExplicitTarget(true); setChoosingTarget(false); setProperties(false); };
  const submit = async chosen => { if (!disabled && await sendEmote?.(chosen, target)) setPanel(null); };
  const selectKind = chosen => {
    if (disabled) return;
    if (!explicitTarget && chosen !== 'middle-finger' && chosen !== 'poop') submit(chosen);
    else { setKind(chosen); setChoosingTarget(true); }
  };
  return <section className="emote-picker" data-testid="emote-picker" aria-label="React">
    <div className="emote-picker-heading"><div><small>AT THE TABLE</small><h2>React</h2></div><button type="button" className="emote-to-button" onClick={() => setChoosingTarget(value => !value)}><Users size={16} /><span>To <b>{targetLabel}</b></span></button></div>
    <div className="emote-options">{EMOTE_OPTIONS.map(option => <button type="button" key={option.kind} className={kind === option.kind ? 'selected' : ''} aria-pressed={kind === option.kind} disabled={disabled} onClick={() => selectKind(option.kind)}><EmoteArt kind={option.kind} /><span>{option.label}</span></button>)}</div>
    {!kind && recent && <button type="button" className="emote-recent" onClick={() => selectTarget(recent.target)}>{recent.label}<ArrowRight size={17} /></button>}
    {choosingTarget && <div className="emote-targets" data-testid="emote-targets"><h3>{properties ? <><button type="button" aria-label="Back to reaction targets" onClick={() => setProperties(false)}><ArrowLeft size={17} /></button>Choose a property</> : 'To'}</h3>
      {properties ? <><label className="emote-property-search"><Search size={17} /><input aria-label="Search reaction properties" placeholder="Search the board" value={query} onChange={event => setQuery(event.target.value)} /></label><div className="emote-property-list">{board.filter(space => spaceName(space, room.theme).toLowerCase().includes(query.toLowerCase())).map(space => <button type="button" key={space.id} aria-label={`Target ${spaceName(space, room.theme)}`} onClick={() => selectTarget({ kind: 'property', propertyId: space.id })}><i style={{ background: space.color || '#a99b78' }} /><span>{spaceName(space, room.theme)}</span><small>{space.id}</small>{target.kind === 'property' && target.propertyId === space.id && <Check size={15} />}</button>)}</div></> : <div className="emote-target-list"><button type="button" onClick={() => selectTarget({ kind: 'table' })}><Users size={18} /><span>Everyone</span>{target.kind === 'table' && <Check size={16} />}</button>{players.map(player => <button type="button" key={player.id} aria-label={`Target ${player.name}`} onClick={() => selectTarget({ kind: 'player', playerId: player.id })}><i style={{ background: player.color }} /><span>{player.name}{player.id === playerId && <small>YOU</small>}</span>{target.kind === 'player' && target.playerId === player.id && <Check size={16} />}</button>)}<button type="button" hidden={isUno} onClick={() => setProperties(true)}><Search size={18} /><span>A property…</span><ArrowRight size={16} /></button></div>}
    </div>}
    {kind && <div className="emote-review" data-testid="emote-review"><strong>{emoteName(kind)} <ArrowRight size={16} /> {targetLabel}</strong><div><button type="button" className="btn ghost" onClick={() => { setKind(null); setChoosingTarget(false); }}>Cancel</button><button type="button" className="btn primary" disabled={disabled} onClick={() => submit(kind)}>{emoteStatus.pending ? 'Sending…' : kind === 'poop' ? 'Toss' : 'Send reaction'}</button></div></div>}
    {!connected ? <p className="emote-picker-status" role="status">Reconnect to send a reaction.</p> : emoteStatus.error ? <p className="emote-picker-status" role="status">{emoteStatus.error}</p> : cooling ? <p className="emote-picker-status" role="status">One moment before your next reaction.</p> : <p className="emote-picker-footnote">Reactions are shared with everyone at this table.</p>}
  </section>;
}
