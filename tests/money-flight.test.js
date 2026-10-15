import test from 'node:test';
import assert from 'node:assert/strict';
import { committedPayment, personalPayment } from '../src/payment-feedback.js';
import { advanceMoneyFeed, enqueueMoneyFlights, moneyNotes, flightNoise, MONEY_FLIGHT_DURATION, MAX_MONEY_FLIGHTS, MAX_ACTIVE_MONEY_FLIGHTS, MAX_MONEY_NOTES } from '../src/money-flight.js';

const initial = () => {
  const players = [{ id: 'a', name: 'Alex' }, { id: 'b', name: 'Blair' }, { id: 'c', name: 'Casey' }];
  return { code: 'NOTES1', theme: 'classic', serverNow: 10000, players, contracts: [], game: { edition: 'classic', rules: {}, players, log: [] } };
};
const event = (seq, type = 'moneyTransfer', fields = {}) => ({ id: `event-${seq}`, seq, type, at: new Date(10000).toISOString(), fromPlayerId: 'b', toPlayerId: 'a', amount: 75, ...fields });

test('shared cash mapping keeps all parties visible without changing personal feedback semantics', () => {
  const room = initial(), payment = event(2);
  const shared = committedPayment(room, payment);
  assert.equal(shared.amount, 75); assert.equal(shared.fromLabel, 'Blair'); assert.equal(shared.toLabel, 'Alex');
  assert.equal(personalPayment(room, 'c', payment), null);
  assert.deepEqual(personalPayment(room, 'a', payment), { ...shared, direction: 'incoming' });
  room.game.log = [event(1)];
  const cursor = advanceMoneyFeed(null, room).cursor;
  room.game.log.push(payment);
  assert.deepEqual(advanceMoneyFeed(cursor, room).payments[0], { ...shared, occurredAt: 10000, readyAt: 10120 });
});

test('first hydration, duplicate ACKs, stale snapshots and another room never replay banknotes', () => {
  const room = initial(); room.game.log = [event(4)];
  let update = advanceMoneyFeed(null, room); assert.deepEqual(update.payments, []);
  room.game.log.push(event(5)); update = advanceMoneyFeed(update.cursor, room);
  assert.equal(update.payments.length, 1);
  assert.deepEqual(advanceMoneyFeed(update.cursor, structuredClone(room)).payments, []);
  const stale = { ...room, game: { ...room.game, log: [event(4)] } };
  assert.equal(advanceMoneyFeed(update.cursor, stale).cursor.seq, 5);
  assert.deepEqual(advanceMoneyFeed(null, room).payments, []);
  assert.deepEqual(advanceMoneyFeed(update.cursor, { ...room, code: 'OTHER1' }).payments, []);
});

test('GO, rent and card money wait for the authoritative visible landing on every client', () => {
  const room = initial(); const baseline = advanceMoneyFeed(null, room).cursor;
  room.game.log = [event(1, 'payment', { fromPlayerId: null, toPlayerId: 'a', amount: 200, reason: 'Passing GO' }), event(2, 'passGo', { playerId: 'a' })];
  room.presentation = { endsAt: 15000, events: room.game.log };
  const first = advanceMoneyFeed(baseline, room), second = advanceMoneyFeed(baseline, structuredClone(room));
  assert.deepEqual(first, second); assert.equal(first.payments.length, 1);
  assert.equal(first.payments[0].readyAt, 15080);
  const flights = enqueueMoneyFlights([], first.payments, 10000);
  assert.equal(flights[0].startsAt, 15080); assert.equal(flights[0].endsAt, 15080 + MONEY_FLIGHT_DURATION);
  assert.equal(enqueueMoneyFlights([], first.payments, flights[0].endsAt).length, 0);
});

test('auction, group building and contract companions produce exactly one canonical cash flight', () => {
  const room = initial(), cursor = advanceMoneyFeed(null, room).cursor;
  room.contracts = [{ id: 'swap', title: 'House fund', status: 'active', activationSeq: 5, partyIds: ['a', 'b'], terms: { transfers: [{ fromPlayerId: 'a', toPlayerId: 'b', cash: 100 }, { fromPlayerId: 'b', toPlayerId: 'a', cash: 25 }] } }];
  room.game.log = [
    event(1, 'payment', { fromPlayerId: 'a', toPlayerId: null, amount: 50, reason: 'Auction' }),
    event(2, 'purchase', { playerId: 'a', amount: 50, propertyId: 1, auction: true }),
    event(3, 'buildGroup', { playerId: 'a', amount: 100, propertyIds: [1, 3] }),
    event(4, 'build', { playerId: 'a', amount: 50, propertyId: 1, groupBuildId: 'group' }),
    event(5, 'contract', { contractId: 'swap' }),
    event(6, 'transferProperty', { playerId: 'a', propertyId: 1 }),
    event(7, 'debt', { fromPlayerId: 'a', amount: 100 }),
  ];
  const payments = advanceMoneyFeed(cursor, room).payments;
  assert.deepEqual(payments.map(item => item.amount), [50, 100, 75]);
  assert.deepEqual(payments.map(item => item.toLabel), ['Bank', 'Bank', 'Blair']);
});

test('rapid payment bursts have a hard layer limit, retain server time and discard expired history', () => {
  const payments = Array.from({ length: 100 }, (_, i) => ({ id: `event-${i + 1}`, seq: i + 1, amount: 100, readyAt: 10000 }));
  const queue = enqueueMoneyFlights([], payments, 10000);
  assert.equal(queue.length, MAX_MONEY_FLIGHTS);
  for (let time = 10000; time < 21000; time += 100) assert(queue.filter(item => item.startsAt <= time && item.endsAt > time).length <= MAX_ACTIVE_MONEY_FLIGHTS);
  assert.equal(enqueueMoneyFlights(queue, [], 30000).length, 0);
  assert.equal(enqueueMoneyFlights([], payments, 10000 + MONEY_FLIGHT_DURATION).length, 0);
  assert.deepEqual(enqueueMoneyFlights(queue, payments, 10000), queue);
  const late = enqueueMoneyFlights([], payments.slice(0, 1), 10800)[0];
  assert.equal(late.startsAt, 10000); // A delayed receipt seeks ahead instead of restarting.
});

test('note denominations remain positive and bounded even for very large authoritative amounts', () => {
  assert.deepEqual(moneyNotes(75), [50, 20, 5]);
  assert.deepEqual(moneyNotes(1), [1]);
  for (const amount of [0, -1, 1.5, Infinity]) assert.deepEqual(moneyNotes(amount), []);
  const notes = moneyNotes(Number.MAX_SAFE_INTEGER);
  assert.equal(notes.length, MAX_MONEY_NOTES); assert(notes.every(value => value === 500));
  assert.equal(flightNoise(25, 3, 1), flightNoise(25, 3, 1));
  assert(flightNoise(25, 3, 1) >= 0 && flightNoise(25, 3, 1) < 1);
});
