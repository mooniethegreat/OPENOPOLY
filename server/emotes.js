import { randomUUID } from 'node:crypto';
import { getBoard } from '../shared/board.js';
import { EMOTE_KINDS, EMOTE_DURATION_MS, EMOTE_COOLDOWN_MS } from '../shared/emotes.js';

const RECEIPT_TTL_MS = 60000;
const ROOM_BURST_MS = 3000;
const ROOM_BURST_LIMIT = 8;
const CLIENT_ID = /^[A-Za-z0-9_-]{16,100}$/;
function fail(condition, message, code = 'INVALID_EMOTE', retryAfterMs) {
  if (condition) return;
  const error = new Error(message); error.code = code;
  if (retryAfterMs) error.retryAfterMs = Math.ceil(retryAfterMs);
  throw error;
}
function fields(value, allowed) {
  fail(value && typeof value === 'object' && !Array.isArray(value), 'Choose a valid reaction and target');
  fail(Object.keys(value).every(key => allowed.includes(key)), 'Reaction contains an unsupported field');
}
function normalize(room, actorId, input) {
  fields(input, ['clientId', 'kind', 'target']);
  fail(typeof input.clientId === 'string' && CLIENT_ID.test(input.clientId), 'A valid reaction identifier is required');
  fail(EMOTE_KINDS.includes(input.kind), 'Choose a supported reaction');
  fail(room?.players?.some(player => player.id === actorId), 'Your seat is no longer in this room', 'EMOTE_UNAUTHORIZED');
  const target = input.target;
  fields(target, ['kind', ...(target?.kind === 'player' ? ['playerId'] : target?.kind === 'property' ? ['propertyId'] : [])]);
  if (target.kind === 'table') return { kind: input.kind, target: { kind: 'table' } };
  if (target.kind === 'player') {
    fail(typeof target.playerId === 'string' && target.playerId.length <= 100 && room.players.some(player => player.id === target.playerId), 'Choose a player at this table');
    return { kind: input.kind, target: { kind: 'player', playerId: target.playerId } };
  }
  fail(room.gameType !== 'uno' && target.kind === 'property' && Number.isSafeInteger(target.propertyId) && getBoard(room.game || room.theme).some(space => space.id === target.propertyId), room.gameType === 'uno' ? 'Choose the table or a player for an OpenUno reaction' : 'Choose a space on this board');
  return { kind: input.kind, target: { kind: 'property', propertyId: target.propertyId } };
}

/** Ephemeral transport receipts and limits; this module never opens a RoomStore. */
export function createEmoteChannel() {
  const seats = new Map(), rooms = new Map();
  function cleanup(at = Date.now()) {
    for (const [key, seat] of seats) {
      for (const [id, receipt] of seat.receipts) if (receipt.expiresAt <= at) seat.receipts.delete(id);
      if (seat.lastSeen < at - RECEIPT_TTL_MS * 2) seats.delete(key);
    }
    for (const [code, timestamps] of rooms) {
      const live = timestamps.filter(stamp => stamp > at - ROOM_BURST_MS);
      if (live.length) rooms.set(code, live); else rooms.delete(code);
    }
  }
  return {
    cleanup,
    clear() { seats.clear(); rooms.clear(); },
    send(room, actorId, input, at = Date.now()) {
      // A seat cannot bypass the shared cooldown by opening another socket.
      const key = `${room.code}:${actorId}`;
      cleanup(at);
      const seat = seats.get(key) || { nextAllowedAt: 0, attempts: [], receipts: new Map(), lastSeen: at };
      seat.lastSeen = at; seat.attempts = seat.attempts.filter(stamp => stamp > at - 10000); seats.set(key, seat);
      fail(seat.attempts.length < 24, 'Too many reactions. Please wait a moment.', 'EMOTE_RATE_LIMIT', seat.attempts[0] + 10000 - at);
      seat.attempts.push(at);
      const request = normalize(room, actorId, input);
      const fingerprint = JSON.stringify(request), previous = seat.receipts.get(input.clientId);
      if (previous) {
        fail(previous.fingerprint === fingerprint, 'That reaction identifier was already used for a different reaction', 'EMOTE_ID_CONFLICT');
        return { duplicate: true, id: previous.id, event: null };
      }
      fail(at >= seat.nextAllowedAt, 'Give the last reaction a moment.', 'EMOTE_COOLDOWN', seat.nextAllowedAt - at);
      const burst = (rooms.get(room.code) || []).filter(stamp => stamp > at - ROOM_BURST_MS);
      fail(burst.length < ROOM_BURST_LIMIT, 'The table has several reactions. Please wait a moment.', 'EMOTE_RATE_LIMIT', burst[0] + ROOM_BURST_MS - at);
      const event = { id: randomUUID(), roomCode: room.code, senderId: actorId, ...request, startedAt: at, endsAt: at + EMOTE_DURATION_MS };
      seat.nextAllowedAt = at + EMOTE_COOLDOWN_MS;
      seat.receipts.set(input.clientId, { fingerprint, id: event.id, expiresAt: at + RECEIPT_TTL_MS });
      while (seat.receipts.size > 48) seat.receipts.delete(seat.receipts.keys().next().value);
      rooms.set(room.code, [...burst, at]);
      return { duplicate: false, id: event.id, event };
    },
  };
}
