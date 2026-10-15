import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { io } from 'socket.io-client';
import { createApp } from '../server/app.js';
import { sendChat, CHAT_HISTORY_LIMIT } from '../server/chat.js';
import { chargePlayer, createGame, applyAction, publicGame } from '../shared/engine.js';
import { createPresentation, isPresentationActive, movementPath, PRESENTATION_TIMING } from '../shared/presentation.js';
import { fixture } from './server-helpers.js';

const shortTiming = { rollMs: 450, stepMs: 20, settleMs: 30, cardPauseMs: 30, directMs: 50 };

function stateWhen(socket, predicate, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off('room:state', listener); reject(new Error('Expected synchronized room update')); }, timeout);
    function listener(room) {
      if (!predicate(room)) return;
      clearTimeout(timer);
      socket.off('room:state', listener);
      resolve(room);
    }
    socket.on('room:state', listener);
  });
}

function seedFor(dice) {
  const next = seed => { let value = seed | 0; value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return value >>> 0; };
  for (let seed = 1; seed < 1000000; seed++) {
    const first = next(seed), second = next(first);
    if (1 + Math.floor(first / 0x100000000 * 6) === dice[0] && 1 + Math.floor(second / 0x100000000 * 6) === dice[1]) return seed;
  }
  throw new Error('No deterministic test seed');
}

function pinRoll(f, values = {}, dice = [1, 2]) {
  f.server.store.transaction(data => {
    const game = data.rooms[f.code].game;
    game.currentPlayerId = f.users[0].playerId;
    game.phase = 'roll'; game._resumePhase = 'roll'; game.pendingPurchase = null;
    game._randomState = seedFor(dice);
    Object.assign(game.players[0], values);
  });
}

test('movement paths preserve forward wraps, backwards cards, center starts and direct jail', () => {
  assert.deepEqual(movementPath(38, 2), [39, 0, 1, 2]);
  assert.deepEqual(movementPath(2, 39, { back: true }), [1, 0, 39]);
  assert.deepEqual(movementPath(-1, 3, { steps: 4 }), [0, 1, 2, 3]);
  assert.deepEqual(movementPath(30, 10, { direct: true }), [10]);
  assert.deepEqual(movementPath(undefined, 10), []);
});

test('a card chain has sequential moves and dice-only jail attempts have a bounded shared timeline', () => {
  const events = [
    { type: 'roll', seq: 1, playerId: 'a', dice: [1, 2] },
    { type: 'move', seq: 2, playerId: 'a', from: 33, to: 36, path: [34, 35, 36] },
    { type: 'card', seq: 3, playerId: 'a', cardId: 'chance-back' },
    { type: 'move', seq: 4, playerId: 'a', from: 36, to: 33, path: [35, 34, 33], back: true },
  ];
  const presentation = createPresentation(events, { id: 'same-on-all-clients', startedAt: 10000 });
  assert.equal(presentation.rollEndsAt, 11500);
  assert.equal(presentation.moves[0].startedAt, presentation.rollEndsAt);
  assert.ok(presentation.moves[1].startedAt > presentation.moves[0].endsAt);
  assert.deepEqual(presentation.moves[1].path, [35, 34, 33]);
  assert.equal(isPresentationActive(presentation, presentation.endsAt), false);
  assert.equal(createPresentation([{ type: 'payment' }]), null);
  const attempt = createPresentation([events[0], { type: 'jailAttempt' }], { startedAt: 0 });
  assert.deepEqual(attempt.moves, []);
  assert.equal(attempt.endsAt, PRESENTATION_TIMING.rollMs + PRESENTATION_TIMING.settleMs);
  const long = createPresentation([events[0], ...Array.from({ length: 10 }, () => ({ type: 'move', playerId: 'a', from: 0, to: 39 }))], { startedAt: 0 });
  assert.ok(long.endsAt <= PRESENTATION_TIMING.maxTotalMs, 'Long card chains have a capped total duration');
});

test('engine events give presentation a real backward path, jail origin and primary utility dice', () => {
  const players = [{ id: 'a' }, { id: 'b' }];
  const game = createGame(players, { firstPlayerId: 'a', seed: 4 });
  game.players[0].position = 33;
  const back = 'chance-back-three';
  game._decks.chance = [back, ...game._decks.chance.filter(id => id !== back)];
  applyAction(game, 'a', { type: 'roll' }, { dice: [1, 2] });
  assert.deepEqual(game.log.filter(event => event.type === 'move')[1].path, [35, 34, 33]);
  const jail = createGame(players, { firstPlayerId: 'a', seed: 4 });
  jail.players[0].position = 24;
  applyAction(jail, 'a', { type: 'roll' }, { dice: [3, 3] });
  const jailPresentation = createPresentation(jail.log);
  assert.deepEqual(jailPresentation.moves.at(-1), {
    playerId: 'a', from: 30, to: 10, path: [10], direct: true,
    startedAt: jailPresentation.moves.at(-1).startedAt,
    endsAt: jailPresentation.moves.at(-1).endsAt,
  });
  const utility = createPresentation([
    { type: 'roll', playerId: 'a', dice: [1, 2] },
    { type: 'utilityRoll', playerId: 'a', dice: [6, 6] },
  ]);
  assert.deepEqual(utility.dice, [1, 2]);
  assert.deepEqual(utility.events.at(-1).dice, [6, 6]);
  assert.equal(publicGame(game)._decks, undefined);
});

test('roll timeline broadcasts identically, guards actions, allows conversation, and unlocks by timer', async t => {
  const f = await fixture(t, 2, { presentationTiming: shortTiming });
  await f.start();
  const proposal = await f.success(0, { type: 'contract:propose', counterpartyId: f.users[1].playerId, terms: { customTerms: 'Test cancellation during dice' } });
  pinRoll(f);
  const guestUpdate = stateWhen(f.users[1].socket, room => room.presentation?.dice);
  const room = await f.success(0, { type: 'roll' });
  const guest = await guestUpdate;
  assert.deepEqual(guest.presentation, room.presentation);
  assert.equal(typeof room.serverNow, 'number');
  assert.deepEqual(room.presentation.moves[0].path, [1, 2, 3]);
  assert.equal(room.game.pendingPurchase, 3, 'Rules resolve atomically before presentation');
  const unlocked = stateWhen(f.users[1].socket, update => !update.presentation && update.version > room.version);
  for (const command of [
    { type: 'buy' }, { type: 'endTurn' }, { type: 'money:send', toPlayerId: f.users[1].playerId, amount: 1 },
    { type: 'contract:sign', contractId: proposal.contracts[0].id, revision: 1 },
  ]) {
    const denied = await f.action(0, command);
    assert.equal(denied.ok, false);
    assert.match(denied.error, /movement to finish/);
  }
  assert.equal((await f.action(1, { type: 'chat:send', text: 'Nice roll' })).ok, true);
  assert.equal((await f.action(1, { type: 'vote:propose', title: 'Pause after turn?', rule: 'majority' })).ok, true);
  assert.equal((await f.action(0, { type: 'room:appearance', appearance: { palette: 'ocean', mode: 'dark' } })).ok, true);
  assert.equal((await f.action(1, { type: 'contract:reject', contractId: proposal.contracts[0].id })).ok, true);
  const finished = await unlocked;
  assert.equal(finished.game.pendingPurchase, 3);
  const bought = await f.success(0, { type: 'buy' });
  assert.equal(bought.game.properties[3].ownerId, f.users[0].playerId);
  const persisted = JSON.parse(fs.readFileSync(f.storePath, 'utf8')).rooms[f.code];
  assert.equal(persisted.serverNow, undefined);
  assert.equal(persisted.presentation, null);
});

test('Inland opening move and jail attempts publish the same authoritative presentation contract', async t => {
  const f = await fixture(t, 2, { theme: 'inland-empire', presentationTiming: shortTiming });
  const room = await f.success(0, { type: 'room:start' });
  const firstRoll = room.game.log.find(event => event.type === 'roll');
  assert.equal(room.presentation.playerId, room.game.currentPlayerId);
  assert.deepEqual(room.presentation.dice, firstRoll.dice);
  assert.equal(room.presentation.moves[0].from, -1);
  assert.equal(room.presentation.moves[0].path[0], 0);
  assert.equal(room.presentation.moves[0].path.at(-1), room.presentation.moves[0].to);
  await stateWhen(f.users[0].socket, update => !update.presentation);
  pinRoll(f, { position: 10, inJail: true, jailTurns: 0 });
  const jailed = await f.success(0, { type: 'roll' });
  assert.deepEqual(jailed.presentation.moves, []);
  assert.deepEqual(jailed.presentation.dice, [1, 2]);
  assert.equal(jailed.game.players[0].position, 10);
});

test('rejoin and restart seek an active saved timeline; expired timeline is never replayed', async t => {
  const f = await fixture(t, 2, { presentationTiming: { ...shortTiming, rollMs: 1100 } });
  await f.start(); pinRoll(f);
  const rolling = await f.success(0, { type: 'roll' });
  const rejoin = await f.post(`/api/rooms/${f.code}/join`, { sessionToken: f.users[0].sessionToken });
  assert.deepEqual(rejoin.data.room.presentation, rolling.presentation);
  await f.server.close();
  const restarted = createApp({ storePath: f.storePath });
  t.after(() => restarted.close());
  const address = await restarted.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { Authorization: `Bearer ${f.users[0].sessionToken}` };
  const restored = (await (await fetch(`${base}/api/rooms/${f.code}`, { headers })).json()).room;
  assert.deepEqual(restored.presentation, rolling.presentation);
  const socket = io(base, { transports: ['websocket'], reconnection: false, auth: { roomCode: f.code, sessionToken: f.users[0].sessionToken } });
  t.after(() => socket.disconnect());
  const expired = await stateWhen(socket, room => !room.presentation);
  assert.ok(expired.version > rolling.version);
  assert.equal((await (await fetch(`${base}/api/rooms/${f.code}`, { headers })).json()).room.presentation, null);
  assert.equal(restarted.store.data.rooms[f.code].presentation, null);
});

test('chat validates plain text, bounds durable history, authenticates sender and shares a per-seat rate limit', async t => {
  const f = await fixture(t);
  let room = await f.success(0, { type: 'chat:send', text: '  hello\u0000 friends  ' });
  assert.deepEqual(room.chat.map(message => message.text), ['hello friends']);
  assert.equal(room.chat[0].playerId, f.users[0].playerId);
  assert.equal((await f.action(0, { type: 'chat:send', text: 'forged', playerId: f.users[1].playerId })).ok, false);
  assert.equal((await f.action(0, { type: 'chat:send', text: 'x'.repeat(501) })).ok, false);
  assert.equal((await f.action(0, { type: 'chat:send', text: '  ' })).ok, false);
  const second = await f.connect(f.users[0]);
  for (let index = 0; index < 4; index++) assert.equal((await second.timeout(3000).emitWithAck('action', f.command({ type: 'chat:send', text: `Message ${index}` }))).ok, true);
  const limited = await f.action(0, { type: 'chat:send', text: 'Too many' });
  assert.equal(limited.ok, false);
  assert.match(limited.error, /Too many/);
  room = await f.success(1, { type: 'chat:send', text: 'Other seat still works' });
  assert.equal(room.chat.at(-1).playerId, f.users[1].playerId);
  const history = { chat: [] };
  for (let index = 0; index < 160; index++) sendChat(history, 'a', { type: 'chat:send', text: String(index) });
  assert.equal(history.chat.length, CHAT_HISTORY_LIMIT);
  assert.equal(history.chat[0].text, '10');
  assert.equal(history.chat.at(-1).text, '159');
  assert.ok(JSON.parse(fs.readFileSync(f.storePath, 'utf8')).rooms[f.code].chat.length > 0);
});

test('bankrupt seats retain room chat while transfer actions reject inactive players', async t => {
  const f = await fixture(t, 3);
  await f.start();
  f.server.store.transaction(data => { data.rooms[f.code].game.players[0].bankrupt = true; });
  assert.equal((await f.action(0, { type: 'chat:send', text: 'Still at the table' })).ok, true);
  assert.equal((await f.action(0, { type: 'money:send', toPlayerId: f.users[1].playerId, amount: 1 })).ok, false);
  assert.equal((await f.action(1, { type: 'money:send', toPlayerId: f.users[0].playerId, amount: 1 })).ok, false);
});

test('money sends are atomic, authenticated, out of turn and cannot spend reserved bids', async t => {
  const f = await fixture(t);
  await f.start();
  const [a, b] = f.users.map(user => user.playerId);
  let room = await f.success(1, { type: 'money:send', toPlayerId: a, amount: 75, note: 'Thanks' });
  assert.deepEqual(room.game.players.map(player => player.cash), [1575, 1425]);
  assert.equal(room.game.log.at(-1).type, 'moneyTransfer');
  assert.equal(room.game.log.at(-1).fromPlayerId, b);
  const before = structuredClone(f.server.store.data.rooms[f.code]);
  for (const command of [
    { type: 'money:send', toPlayerId: a, amount: 0 },
    { type: 'money:send', toPlayerId: a, amount: 1.5 },
    { type: 'money:send', toPlayerId: a, amount: 2000 },
    { type: 'money:send', toPlayerId: b, amount: 1 },
    { type: 'money:send', toPlayerId: 'missing', amount: 1 },
    { type: 'money:send', toPlayerId: a, amount: 1, fromPlayerId: a },
  ]) assert.equal((await f.action(1, command)).ok, false);
  assert.deepEqual(f.server.store.data.rooms[f.code], before);
  f.server.store.transaction(data => {
    const game = data.rooms[f.code].game;
    game.auction = { kind: 'property', propertyId: 1, currentBid: 1400, highestBidderId: b, eligiblePlayerIds: [a, b], passedPlayerIds: [] };
    game.phase = 'auction';
  });
  assert.equal((await f.action(1, { type: 'money:send', toPlayerId: a, amount: 26 })).ok, false);
  room = await f.success(1, { type: 'money:send', toPlayerId: a, amount: 25 });
  assert.equal(room.game.players[1].cash, 1400);
  assert.equal(room.game.auction.currentBid, 1400);
});

test('money rescues mandatory debt without letting the donor leak debt or lose pending card effects', async t => {
  const f = await fixture(t, 3);
  await f.start();
  const [a, b, c] = f.users.map(user => user.playerId);
  f.server.store.transaction(data => {
    const game = data.rooms[f.code].game;
    game.players[0].cash = 25;
    chargePlayer(game, a, c, 100, 'Mandatory rent');
    game._effects.push({ type: 'move', playerId: a, steps: 3 });
  });
  const before = structuredClone(f.server.store.data.rooms[f.code]);
  assert.equal((await f.action(0, { type: 'money:send', toPlayerId: b, amount: 1 })).ok, false);
  assert.deepEqual(f.server.store.data.rooms[f.code], before);
  const room = await f.success(1, { type: 'money:send', toPlayerId: a, amount: 100 });
  assert.equal(room.game.debt, null);
  assert.deepEqual(room.game.players.map(player => player.cash), [25, 1400, 1600]);
  assert.equal(room.game.players[0].position, 3);
  assert.equal(room.game.pendingPurchase, 3);
  assert.ok(room.game.log.some(event => event.type === 'debtCleared'));
});

test('a rescue processes resumed GO and landing obligations once and presents the recipient rather than the donor', async t => {
  const f = await fixture(t, 3, { presentationTiming: shortTiming });
  await f.start();
  const [a, b, c] = f.users.map(user => user.playerId);
  const proposed = await f.success(0, { type: 'contract:propose', counterpartyId: b, terms: { obligations: [{ debtorId: a, creditorId: b, amount: 50, trigger: { type: 'passGo' } }] } });
  const contractId = proposed.contracts[0].id;
  for (const index of [0, 1]) await f.success(index, { type: 'contract:sign', contractId, revision: 1 });
  f.server.store.transaction(data => {
    const game = data.rooms[f.code].game;
    Object.assign(game.players[0], { cash: 25, position: 39 });
    chargePlayer(game, a, c, 100, 'Mandatory rent');
    game._effects.push({ type: 'move', playerId: a, steps: 2 });
  });
  const room = await f.success(1, { type: 'money:send', toPlayerId: a, amount: 75 });
  assert.equal(room.game.debt, null);
  assert.deepEqual(room.game.players.map(player => player.cash), [150, 1475, 1600]);
  assert.equal(room.contracts[0].obligations[0].paidCount, 1);
  assert.equal(room.game.log.filter(event => event.type === 'contractPayment').length, 1);
  assert.equal(room.presentation.playerId, a);
  assert.equal(room.presentation.dice, null);
  assert.deepEqual(room.presentation.moves[0].path, [0, 1]);
  assert.ok(room.presentation.events.some(event => event.type === 'contractPayment'));
});

test('legacy rooms project defaults and room versions advance only after committed changes', async t => {
  const f = await fixture(t);
  const initial = f.server.publicRoom(f.server.store.data.rooms[f.code]);
  const changed = await f.success(0, { type: 'chat:send', text: 'Versioned message' });
  assert.equal(changed.version, initial.version + 1);
  assert.equal((await f.action(0, { type: 'money:send', toPlayerId: f.users[1].playerId, amount: 1 })).ok, false);
  assert.equal(f.server.store.data.rooms[f.code].version, changed.version);
  f.server.store.transaction(data => { const room = data.rooms[f.code]; delete room.version; delete room.chat; delete room.presentation; });
  const legacy = f.server.publicRoom(f.server.store.data.rooms[f.code]);
  assert.equal(legacy.version, 0);
  assert.deepEqual(legacy.chat, []);
  assert.equal(legacy.presentation, null);
  const restored = await f.success(1, { type: 'chat:send', text: 'Migrated on first mutation' });
  assert.equal(restored.version, 1);
});
