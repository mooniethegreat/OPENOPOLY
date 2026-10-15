import test from 'node:test';
import assert from 'node:assert/strict';
import { TURN_TIMEOUT_MS, timedTurnContext, reconcileTurnTimer, isTurnTimerDue } from '../server/turn-timers.js';
import { fixture } from './server-helpers.js';

const roomAt = (phase = 'roll') => ({ code: 'TIMER', status: 'playing', decisionVersion: 4, presentation: null, turnTimer: null,
  game: { status: 'playing', phase, turn: 7, currentPlayerId: 'a', players: [{ id: 'a', bankrupt: false }, { id: 'b', bankrupt: false }], pendingPurchase: null, pendingMortgage: null, debt: null, auction: null } });
const online = { connectedActive: true };

test('the production turn window is 30 seconds and both eligible phases use the same durable schema', () => {
  assert.equal(TURN_TIMEOUT_MS, 30000);
  for (const phase of ['roll', 'end']) {
    const room = roomAt(phase);
    assert.equal(reconcileTurnTimer(room, { ...online, at: 1000 }), true);
    assert.equal(typeof room.turnTimer.id, 'string');
    assert.deepEqual({ ...room.turnTimer, id: undefined }, { id: undefined, playerId: 'a', turn: 7, phase, startedAt: 1000, endsAt: 31000, decisionVersion: 4 });
    assert.equal(isTurnTimerDue(room, { ...online, at: 30999 }), false);
    assert.equal(isTurnTimerDue(room, { ...online, at: 31000 }), true);
  }
});

test('required choices, movement, inactive players and an empty table pause the clock', () => {
  const variants = [
    r => { r.game.phase = 'buy'; r.game.pendingPurchase = 3; },
    r => { r.game.phase = 'auction'; r.game.auction = {}; },
    r => { r.game.phase = 'debt'; r.game.debt = {}; },
    r => { r.game.pendingMortgage = {}; },
    r => { r.presentation = { startedAt: 1000, endsAt: 2000 }; },
    r => { r.game.players[0].bankrupt = true; },
    r => { r.status = 'finished'; },
    r => { r.game.status = 'finished'; },
  ];
  for (const alter of variants) {
    const room = roomAt(); reconcileTurnTimer(room, { ...online, at: 1000 }); alter(room);
    assert.equal(reconcileTurnTimer(room, { ...online, at: 1500 }), true);
    assert.equal(room.turnTimer, null); assert.equal(timedTurnContext(room, { ...online, at: 1500 }), null);
  }
  const room = roomAt(); reconcileTurnTimer(room, { ...online, at: 1000 });
  reconcileTurnTimer(room, { at: 2000, connectedActive: false }); assert.equal(room.turnTimer, null);
  reconcileTurnTimer(room, { ...online, at: 99000 }); assert.equal(room.turnTimer.endsAt, 129000);
});

test('other decisions rebind the timer financial version without extending its remaining window', () => {
  const room = roomAt('end'); reconcileTurnTimer(room, { ...online, at: 1000 });
  const initial = structuredClone(room.turnTimer); room.decisionVersion++;
  reconcileTurnTimer(room, { ...online, at: 19000 });
  assert.deepEqual(room.turnTimer, { ...initial, decisionVersion: 5 });
  assert.equal(room.decisionVersion, 5);
  assert.equal(isTurnTimerDue(room, { ...online, at: 31000 }), true);
});

test('substantive end activity refreshes but roll activity does not', () => {
  const room = roomAt('end'); reconcileTurnTimer(room, { ...online, at: 1000 });
  const initial = room.turnTimer.id;
  reconcileTurnTimer(room, { ...online, at: 15000, restartEnd: true });
  assert.notEqual(room.turnTimer.id, initial); assert.equal(room.turnTimer.endsAt, 45000);
  room.game.phase = 'roll'; reconcileTurnTimer(room, { ...online, at: 20000 });
  const roll = structuredClone(room.turnTimer);
  reconcileTurnTimer(room, { ...online, at: 40000, restartEnd: true }); assert.deepEqual(room.turnTimer, roll);
});

test('a new actor, turn, doubles window or resumed presentation receives a new clock', () => {
  const room = roomAt(); reconcileTurnTimer(room, { ...online, at: 1000 });
  let last = room.turnTimer.id;
  for (const alter of [r => { r.game.turn++; }, r => { r.game.currentPlayerId = 'b'; }]) {
    alter(room); reconcileTurnTimer(room, { ...online, at: 2000 });
    assert.notEqual(room.turnTimer.id, last); last = room.turnTimer.id;
  }
  reconcileTurnTimer(room, { ...online, at: 3000, forceRestart: true }); assert.notEqual(room.turnTimer.id, last);
  room.presentation = { endsAt: 5000 }; reconcileTurnTimer(room, { ...online, at: 4000 }); assert.equal(room.turnTimer, null);
  reconcileTurnTimer(room, { ...online, at: 5000 }); assert.equal(room.turnTimer.startedAt, 5000); assert.equal(room.turnTimer.endsAt, 35000);
});

test('a stale fingerprint or financial version cannot fire a timer', () => {
  for (const change of [r => { r.turnTimer.turn--; }, r => { r.turnTimer.playerId = 'b'; }, r => { r.turnTimer.phase = 'end'; }, r => { r.decisionVersion++; }, r => { r.game.pendingPurchase = 3; }]) {
    const room = roomAt(); reconcileTurnTimer(room, { ...online, at: 1000 }); change(room);
    assert.equal(isTurnTimerDue(room, { ...online, at: 99999 }), false);
  }
});

test('public clients cannot preempt a server timer receipt with a reserved command ID', async t => {
  const f = await fixture(t); const started = await f.start();
  const before = structuredClone(f.server.store.data.rooms[f.code]);
  const forged = await f.rawAction(0, { ...f.command({ type: 'chat:send', message: 'Poison receipt' }), commandId: `timer-${started.turnTimer.id}` });
  assert.equal(forged.ok, false); assert.match(forged.error, /reserved/);
  assert.deepEqual(f.server.store.data.rooms[f.code], before);
});

test('the actual server timeout rolls once and shares its authoritative presentation while disabling the clock', async t => {
  const f = await fixture(t, 2, { turnTimeoutMs: 100, presentationTiming: { rollMs: 500, stepMs: 25, directMs: 100, settleMs: 30, cardPauseMs: 100 } });
  const updates = [];
  for (const user of f.users) user.socket.on('room:state', room => { if (room.activity.some(event => event.type === 'auto-roll')) updates.push({ id: user.playerId, room }); });
  const started = await f.start(); assert.equal(started.turnTimer.phase, 'roll');
  const deadline = Date.now() + 3000;
  while (updates.length < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(updates.length >= 2);
  const frames = updates.slice(0, 2).map(update => update.room);
  assert.equal(frames[0].presentation.id, frames[1].presentation.id);
  assert.deepEqual(frames[0].presentation.dice, frames[1].presentation.dice);
  assert.equal(frames[0].turnTimer, null); assert.equal(frames[1].turnTimer, null);
  assert.equal(frames[0].game.log.filter(event => event.type === 'roll').length, 1);
  assert.equal(frames[0].activity.filter(event => event.type === 'auto-roll').length, 1);
  const privateRoom = f.server.store.data.rooms[f.code];
  assert.ok(privateRoom._commandReceipts.some(receipt => receipt.commandId === `timer-${started.turnTimer.id}`));
  assert.ok(privateRoom.decisionVersion > started.decisionVersion);
});
