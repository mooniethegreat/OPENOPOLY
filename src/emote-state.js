import { getBoard } from '../shared/board.js';
import { EMOTE_KINDS, EMOTE_DURATION_MS, EMOTE_VISIBLE_LIMIT } from '../shared/emotes.js';

/** Accept only a live canonical event belonging to the currently displayed room. */
export function normalizeIncomingEmote(event, room, now) {
  if (!room?.code || event?.roomCode !== room.code || typeof event.id !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(event.id) || !EMOTE_KINDS.includes(event.kind)) return null;
  if (!room.players?.some(player => player.id === event.senderId)) return null;
  if (!Number.isSafeInteger(event.startedAt) || !Number.isSafeInteger(event.endsAt) || event.endsAt - event.startedAt !== EMOTE_DURATION_MS || event.endsAt <= now || event.startedAt > now + 1000) return null;
  const target = event.target;
  let normalized;
  if (target?.kind === 'table') normalized = { kind: 'table' };
  else if (target?.kind === 'player' && room.players.some(player => player.id === target.playerId)) normalized = { kind: 'player', playerId: target.playerId };
  else if (target?.kind === 'property' && Number.isSafeInteger(target.propertyId) && getBoard(room.game || room.theme).some(space => space.id === target.propertyId)) normalized = { kind: 'property', propertyId: target.propertyId };
  else return null;
  return { id: event.id, roomCode: event.roomCode, senderId: event.senderId, kind: event.kind, target: normalized, startedAt: event.startedAt, endsAt: event.endsAt };
}

export function appendEmote(events, event, now) {
  return [...events.filter(item => item.endsAt > now && item.id !== event.id), event].slice(-EMOTE_VISIBLE_LIMIT);
}
