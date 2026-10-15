import { useCallback, useEffect, useRef, useState } from 'react';
import { createCommandId } from './action-gate.js';
import { normalizeIncomingEmote, appendEmote } from './emote-state.js';
import { EMOTE_COOLDOWN_MS, EMOTE_KINDS } from '../shared/emotes.js';

export function useEmotes({ room, playerId, connected, socketRef, playEmote }) {
  const [emotes, setEmotes] = useState([]);
  const [emoteStatus, setStatus] = useState({ pending: false, cooldownUntil: 0, error: '' });
  const roomRef = useRef(room), connection = useRef(connected), player = useRef(playerId), sound = useRef(playEmote);
  const clock = useRef({ serverNow: Date.now(), monotonic: performance.now() }), clockRoom = useRef(null), activeScope = useRef(null), flight = useRef(null), cooldown = useRef(0), seen = useRef(new Set()), acceptAfter = useRef(0);
  roomRef.current = room; connection.current = connected; player.current = playerId; sound.current = playEmote;
  if (Number.isFinite(room?.serverNow) && clockRoom.current !== room) {
    clock.current = { serverNow: room.serverNow, monotonic: room.clientReceivedMonotonicAt ?? performance.now() }; clockRoom.current = room;
  }
  const emoteServerNow = useCallback(() => clock.current.serverNow + Math.max(0, performance.now() - clock.current.monotonic), []);
  const reset = useCallback(() => {
    if (flight.current) { flight.current.resolve(false); flight.current = null; }
    setEmotes([]); setStatus({ pending: false, cooldownUntil: cooldown.current, error: '' });
  }, []);

  useEffect(() => {
    const scope = room?.code && playerId ? `${room.code}:${playerId}` : null;
    if (activeScope.current !== scope) { activeScope.current = scope; seen.current.clear(); cooldown.current = 0; }
    reset();
    if (!connected || !room?.code || !playerId) return;
    const socket = socketRef.current;
    if (!socket?.connected) return;
    acceptAfter.current = Math.floor(emoteServerNow());
    const receive = input => {
      if (!connection.current || `${roomRef.current?.code}:${player.current}` !== scope) return;
      try {
        const now = emoteServerNow(), event = normalizeIncomingEmote(input, roomRef.current, now);
        if (!event || seen.current.has(event.id)) return;
        seen.current.add(event.id); if (seen.current.size > 64) seen.current.delete(seen.current.values().next().value);
        // Hidden arrivals still consume their identity. A duplicate on resume
        // cannot replay them; delayed pre-resume packets also stay silent.
        if (document.hidden || event.startedAt < acceptAfter.current) return;
        setEmotes(previous => appendEmote(previous, event, now)); sound.current?.(event, now);
      } catch { /* A cosmetic event cannot interrupt the room or its action queue. */ }
    };
    const visibility = () => { if (document.hidden) reset(); else acceptAfter.current = Math.floor(emoteServerNow()); };
    socket.on('room:emote', receive); document.addEventListener('visibilitychange', visibility);
    return () => { socket.off('room:emote', receive); document.removeEventListener('visibilitychange', visibility); reset(); };
  }, [room?.code, playerId, connected, socketRef, emoteServerNow, reset]);

  useEffect(() => {
    if (!emotes.length) return;
    const timer = setTimeout(() => setEmotes(previous => previous.filter(event => event.endsAt > emoteServerNow())), Math.max(1, Math.min(...emotes.map(event => event.endsAt)) - emoteServerNow()));
    return () => clearTimeout(timer);
  }, [emotes, emoteServerNow]);

  const sendEmote = useCallback((kind, target = { kind: 'table' }) => {
    const socket = socketRef.current, current = roomRef.current, now = emoteServerNow();
    if (flight.current || document.hidden || !connection.current || !socket?.connected || !current?.code || !player.current) return Promise.resolve(false);
    if (!EMOTE_KINDS.includes(kind)) return Promise.resolve(false);
    if (cooldown.current > now) { setStatus({ pending: false, cooldownUntil: cooldown.current, error: 'Give the last reaction a moment.' }); return Promise.resolve(false); }
    let packet;
    try { packet = { clientId: createCommandId(), kind, target: structuredClone(target) }; } catch { return Promise.resolve(false); }
    return new Promise(resolve => {
      const request = { resolve, roomCode: current.code }; flight.current = request;
      setStatus({ pending: true, cooldownUntil: cooldown.current, error: '' });
      try {
        // Volatile delivery drops an offline packet. Emotes are never retried,
        // persisted, or placed in the game's money/action recovery queue.
        socket.volatile.timeout(2500).emit('emote:send', packet, (timeout, result) => {
          if (flight.current !== request) return;
          flight.current = null;
          if (timeout) { setStatus({ pending: false, cooldownUntil: cooldown.current, error: 'Reaction was not confirmed. It will not be resent.' }); resolve(false); return; }
          const retryAfter = result?.ok ? EMOTE_COOLDOWN_MS : Math.min(10000, Math.max(0, result?.retryAfterMs || 0));
          if (retryAfter) cooldown.current = emoteServerNow() + retryAfter;
          setStatus({ pending: false, cooldownUntil: cooldown.current, error: result?.ok ? '' : result?.error || 'Reaction could not be sent.' }); resolve(Boolean(result?.ok));
        });
      } catch { flight.current = null; setStatus({ pending: false, cooldownUntil: 0, error: 'Reaction could not be sent.' }); resolve(false); }
    });
  }, [socketRef, emoteServerNow]);
  return { emotes, sendEmote, emoteStatus, emoteServerNow };
}
