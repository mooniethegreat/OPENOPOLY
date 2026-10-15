import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { io } from 'socket.io-client';
import { createApp } from '../server/app.js';
import { fixture } from './server-helpers.js';

const zeroPresentation = { rollMs: 0, stepMs: 0, directMs: 0, settleMs: 0, cardPauseMs: 0 };
const roomOf = f => f.server.store.data.rooms[f.code];
const rollCount = room => room.game.log.filter(event => event.type === 'roll').length;

async function until(predicate, message, timeout = 3500) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = predicate();
    if (result) return result;
    await pause(10);
  }
  assert.fail(message);
}

function seedFor(dice) {
  const next = seed => { let n = seed | 0; n ^= n << 13; n ^= n >>> 17; n ^= n << 5; return n >>> 0; };
  for (let seed = 1; seed < 1000000; seed++) {
    const first = next(seed), second = next(first);
    if (1 + Math.floor(first / 0x100000000 * 6) === dice[0] && 1 + Math.floor(second / 0x100000000 * 6) === dice[1]) return seed;
  }
  throw new Error('No deterministic fixture dice');
}

function pinRoll(f, { position = 37, dice = [1, 2], cash = 1500 } = {}) {
  f.server.store.transaction(data => {
    const game = data.rooms[f.code].game;
    game._randomState = seedFor(dice);
    Object.assign(game.players.find(player => player.id === game.currentPlayerId), { position, cash });
  });
}

function expire(f) {
  const timer = structuredClone(roomOf(f).turnTimer);
  assert(timer, 'An eligible phase has a timer');
  f.server.store.transaction(data => { data.rooms[f.code].turnTimer.endsAt = Date.now() - 1; });
  return timer;
}

async function started(t, options = {}, players = 2) {
  const f = await fixture(t, players, { turnTimeoutMs: 5000, ...options });
  await f.start();
  // The shared helper pins a deterministic starter after the actual opening
  // selection. A normal room action reconciles its test-only seat change.
  await f.success(0, { type: 'chat:send', text: 'Ready for timer integration' });
  assert.equal(roomOf(f).turnTimer?.playerId, f.users[0].playerId);
  return f;
}

test('a real server timeout rolls once for every socket, waits for presentation, then starts a full end window', async t => {
  const f = await started(t, { turnTimeoutMs: 500, presentationTiming: { ...zeroPresentation, rollMs: 160, stepMs: 15, settleMs: 20 } });
  pinRoll(f);
  const seen = f.users.map(() => []);
  f.users.forEach((user, index) => user.socket.on('room:state', room => { if (room.presentation) seen[index].push(room); }));
  const original = structuredClone(roomOf(f).turnTimer);
  assert.equal(original.endsAt - original.startedAt, 500);
  await until(() => seen.every(list => list.length), 'Both clients should receive the automatic roll');
  assert.equal(rollCount(roomOf(f)), 1);
  assert.deepEqual(seen[0][0].presentation, seen[1][0].presentation);
  assert.deepEqual(seen[0][0].presentation.dice, [1, 2]);
  assert.equal(seen[0][0].turnTimer, null);
  assert.equal(roomOf(f).activity.filter(event => event.type === 'auto-roll').length, 1);
  assert.equal(roomOf(f)._commandReceipts.filter(receipt => receipt.commandId === `timer-${original.id}`).length, 1);
  const end = await until(() => roomOf(f).turnTimer?.phase === 'end' && roomOf(f).turnTimer, 'End timer should start only after presentation');
  assert.equal(end.endsAt - end.startedAt, 500);
  assert(end.startedAt >= seen[0][0].presentation.endsAt);
  assert.equal(rollCount(roomOf(f)), 1);
});

test('an expired roll wins a delayed manual race and its server receipt prevents a second roll', async t => {
  const f = await started(t); pinRoll(f);
  const manual = f.command({ type: 'roll' });
  const old = expire(f);
  const late = await f.rawAction(0, manual);
  assert.equal(late.ok, false); assert.equal(late.errorCode, 'STALE_DECISION');
  assert.equal(rollCount(roomOf(f)), 1);
  assert.equal(roomOf(f).game.phase, 'end');
  assert.equal(roomOf(f)._commandReceipts.filter(receipt => receipt.commandId === `timer-${old.id}`).length, 1);
  await f.success(1, { type: 'chat:send', text: 'Duplicate deadline observation' });
  assert.equal(rollCount(roomOf(f)), 1);
  assert.equal(roomOf(f).activity.filter(event => event.type === 'auto-roll').length, 1);
});

test('a manual roll retires its deadline while an active presentation prevents timeout actions', async t => {
  const f = await started(t, { turnTimeoutMs: 250, presentationTiming: { ...zeroPresentation, rollMs: 1000, stepMs: 20, settleMs: 20 } });
  pinRoll(f);
  const old = structuredClone(roomOf(f).turnTimer);
  const rolled = await f.success(0, { type: 'roll' });
  assert(rolled.presentation);
  assert.equal(rolled.turnTimer, null);
  await pause(Math.max(0, old.endsAt - Date.now()) + 50);
  assert.equal(rollCount(roomOf(f)), 1);
  assert.equal(roomOf(f).game.turn, 1);
  assert.equal(roomOf(f).turnTimer, null);
  assert.equal(roomOf(f).activity.filter(event => event.type.startsWith('auto-')).length, 0);
});

test('doubles get fresh roll windows both immediately and after an explicit property decision', async t => {
  const f = await started(t);
  pinRoll(f, { position: 2, dice: [1, 1] });
  const before = structuredClone(roomOf(f).turnTimer);
  let update = await f.success(0, { type: 'roll' }); // Income tax leaves doubles available.
  assert.equal(update.game.phase, 'roll'); assert.equal(update.game.doubles, 1);
  assert.notEqual(update.turnTimer.id, before.id);
  assert.equal(update.turnTimer.endsAt - update.turnTimer.startedAt, 5000);
  pinRoll(f, { position: 1, dice: [1, 1] });
  update = await f.success(0, { type: 'roll' });
  assert.equal(update.game.phase, 'buy'); assert.equal(update.turnTimer, null);
  update = await f.success(0, { type: 'buy', propertyId: update.game.pendingPurchase });
  assert.equal(update.game.phase, 'roll'); assert.equal(update.game.doubles, 2);
  assert.equal(update.turnTimer.endsAt - update.turnTimer.startedAt, 5000);
  assert.notEqual(update.turnTimer.id, before.id);
});

test('end deadlines reset for the current player but ignore chat, unrelated finances and duplicate receipts', async t => {
  const f = await started(t); pinRoll(f);
  await f.success(0, { type: 'roll' });
  const ended = structuredClone(roomOf(f).turnTimer);
  assert.equal(ended.phase, 'end');
  await f.success(0, { type: 'chat:send', text: 'A message is not turn management' });
  assert.equal(roomOf(f).turnTimer.id, ended.id); assert.equal(roomOf(f).turnTimer.endsAt, ended.endsAt);
  const peerMoney = await f.success(1, { type: 'money:send', toPlayerId: f.users[0].playerId, amount: 1 });
  assert.equal(peerMoney.turnTimer.id, ended.id); assert.equal(peerMoney.turnTimer.endsAt, ended.endsAt);
  f.server.store.transaction(data => { data.rooms[f.code].game.properties[1].ownerId = f.users[0].playerId; data.rooms[f.code].turnTimer.endsAt = Date.now() + 1000; });
  const mortgage = f.command({ type: 'mortgage', propertyId: 1 });
  const managed = await f.rawAction(0, mortgage); assert.equal(managed.ok, true);
  assert.notEqual(managed.room.turnTimer.id, ended.id);
  assert.equal(managed.room.turnTimer.endsAt - managed.room.turnTimer.startedAt, 5000);
  const refreshed = structuredClone(managed.room.turnTimer);
  const replay = await f.rawAction(0, mortgage); assert.equal(replay.duplicate, true);
  assert.deepEqual(roomOf(f).turnTimer, refreshed);
  const oldEnd = expire(f);
  await f.success(1, { type: 'chat:send', text: 'Observe the due end' });
  assert.equal(roomOf(f).game.turn, 2);
  assert.equal(roomOf(f).game.currentPlayerId, f.users[1].playerId);
  assert.equal(roomOf(f).turnTimer.phase, 'roll');
  assert.equal(roomOf(f).turnTimer.endsAt - roomOf(f).turnTimer.startedAt, 5000);
  assert.notEqual(roomOf(f).turnTimer.id, oldEnd.id);
  assert.equal(roomOf(f).activity.filter(event => event.type === 'auto-end').length, 1);
});

test('buy, auction and mandatory debt have no automatic roll/end deadline', async t => {
  for (const phase of ['buy', 'auction', 'debt']) {
    const f = await started(t);
    pinRoll(f, phase === 'debt' ? { position: 1, cash: 0 } : { position: 0 });
    let room = await f.success(0, { type: 'roll' });
    if (phase === 'auction') room = await f.success(0, { type: 'auction', propertyId: room.game.pendingPurchase });
    assert.equal(room.game.phase, phase); assert.equal(room.turnTimer, null);
    const rolls = rollCount(roomOf(f));
    await f.success(1, { type: 'chat:send', text: `${phase} remains a player decision` });
    assert.equal(roomOf(f).turnTimer, null); assert.equal(rollCount(roomOf(f)), rolls);
  }
});

test('roll deadlines ignore unrelated finances and due auto actions still run the contract pipeline', async t => {
  const f = await started(t); pinRoll(f);
  const initial = structuredClone(roomOf(f).turnTimer);
  let update = await f.success(0, { type: 'contract:propose', counterpartyId: f.users[1].playerId, title: 'Automatic GO condition', terms: { transfers: [], obligations: [{ debtorId: f.users[0].playerId, creditorId: f.users[1].playerId, amount: 10, trigger: { type: 'passGo' } }] } });
  const contract = update.contracts[0];
  await f.success(0, { type: 'contract:sign', contractId: contract.id, revision: 1 });
  await f.success(1, { type: 'contract:sign', contractId: contract.id, revision: 1 });
  await f.success(1, { type: 'money:send', toPlayerId: f.users[0].playerId, amount: 1 });
  assert.equal(roomOf(f).turnTimer.id, initial.id); assert.equal(roomOf(f).turnTimer.endsAt, initial.endsAt);
  expire(f);
  await f.success(1, { type: 'chat:send', text: 'Observe an automatic pass GO' });
  assert.equal(rollCount(roomOf(f)), 1);
  assert.equal(roomOf(f).contracts[0].status, 'completed');
  assert.equal(roomOf(f).game.log.filter(event => event.type === 'contractPayment').length, 1);
  assert.deepEqual(roomOf(f).game.players.map(player => player.cash), [1691, 1509]);
});

test('a clock payment due with a turn timeout settles first and the auto action uses the resulting decision context', async t => {
  const f = await started(t); pinRoll(f);
  const update = await f.success(0, { type: 'contract:propose', counterpartyId: f.users[1].playerId, title: 'Same-deadline clock payment', terms: { transfers: [], obligations: [{ debtorId: f.users[0].playerId, creditorId: f.users[1].playerId, amount: 20, trigger: { type: 'atTime', at: new Date(Date.now() + 60000).toISOString() } }] } });
  const contract = update.contracts[0];
  await f.success(0, { type: 'contract:sign', contractId: contract.id, revision: 1 });
  await f.success(1, { type: 'contract:sign', contractId: contract.id, revision: 1 });
  const old = expire(f);
  f.server.store.transaction(data => { data.rooms[f.code].contracts[0].obligations[0].trigger.at = new Date(Date.now() - 1000).toISOString(); });
  await f.success(1, { type: 'chat:send', text: 'Observe both due deadlines' });
  const room = roomOf(f);
  assert.equal(rollCount(room), 1);
  assert.deepEqual(room.game.players.map(player => player.cash), [1680, 1520]);
  assert.equal(room.contracts[0].status, 'completed');
  assert.equal(room.game.log.filter(event => event.type === 'contractPayment').length, 1);
  assert(room.game.log.find(event => event.type === 'contractPayment').seq < room.game.log.find(event => event.type === 'roll').seq);
  assert.equal(room._commandReceipts.filter(receipt => receipt.commandId === `timer-${old.id}`).length, 1);
});

test('clients cannot reserve an automatic command identity or inject trusted timeout options', async t => {
  const f = await started(t); pinRoll(f);
  const timer = structuredClone(roomOf(f).turnTimer);
  const before = structuredClone(roomOf(f));
  for (const index of [0, 1]) {
    const poisoned = await f.rawAction(index, f.command({ type: 'chat:send', text: 'Preclaim the timer receipt', commandId: `timer-${timer.id}`, automaticTimerId: timer.id, skipDeadlineFlush: true }));
    assert.equal(poisoned.ok, false); assert.match(poisoned.error, /reserved/);
  }
  assert.deepEqual(roomOf(f), before);
  expire(f);
  await f.success(1, { type: 'chat:send', text: 'The genuine server timeout still works' });
  assert.equal(rollCount(roomOf(f)), 1);
  const receipts = roomOf(f)._commandReceipts.filter(receipt => receipt.commandId === `timer-${timer.id}`);
  assert.equal(receipts.length, 1); assert.equal(receipts[0].playerId, f.users[0].playerId);
});

test('only connected solvent seats keep deadlines running, and resuming arms a fresh window', async t => {
  const f = await started(t, {}, 3);
  f.server.store.transaction(data => { const game = data.rooms[f.code].game; game.players[0].bankrupt = true; game.currentPlayerId = f.users[1].playerId; });
  await f.success(0, { type: 'chat:send', text: 'Spectating this game' });
  const old = structuredClone(roomOf(f).turnTimer);
  f.users[1].socket.disconnect(); f.users[2].socket.disconnect();
  await until(() => roomOf(f).turnTimer === null, 'No active online seats should pause deadlines');
  await f.success(0, { type: 'chat:send', text: 'A spectator does not resume the clock' });
  assert.equal(roomOf(f).turnTimer, null); assert.equal(rollCount(roomOf(f)), 0);
  const resumedAt = Date.now();
  await f.connect(f.users[1]);
  const resumed = await until(() => roomOf(f).turnTimer, 'An active reconnect should resume the clock');
  assert.notEqual(resumed.id, old.id);
  assert(resumed.startedAt >= resumedAt);
  assert.equal(resumed.endsAt - resumed.startedAt, 5000);
  assert.equal(rollCount(roomOf(f)), 0);
});

test('restart disarms an expired saved timer without rolling and active reconnect starts fresh', async t => {
  const f = await started(t); pinRoll(f);
  const old = expire(f);
  const original = structuredClone(roomOf(f));
  await f.server.close();
  const restarted = createApp({ storePath: f.storePath, turnTimeoutMs: 5000, presentationTiming: zeroPresentation });
  t.after(() => restarted.close());
  const address = await restarted.listen(0, '127.0.0.1');
  const saved = restarted.store.data.rooms[f.code];
  assert.equal(saved.turnTimer, null); assert.deepEqual(saved.game, original.game);
  assert.deepEqual(saved._commandReceipts, original._commandReceipts);
  const socket = io(`http://127.0.0.1:${address.port}`, { auth: { roomCode: f.code, sessionToken: f.users[0].sessionToken }, transports: ['websocket'], reconnection: false });
  t.after(() => socket.disconnect());
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  const resumed = restarted.store.data.rooms[f.code].turnTimer;
  assert(resumed); assert.notEqual(resumed.id, old.id);
  assert.equal(resumed.endsAt - resumed.startedAt, 5000);
  assert.equal(rollCount(restarted.store.data.rooms[f.code]), 0);
});
