import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, publicGame, chargePlayer, transferProperty } from '../shared/engine.js';
import { personalPayment, advancePaymentFeed, enqueuePayments } from '../src/payment-feedback.js';

const initial = () => ({ code: 'PAY001', theme: 'classic', players: [{ id: 'a', name: 'Alex' }, { id: 'b', name: 'Blair' }], contracts: [], game: { status: 'playing', edition: 'classic', rules: {}, players: [{ id: 'a', name: 'Alex' }, { id: 'b', name: 'Blair' }], log: [] } });
const event = (type, fields = {}, seq = 1) => ({ id: `event-${seq}`, seq, type, ...fields });

test('only completed cash events produce personal amounts, parties and reasons', () => {
  const room = initial();
  const rent = event('payment', { fromPlayerId: 'b', toPlayerId: 'a', amount: 50, reason: 'Rent: Boardwalk' });
  assert.deepEqual(personalPayment(room, 'a', rent), { id: 'event-1', seq: 1, amount: 50, from: 'b', to: 'a', fromLabel: 'Blair', toLabel: 'Alex', direction: 'incoming', reason: 'Rent: Boardwalk' });
  assert.equal(personalPayment(room, 'b', rent).direction, 'outgoing');
  assert.equal(personalPayment(room, 'observer', rent), null);
  const direct = personalPayment(room, 'a', event('moneyTransfer', { fromPlayerId: 'a', toPlayerId: 'b', amount: 15, note: 'Lunch' }));
  assert.equal(direct.toLabel, 'Blair'); assert.equal(direct.reason, 'Lunch');
  const bank = personalPayment(room, 'a', event('payment', { fromPlayerId: null, toPlayerId: 'a', amount: 200, reason: 'Passing GO' }));
  assert.equal(bank.fromLabel, 'Bank'); assert.equal(bank.direction, 'incoming');
  const tax = personalPayment(room, 'a', event('payment', { fromPlayerId: 'a', toPlayerId: null, amount: 100, reason: 'Tax', intoCenterPot: true }));
  assert.equal(tax.toLabel, 'Center pot');
  for (const type of ['debt', 'defaulted', 'passGo', 'bid', 'transferProperty', 'bankruptcy']) assert.equal(personalPayment(room, 'a', event(type, { playerId: 'a', fromPlayerId: 'a', toPlayerId: 'b', amount: 50 })), null, type);
  for (const amount of [0, -10, 2.5, Infinity, undefined]) assert.equal(personalPayment(room, 'a', { ...rent, amount }), null);
});

test('direct asset cash changes are mapped while auction and group-build companion logs are skipped', () => {
  const room = initial();
  for (const type of ['purchase', 'build', 'unmortgage', 'buildGroup']) {
    const payment = personalPayment(room, 'a', event(type, { playerId: 'a', amount: 100, propertyId: 1, propertyIds: [1, 3] }));
    assert.equal(payment.direction, 'outgoing', type); assert.equal(payment.toLabel, 'Bank');
  }
  for (const type of ['mortgage', 'sellBuilding', 'jackpot']) assert.equal(personalPayment(room, 'a', event(type, { playerId: 'a', amount: 30, propertyId: 1 })).direction, 'incoming', type);
  assert.equal(personalPayment(room, 'a', event('purchase', { playerId: 'a', amount: 100, auction: true })), null);
  assert.equal(personalPayment(room, 'a', event('build', { playerId: 'a', amount: 100, auction: true })), null);
  assert.equal(personalPayment(room, 'a', event('build', { playerId: 'a', amount: 100, groupBuildId: 'group-1' })), null);
  const summary = personalPayment(room, 'a', event('buildGroup', { playerId: 'a', amount: 1500, propertyIds: [6, 8, 9], groupBuildId: 'group-1' }));
  assert.equal(summary.amount, 1500);
  assert.match(summary.reason, /Oriental Avenue/);
});

test('an executed contract maps its actual net signed cash exchange and scheduled payments once', () => {
  const room = initial();
  room.contracts.push({ id: 'loan', title: 'Bike loan', partyIds: ['a', 'b'], status: 'active', activationSeq: 10, terms: { transfers: [{ fromPlayerId: 'a', toPlayerId: 'b', cash: 100 }, { fromPlayerId: 'b', toPlayerId: 'a', cash: 25 }] } });
  const activation = event('contract', { contractId: 'loan', partyIds: ['a', 'b'] }, 10);
  const outgoing = personalPayment(room, 'a', activation);
  assert.equal(outgoing.amount, 75); assert.equal(outgoing.direction, 'outgoing');
  assert.equal(outgoing.reason, 'Contract: Bike loan');
  assert.equal(personalPayment(room, 'b', activation).amount, 75);
  assert.equal(personalPayment(room, 'a', { ...activation, seq: 9 }), null);
  assert.equal(personalPayment(room, 'a', event('contractPayment', { fromPlayerId: 'b', toPlayerId: 'a', amount: 110, contractId: 'loan' }, 11)).reason, 'Contract payment: Bike loan');
  room.contracts[0].status = 'proposed'; assert.equal(personalPayment(room, 'a', activation), null);
  room.contracts[0].status = 'completed'; room.contracts[0].terms.transfers[1].cash = 100;
  assert.equal(personalPayment(room, 'a', activation), null); // A balanced swap moved no net cash.
});

test('hydration, duplicate ACK snapshots, out-of-order state and reconnect never replay known payments', () => {
  const room = initial();
  room.game.log = [event('moneyTransfer', { fromPlayerId: 'b', toPlayerId: 'a', amount: 10 }, 4)];
  let update = advancePaymentFeed(null, room, 'a'); assert.deepEqual(update.payments, []);
  const baseline = update.cursor;
  room.game.log.push(event('moneyTransfer', { fromPlayerId: 'b', toPlayerId: 'a', amount: 20 }, 5));
  update = advancePaymentFeed(baseline, room, 'a'); assert.equal(update.payments.length, 1); assert.equal(update.payments[0].amount, 20);
  assert.deepEqual(advancePaymentFeed(update.cursor, structuredClone(room), 'a').payments, []);
  const stale = { ...room, game: { ...room.game, log: room.game.log.slice(0, 1) } };
  assert.equal(advancePaymentFeed(update.cursor, stale, 'a').cursor.seq, 5);
  room.game.log.push(event('payment', { fromPlayerId: 'a', toPlayerId: null, amount: 50, reason: 'Jail fee' }, 6));
  const reconnect = advancePaymentFeed(update.cursor, room, 'a'); assert.equal(reconnect.payments.length, 1);
  assert.equal(reconnect.payments[0].direction, 'outgoing');
  assert.deepEqual(advancePaymentFeed(null, room, 'a').payments, []); // Full refresh baselines history.
  assert.deepEqual(advancePaymentFeed(reconnect.cursor, { ...room, code: 'OTHER1' }, 'a').payments, []);
  assert.deepEqual(advancePaymentFeed(reconnect.cursor, room, 'b').payments, []);
});

test('real GO, auction and mortgage-transfer events each yield only their actual cash movement', () => {
  const room = initial();
  const game = createGame(room.players, { seed: 42, firstPlayerId: 'a' });
  room.game = publicGame(game);
  const baseline = advancePaymentFeed(null, room, 'a').cursor;
  game.players[0].position = 37;
  applyAction(game, 'a', { type: 'roll' }, { dice: [1, 2] });
  room.game = publicGame(game);
  const go = advancePaymentFeed(baseline, room, 'a');
  assert.equal(go.payments.length, 1); assert.equal(go.payments[0].amount, 200);
  // A property auction records payment then purchase; the latter is descriptive.
  applyAction(game, 'a', { type: 'endTurn' });
  applyAction(game, 'b', { type: 'roll' }, { dice: [1, 2] });
  applyAction(game, 'b', { type: 'auction', propertyId: 3 });
  applyAction(game, 'a', { type: 'bid', amount: 25 });
  applyAction(game, 'b', { type: 'passAuction' });
  room.game = publicGame(game);
  const bought = advancePaymentFeed(go.cursor, room, 'a');
  assert.equal(bought.payments.length, 1); assert.equal(bought.payments[0].amount, 25);
  assert.match(bought.payments[0].reason, /^Auction:/);
  game.properties[3].mortgaged = true;
  transferProperty(game, 'a', 'b', 3);
  room.game = publicGame(game);
  const transferred = advancePaymentFeed(bought.cursor, room, 'a');
  assert.deepEqual(transferred.payments, []); // The previous owner did not receive the mortgage fee.
  const recipientFee = advancePaymentFeed({ scope: 'PAY001:b', seq: bought.cursor.seq }, room, 'b');
  assert.equal(recipientFee.payments.length, 1); assert.equal(recipientFee.payments[0].amount, 3);
  assert.equal(recipientFee.payments[0].direction, 'outgoing');
  // A mandatory unpaid charge has not moved money yet.
  game.players[0].cash = 0;
  chargePlayer(game, 'a', null, 100, 'Unpaid bill'); room.game = publicGame(game);
  assert.deepEqual(advancePaymentFeed(transferred.cursor, room, 'a').payments, []);
});

test('rapid bursts keep exact incoming/outgoing totals with bounded queued detail', () => {
  const room = initial();
  const movements = Array.from({ length: 100 }, (_, i) => personalPayment(room, 'a', event('moneyTransfer', { fromPlayerId: i % 2 ? 'a' : 'b', toPlayerId: i % 2 ? 'b' : 'a', amount: i + 1 }, i + 1)));
  const queue = enqueuePayments([], movements, 1000);
  assert(queue.length <= 3);
  assert(queue.every(group => group.items.length <= 3));
  assert.equal(queue.reduce((sum, group) => sum + group.amount, 0), 5050);
  assert.equal(queue.reduce((sum, group) => sum + group.count, 0), 100);
  assert.equal(queue.filter(group => group.direction === 'incoming').reduce((sum, group) => sum + group.amount, 0), 2500);
  assert.equal(queue.filter(group => group.direction === 'outgoing').reduce((sum, group) => sum + group.amount, 0), 2550);
  const merged = enqueuePayments([], [movements[0], { ...movements[0], id: 'next' }], 1000);
  assert.equal(merged.length, 1); assert.equal(merged[0].count, 2); assert.equal(merged[0].amount, 2);
});
