import React, { useEffect, useRef, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { useGame } from './game-context.jsx';
import './turn-countdown.css';

export default function TurnCountdown() {
  const { room, game, presentation, connected } = useGame();
  const timer = room?.turnTimer;
  const anchor = useRef(null);
  const [, tick] = useState(0);
  // Parent time already includes the shared server-clock calibration. Only this
  // label ticks while idle; monotonic elapsed time survives wall-clock changes.
  const timeValid = Number.isFinite(presentation.serverTime);
  if (timeValid && (!anchor.current || anchor.current.roomCode !== room?.code || anchor.current.serverTime !== presentation.serverTime)) anchor.current = { roomCode: room?.code, serverTime: presentation.serverTime, monotonic: performance.now() };
  const visible = Boolean(timeValid && connected && game?.status === 'playing' && timer && Number.isFinite(timer.endsAt) && timer.turn === game.turn && timer.playerId === game.currentPlayerId && timer.phase === game.phase && ['roll', 'end'].includes(timer.phase) && !presentation.active && !game.auction && !game.debt && !game.pendingMortgage);
  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(() => tick(value => value + 1), 250);
    return () => clearInterval(interval);
  }, [visible, timer?.id, timer?.endsAt]);
  if (!visible) return null;
  const now = anchor.current.serverTime + Math.max(0, performance.now() - anchor.current.monotonic);
  const remaining = Math.max(0, Math.ceil((timer.endsAt - now) / 1000));
  const time = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
  const label = timer.phase === 'roll' ? 'Auto-roll in' : 'Turn ends in';
  return <div className={`turn-countdown ${remaining <= 5 ? 'ending-soon' : ''}`} role="timer" aria-live="off" aria-label={`${label} ${time}`} title={remaining ? 'The server advances the turn at this deadline.' : 'Waiting for the server to advance the turn.'} data-testid="turn-countdown" data-turn-timer-id={timer.id} data-deadline={timer.endsAt} data-remaining={remaining} data-timer-phase={timer.phase}><Clock3 size={15} aria-hidden="true" /><span>{label} <b>{time}</b></span></div>;
}
