import { committedPayment } from './payment-feedback.js';

export const MONEY_FLIGHT_DURATION = 2600;
export const MAX_MONEY_FLIGHTS = 9;
export const MAX_ACTIVE_MONEY_FLIGHTS = 3;
export const MAX_MONEY_NOTES = 8;

// A room-wide cursor makes the table effect visible to observers as well as payees.
// First hydration is a baseline, including a reconnect that remounts the table.
export function advanceMoneyFeed(cursor, room) {
  if (!room?.code) return { cursor: null, payments: [] };
  const events = (room.game?.log || []).filter(event => Number.isSafeInteger(event.seq) && event.seq > 0);
  const high = Math.max(0, ...events.map(event => event.seq));
  if (cursor?.scope !== room.code) return { cursor: { scope: room.code, seq: high }, payments: [] };
  if (high <= cursor.seq) return { cursor, payments: [] };
  const timeline = room.presentation;
  const presented = new Set((timeline?.events || []).map(event => event.seq));
  const payments = events.filter(event => event.seq > cursor.seq).sort((a, b) => a.seq - b.seq).flatMap(event => {
    const payment = committedPayment(room, event);
    if (!payment) return [];
    const occurredAt = Date.parse(event.at);
    const committedAt = Number.isFinite(occurredAt) ? occurredAt : room.serverNow;
    if (!Number.isFinite(committedAt)) return [];
    // Movement-triggered rent/GO/cards wait for the visible landing. All clients
    // use the same server instant, rather than starting a fresh local replay.
    const readyAt = Math.max(committedAt + 120, presented.has(event.seq) && Number.isFinite(timeline?.endsAt) ? timeline.endsAt + 80 : 0);
    return [{ ...payment, occurredAt: committedAt, readyAt }];
  });
  return { cursor: { scope: room.code, seq: high }, payments };
}

// Three deterministic lanes cap simultaneous layers. A fast activity burst may
// omit decorative flights; every exact amount remains in the authoritative log.
export function enqueueMoneyFlights(queue, payments, serverNow) {
  if (!Number.isFinite(serverNow)) return [];
  const next = queue.filter(item => item.endsAt > serverNow).slice(0, MAX_MONEY_FLIGHTS);
  const lanes = Array(MAX_ACTIVE_MONEY_FLIGHTS).fill(-Infinity);
  for (const item of next) lanes[item.lane] = Math.max(lanes[item.lane], item.endsAt);
  const known = new Set(next.map(item => item.id));
  for (const payment of payments) {
    if (next.length >= MAX_MONEY_FLIGHTS) break;
    if (known.has(payment.id) || !Number.isFinite(payment.readyAt) || payment.readyAt + MONEY_FLIGHT_DURATION <= serverNow) continue;
    const lane = lanes.indexOf(Math.min(...lanes));
    const startsAt = Math.max(payment.readyAt, lanes[lane]);
    if (startsAt > serverNow + 6500 && startsAt > payment.readyAt) continue;
    const item = { ...payment, lane, startsAt, endsAt: startsAt + MONEY_FLIGHT_DURATION };
    next.push(item); known.add(item.id); lanes[lane] = item.endsAt;
  }
  return next;
}

const denominations = [500, 100, 50, 20, 10, 5, 1];
export function moneyNotes(amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) return [];
  const notes = [];
  for (const value of denominations) {
    const count = Math.min(Math.floor(amount / value), MAX_MONEY_NOTES - notes.length);
    for (let index = 0; index < count; index++) notes.push(value);
    amount -= count * value;
    if (notes.length === MAX_MONEY_NOTES) break;
  }
  return notes;
}

export function flightNoise(seq, index, salt = 0) {
  const value = Math.sin((seq * 31 + index * 137 + salt * 53) * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}
