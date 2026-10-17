import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { io } from 'socket.io-client';
import { createApp } from '../server/app.js';
import { reconcileTurnTimer } from '../server/turn-timers.js';
import { createUnoDeck } from '../shared/uno-cards.js';
import { createUnoGame } from '../shared/uno-engine.js';
import { TOKENS, PLAYER_COLORS } from '../shared/board.js';
import { EMOTE_KINDS } from '../shared/emotes.js';
import { fixture } from './server-helpers.js';

const roomOf = f => f.server.store.data.rooms[f.code];
const gameOf = f => roomOf(f).game;
const privateHands = game => Object.fromEntries(Object.entries(game._hands).map(([id, cards]) => [id, cards.map(card => card.id)]));
const unoFixture = (t, count = 3, options = {}) => fixture(t, count, { gameType: 'uno', token: undefined, rules: { edition: 'classic', scoreMode: 'points' }, turnTimeoutMs: 5000, ...options });

async function until(predicate, message, timeout = 3000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = predicate();
    if (value) return value;
    await pause(10);
  }
  assert.fail(message);
}

function arrange(f, { hands, top = 'red-5-0', draw = [], edition = roomOf(f).rules.edition } = {}) {
  f.server.store.transaction(data => {
    const room = data.rooms[f.code];
    room.rules = { edition, scoreMode: 'points', targetScore: 500 };
    let game;
    for (let seed = 1; !game || game._discardPile.at(-1).kind !== 'number'; seed += 1) game = createUnoGame(room.players, { seed, rules: room.rules, dealerId: room.players.at(-1).id });
    if (hands) {
      const pool = createUnoDeck(edition);
      const take = id => {
        const index = pool.findIndex(card => card.id === id);
        assert(index >= 0, `Unique fixture card ${id}`);
        return pool.splice(index, 1)[0];
      };
      game._hands = Object.fromEntries(hands.map((cards, index) => [f.users[index].playerId, cards.map(take)]));
      game._discardPile = [take(top)];
      const firstDraws = draw.map(take);
      game._drawPile = [...pool, ...firstDraws.reverse()];
      game.activeColor = game._discardPile.at(-1).color;
    }
    game.log = []; game._eventSeq = 0;
    room.game = game;
    room.status = 'playing';
    room.decisionVersion += 1;
    reconcileTurnTimer(room, { connectedActive: true, durationMs: 5000, forceRestart: true });
  });
}

function assertPrivateView(view, f, viewerId, { challengeCards = [] } = {}) {
  const game = gameOf(f), raw = JSON.stringify(view);
  assert.equal(view.gameType, 'uno');
  assert.equal(view._commandReceipts, undefined);
  assert.equal(view.game._hands, undefined);
  assert.equal(view.game._drawPile, undefined);
  assert.equal(view.game._randomState, undefined);
  assert.equal(view.game._pendingEffect, undefined);
  assert.equal(view.game._pendingDrawFour, undefined);
  assert.equal(view.game._discardPile, undefined);
  assert.equal(raw.includes('PRIVATE_SENTINEL'), false);
  assert.deepEqual(view.game.hand.map(card => card.id), game._hands[viewerId]?.map(card => card.id) ?? []);
  const revealed = new Set(challengeCards);
  const publicIds = new Set([view.game.discardTop?.id, ...view.game.log.map(event => event.card?.id)].filter(Boolean));
  for (const player of game.players) {
    assert.equal(view.game.players.find(item => item.id === player.id).cardCount, game._hands[player.id].length);
    if (player.id === viewerId) continue;
    for (const card of game._hands[player.id]) if (!revealed.has(card.id) && !publicIds.has(card.id)) assert.equal(raw.includes(`"${card.id}"`), false, `${viewerId} cannot see ${player.id}'s ${card.id}`);
  }
  if (game.currentPlayerId !== viewerId) assert.deepEqual(view.game.playableCardIds, []);
  assert.equal(view.presentation, null);
}

async function getView(f, index, suffix = '') {
  const response = await fetch(`${f.base}/api/rooms/${f.code}${suffix}`, { headers: { Authorization: `Bearer ${f.users[index].sessionToken}` } });
  assert.equal(response.status, 200);
  return response.json();
}

test('UNO supports ten cyclical seats while default and saved Monopoly rooms retain their original game type', async t => {
  const f = await unoFixture(t, 10);
  const room = roomOf(f);
  assert.equal(room.players.length, 10);
  for (let index = 0; index < 10; index += 1) {
    assert.equal(room.players[index].token, TOKENS[index % TOKENS.length].id);
    assert.equal(room.players[index].color, PLAYER_COLORS[index % PLAYER_COLORS.length]);
  }
  const excess = await f.post(`/api/rooms/${f.code}/join`, { name: 'Eleventh player' });
  assert.equal(excess.response.status, 400);
  assert.match(excess.data.error, /full/);
  const started = await f.success(0, { type: 'room:start' });
  assert.equal(started.game.players.length, 10);
  assertPrivateView(started, f, f.users[0].playerId);
  assert(gameOf(f).players.every(player => gameOf(f)._hands[player.id].length >= 7));
  const old = await fixture(t, 2);
  assert.equal(roomOf(old).gameType, 'monopoly');
  old.server.store.transaction(data => { delete data.rooms[old.code].gameType; });
  await old.start();
  assert.equal(old.server.publicRoom(roomOf(old)).gameType, 'monopoly');
  assert.equal(gameOf(old).players[0].cash, 1500);
  assert.equal(gameOf(old)._hands, undefined);
});

test('HTTP, socket broadcasts, acknowledgements, receipts, rejoin and reconnect all project only the authenticated hand', async t => {
  const f = await unoFixture(t);
  await f.success(0, { type: 'room:start' });
  arrange(f);
  f.server.store.transaction(data => {
    const room = data.rooms[f.code];
    room.futurePrivate = 'PRIVATE_SENTINEL';
    room.players[1].private = 'PRIVATE_SENTINEL';
    room.game.futurePrivate = 'PRIVATE_SENTINEL';
    room.game.players[0].private = 'PRIVATE_SENTINEL';
    room.turnTimer.private = 'PRIVATE_SENTINEL';
    room.chat.push({ id: 'chat-fixture', playerId: f.users[0].playerId, text: 'Ready', at: new Date().toISOString(), private: 'PRIVATE_SENTINEL' });
    room.activity[0].private = 'PRIVATE_SENTINEL';
  });
  const seen = f.users.map(() => []);
  f.users.forEach((user, index) => user.socket.on('room:state', view => seen[index].push(view)));
  const command = f.command({ type: 'chat:send', text: 'Exercise every projection' });
  const ack = await f.rawAction(0, command);
  assert.equal(ack.ok, true);
  assertPrivateView(ack.room, f, f.users[0].playerId);
  await until(() => seen.every(list => list.some(view => view.version >= ack.room.version)), 'Every seat receives an individualized broadcast');
  for (let index = 0; index < f.users.length; index += 1) {
    const id = f.users[index].playerId;
    assertPrivateView(seen[index].at(-1), f, id);
    assertPrivateView((await getView(f, index)).room, f, id);
    const receipt = await getView(f, index, `/commands/${command.commandId}`);
    assert.equal(receipt.status, index === 0 ? 'applied' : 'unknown');
    assertPrivateView(receipt.room, f, id);
    const rejoin = await f.post(`/api/rooms/${f.code}/join`, { sessionToken: f.users[index].sessionToken });
    assert.equal(rejoin.response.status, 200);
    assertPrivateView(rejoin.data.room, f, id);
  }
  const replay = await f.rawAction(0, command);
  assert.equal(replay.duplicate, true);
  assertPrivateView(replay.room, f, f.users[0].playerId);
  const rejected = await f.rawAction(1, { type: 'uno:draw' });
  assert.equal(rejected.ok, false);
  assertPrivateView(rejected.room, f, f.users[1].playerId);
  const second = await f.connect(f.users[1]);
  let reconnected;
  second.on('room:state', view => { reconnected = view; });
  const current = await f.success(0, { type: 'chat:send', text: 'A second socket uses the same seat' });
  await until(() => reconnected?.version >= current.version, 'Reconnected seat receives a private projection');
  assertPrivateView(reconnected, f, f.users[1].playerId);
  assertPrivateView(f.server.publicRoom(roomOf(f)), f, null);
  const unauthorized = await fetch(`${f.base}/api/rooms/${f.code}`);
  assert.equal(unauthorized.status, 400);
  assert.equal((await unauthorized.json()).room, undefined);
  const preview = await fetch(`${f.base}/api/rooms/${f.code}/preview`).then(response => response.json());
  assert.deepEqual(Object.keys(preview).sort(), ['gameType', 'playerCount', 'rules', 'status', 'theme']);
});

test('challenge evidence reaches only the challenger across broadcasts, acknowledgements and HTTP receipt lookup', async t => {
  const f = await unoFixture(t);
  await f.success(0, { type: 'room:start' });
  arrange(f, { hands: [['wild-draw-four-0', 'red-1-0'], ['blue-3-0', 'blue-4-0'], ['green-1-0', 'yellow-2-0']] });
  const seen = f.users.map(() => []);
  f.users.forEach((user, index) => user.socket.on('room:state', view => seen[index].push(view)));
  const played = await f.success(0, { type: 'uno:play', cardId: 'wild-draw-four-0', color: 'blue', callUno: true });
  assert.equal(played.game.pendingDrawFour.amount, 4);
  for (let index = 0; index < f.users.length; index += 1) {
    const view = (await getView(f, index)).room;
    assert.equal(view.game.pendingDrawFour.illegal, undefined);
    assert.equal(view.game.pendingDrawFour.cards, undefined);
    assert.equal(view.game.lastChallenge, null);
    assertPrivateView(view, f, f.users[index].playerId);
  }
  const command = f.command({ type: 'uno:challenge' });
  const ack = await f.rawAction(1, command);
  assert.equal(ack.ok, true);
  assert.equal(ack.room.game.lastChallenge.successful, true);
  assert.deepEqual(ack.room.game.lastChallenge.cards.map(card => card.id), ['red-1-0']);
  await until(() => seen.every(list => list.some(view => view.version >= ack.room.version)), 'Every seat sees the challenge outcome');
  for (let index = 0; index < f.users.length; index += 1) {
    const id = f.users[index].playerId;
    for (const view of [seen[index].at(-1), (await getView(f, index)).room, (await getView(f, index, `/commands/${command.commandId}`)).room]) {
      assertPrivateView(view, f, id, { challengeCards: index === 1 ? ['red-1-0'] : [] });
      assert.equal(Boolean(view.game.lastChallenge.cards), index === 1);
    }
  }
  assert.equal(gameOf(f).currentPlayerId, f.users[1].playerId);
  assert.equal(ack.room.turnTimer?.phase, 'play');
});

test('UNO rejects Monopoly money, contracts, board actions and property emotes while rules lock at first deal', async t => {
  const f = await unoFixture(t);
  await f.success(0, { type: 'room:rules', rules: { edition: 'stitch', scoreMode: 'single-round' } });
  const started = await f.success(0, { type: 'room:start' });
  assert.equal(started.game.rules.edition, 'stitch');
  assert.equal(started.game.rules.scoreMode, 'single-round');
  for (const action of [
    { type: 'money:send', toPlayerId: f.users[1].playerId, amount: 10 },
    { type: 'contract:propose' }, { type: 'roll' }, { type: 'buy', propertyId: 1 },
    { type: 'room:theme', theme: 'inland-empire' },
    { type: 'room:rules', rules: { edition: 'classic', scoreMode: 'points' } },
  ]) {
    const before = structuredClone(roomOf(f));
    const result = await f.action(0, action);
    assert.equal(result.ok, false, `${action.type} must be rejected`);
    assert.deepEqual(roomOf(f), before);
    assertPrivateView(result.room, f, f.users[0].playerId);
  }
  const invalid = await f.users[0].socket.timeout(3000).emitWithAck('emote:send', { clientId: randomUUID(), kind: EMOTE_KINDS[0], target: { kind: 'property', propertyId: 1 } });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /OpenUno reaction/);
  const table = await f.users[0].socket.timeout(3000).emitWithAck('emote:send', { clientId: randomUUID(), kind: EMOTE_KINDS[0], target: { kind: 'table' } });
  assert.equal(table.ok, true);
  const late = await f.post(`/api/rooms/${f.code}/join`, { name: 'New player', gameType: 'monopoly' });
  assert.equal(late.response.status, 400);
  assert.equal(roomOf(f).gameType, 'uno');
});

test('simultaneous duplicate UNO intents commit once, and changed IDs and stale turn context reject without mutation', async t => {
  const f = await unoFixture(t, 2);
  await f.success(0, { type: 'room:start' });
  arrange(f);
  const second = await f.connect(f.users[0]);
  const command = f.command({ type: 'uno:draw' });
  const originalCommit = f.server.store.commit.bind(f.server.store);
  let commits = 0;
  f.server.store.commit = next => { commits += 1; originalCommit(next); };
  const results = await Promise.all([f.rawAction(0, command), second.timeout(3000).emitWithAck('action', command)]);
  assert(results.every(result => result.ok));
  assert.deepEqual(results.map(result => result.duplicate).sort(), [false, true]);
  assert.equal(commits, 1);
  assert.equal(gameOf(f)._hands[f.users[0].playerId].length, 8);
  const before = structuredClone(roomOf(f));
  const conflict = await f.rawAction(0, { ...command, type: 'uno:pass' });
  assert.equal(conflict.errorCode, 'COMMAND_ID_CONFLICT');
  const stale = await f.rawAction(0, { ...command, commandId: randomUUID(), type: 'uno:pass' });
  assert.equal(stale.errorCode, 'STALE_DECISION');
  assert.deepEqual(roomOf(f), before);
  assertPrivateView(stale.room, f, f.users[0].playerId);
  await f.success(0, { type: 'uno:pass' });
  assert.equal(gameOf(f).currentPlayerId, f.users[1].playerId);
  assert.equal(commits, 2);
});

test('a failed UNO durable write rolls back the hand, private draw state, receipt and broadcasts', async t => {
  const f = await unoFixture(t, 2);
  await f.success(0, { type: 'room:start' });
  arrange(f, { hands: [['red-1-0', 'blue-1-0'], ['green-2-0', 'yellow-2-0']] });
  await f.success(0, { type: 'chat:send', text: 'Ready for persistence check' });
  const before = structuredClone(roomOf(f));
  const saved = fs.readFileSync(f.storePath, 'utf8');
  const command = f.command({ type: 'uno:play', cardId: 'red-1-0', callUno: true });
  const commit = f.server.store.commit.bind(f.server.store);
  f.server.store.commit = () => { throw new Error('Fixture durable write failure'); };
  const rejected = await f.rawAction(0, command);
  f.server.store.commit = commit;
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /durable write failure/);
  assert.deepEqual(roomOf(f), before);
  assert.equal(fs.readFileSync(f.storePath, 'utf8'), saved);
  assert.equal((await getView(f, 0, `/commands/${command.commandId}`)).status, 'unknown');
  assertPrivateView(rejected.room, f, f.users[0].playerId);
  const applied = await f.rawAction(0, command);
  assert.equal(applied.ok, true, 'A new deliberate retry can commit after persistence recovers');
  assert.equal(gameOf(f)._hands[f.users[0].playerId].length, 1);
});

test('saved UNO hands, RNG and idempotent receipts survive restart with no unattended turn replay', async t => {
  const f = await unoFixture(t, 2);
  await f.success(0, { type: 'room:start' });
  arrange(f);
  const command = f.command({ type: 'uno:draw' });
  const applied = await f.rawAction(0, command);
  assert.equal(applied.ok, true);
  const gameBefore = structuredClone(gameOf(f));
  const hands = privateHands(gameBefore);
  const persisted = JSON.parse(fs.readFileSync(f.storePath, 'utf8'));
  assert.deepEqual(privateHands(persisted.rooms[f.code].game), hands);
  await f.server.close();
  const restarted = createApp({ storePath: f.storePath, turnTimeoutMs: 1000 });
  t.after(() => restarted.close());
  const address = await restarted.listen(0, '127.0.0.1');
  assert.deepEqual(restarted.store.data.rooms[f.code].game, gameBefore);
  assert.equal(restarted.store.data.rooms[f.code].turnTimer, null);
  await pause(80);
  assert.deepEqual(restarted.store.data.rooms[f.code].game, gameBefore, 'No saved deadline can play cards while nobody is connected');
  const socket = io(`http://127.0.0.1:${address.port}`, { transports: ['websocket'], forceNew: true, reconnection: false, auth: { roomCode: f.code, sessionToken: f.users[0].sessionToken } });
  t.after(() => socket.disconnect());
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  const timer = restarted.store.data.rooms[f.code].turnTimer;
  assert.equal(timer.phase, 'drawn');
  assert.equal(timer.endsAt - timer.startedAt, 1000);
  const duplicate = await socket.timeout(3000).emitWithAck('action', command);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.appliedDecisionVersion, applied.appliedDecisionVersion);
  assert.deepEqual(restarted.store.data.rooms[f.code].game, gameBefore);
  assert.deepEqual(duplicate.room.game.hand.map(card => card.id), hands[f.users[0].playerId]);
  assert.equal(duplicate.room.game._randomState, undefined);
  for (const cardId of hands[f.users[1].playerId]) assert.equal(JSON.stringify(duplicate.room).includes(`"${cardId}"`), false);
});

test('UNO deadlines draw and pass exactly once, while color, challenge and Ohana choices pause the clock', async t => {
  const f = await unoFixture(t, 3);
  await f.success(0, { type: 'room:start' });
  arrange(f);
  await f.success(0, { type: 'chat:send', text: 'Reconcile the seeded turn clock' });
  const timer = structuredClone(roomOf(f).turnTimer);
  const count = gameOf(f)._hands[f.users[0].playerId].length;
  f.server.store.transaction(data => { data.rooms[f.code].turnTimer.endsAt = Date.now() - 1; });
  await f.success(2, { type: 'chat:send', text: 'Settle expired UNO clock' });
  assert.equal(gameOf(f).currentPlayerId, f.users[1].playerId);
  assert.equal(gameOf(f).phase, 'play');
  assert.equal(gameOf(f)._hands[f.users[0].playerId].length, count + 1);
  assert.equal(roomOf(f)._commandReceipts.filter(receipt => receipt.commandId === `timer-${timer.id}`).length, 1);
  await f.success(2, { type: 'chat:send', text: 'Observe the same deadline again' });
  assert.equal(gameOf(f)._hands[f.users[0].playerId].length, count + 1);
  arrange(f, { hands: [['wild-draw-four-0', 'red-1-0'], ['blue-3-0'], ['green-1-0']] });
  let view = await f.success(0, { type: 'uno:play', cardId: 'wild-draw-four-0', callUno: true });
  assert.equal(view.game.phase, 'choose-color');
  assert.equal(view.turnTimer, null);
  view = await f.success(0, { type: 'uno:color', color: 'blue' });
  assert.equal(view.game.phase, 'draw-four');
  assert.equal(view.turnTimer, null);
  view = await f.success(1, { type: 'uno:challenge' });
  assert.equal(view.turnTimer.phase, 'play');
  arrange(f, { edition: 'stitch', hands: [['ohana-0', 'red-1-0'], ['blue-1-0', 'blue-2-0', 'blue-3-0', 'blue-4-0', 'blue-5-0'], ['green-1-0']] });
  view = await f.success(0, { type: 'uno:play', cardId: 'ohana-0' });
  assert.equal(view.game.phase, 'ohana');
  assert.equal(view.turnTimer, null);
  view = await f.success(1, { type: 'uno:ohana', cardIds: ['blue-1-0'] });
  assert.equal(view.game.phase, 'choose-color');
  assert.equal(view.turnTimer, null);
  view = await f.success(0, { type: 'uno:color', color: 'green' });
  assert.equal(view.turnTimer.phase, 'play');
  assert.equal(view.turnTimer.playerId, f.users[1].playerId);
});

test('a real UNO timer dispatches draw-and-pass and disconnect/reconnect preserve private seats', async t => {
  const f = await unoFixture(t, 2, { turnTimeoutMs: 300 });
  await f.success(0, { type: 'room:start' });
  arrange(f);
  // A fixture arrangement gets a deliberately long clock; replace it with the
  // real short server clock through a complete presence pause/resume.
  const before = privateHands(gameOf(f));
  for (const user of f.users) user.socket.disconnect();
  await until(() => roomOf(f).turnTimer === null, 'All disconnected seats pause the clock');
  await pause(350);
  assert.deepEqual(privateHands(gameOf(f)), before);
  // Attach the snapshot listener before connecting: the initial publish can
  // arrive in the same transport batch as Socket.IO's connect notification.
  const socket = io(f.base, { transports: ['websocket'], forceNew: true, reconnection: false, autoConnect: false, auth: { roomCode: f.code, sessionToken: f.users[0].sessionToken } });
  t.after(() => socket.disconnect());
  let latest;
  socket.on('room:state', view => { latest = view; });
  const connected = new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  socket.connect();
  await connected;
  const resumed = roomOf(f).turnTimer;
  assert.equal(resumed.endsAt - resumed.startedAt, 300);
  const snapshot = await until(() => latest?.turnTimer?.id === resumed.id && latest, 'The reconnected seat receives its own initial private snapshot');
  assertPrivateView(snapshot, f, f.users[0].playerId);
  await until(() => roomOf(f)._commandReceipts?.some(receipt => receipt.commandId === `timer-${resumed.id}`), 'Real server UNO clock should dispatch once');
  const timedVersion = roomOf(f).version;
  const updated = await until(() => latest?.version >= timedVersion && latest, 'The reconnected seat receives the committed timeout snapshot');
  assert.equal(gameOf(f).currentPlayerId, f.users[1].playerId);
  assert.equal(gameOf(f)._hands[f.users[0].playerId].length, before[f.users[0].playerId].length + 1);
  assert.equal(gameOf(f).phase, 'play');
  assert.equal(roomOf(f).activity.filter(item => item.type === 'auto-uno').length, 1);
  assertPrivateView(updated, f, f.users[0].playerId);
  assert.equal(roomOf(f).players.length, 2);
});
