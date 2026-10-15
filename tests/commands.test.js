import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { createApp } from '../server/app.js';
import { COMMAND_RECEIPT_LIMIT, rememberCommand } from '../server/commands.js';
import { getBoard } from '../shared/board.js';
import { fixture } from './server-helpers.js';

function seedFor(dice) {
  const next = seed => { let value = seed | 0; value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return value >>> 0; };
  for (let seed = 1; seed < 1000000; seed++) {
    const first = next(seed), second = next(first);
    if (1 + Math.floor(first / 0x100000000 * 6) === dice[0] && 1 + Math.floor(second / 0x100000000 * 6) === dice[1]) return seed;
  }
  throw new Error('No deterministic private dice seed');
}
const game = f => f.server.store.data.rooms[f.code].game;
const cash = f => game(f).players.map(player => player.cash);
const send = (socket, command) => socket.timeout(3000).emitWithAck('action', command);
function pinDice(f, dice) { f.server.store.transaction(data => { data.rooms[f.code].game._randomState = seedFor(dice); }); }
async function roll(f, index, dice) { pinDice(f, dice); return f.success(index, { type: 'roll' }); }

test('old clients and missing decision metadata receive a current snapshot without applying an action', async t => {
  const f = await fixture(t);
  const before = structuredClone(f.server.store.data.rooms[f.code]);
  const old = await f.rawAction(0, { type: 'room:start' });
  assert.equal(old.ok, false);
  assert.equal(old.errorCode, 'COMMAND_METADATA_REQUIRED');
  assert.match(old.error, /Refresh this page/);
  assert.equal(old.room.actionProtocol, 2);
  assert.equal(old.room.decisionVersion, 0);
  assert.deepEqual(f.server.store.data.rooms[f.code], before);
  const missing = await f.rawAction(0, { type: 'room:start', commandId: randomUUID() });
  assert.equal(missing.errorCode, 'COMMAND_METADATA_REQUIRED');
  assert.equal(missing.room.status, 'lobby');
  await f.start();
  assert.equal(game(f).status, 'playing');
});

test('simultaneous same-seat sockets apply one payment and return a replay without another commit', async t => {
  const f = await fixture(t);
  await f.start();
  const second = await f.connect(f.users[0]);
  const command = f.command({ type: 'money:send', toPlayerId: f.users[1].playerId, amount: 75, note: 'Exactly once' });
  const originalCommit = f.server.store.commit.bind(f.server.store);
  let commits = 0;
  f.server.store.commit = next => { commits++; originalCommit(next); };
  const results = await Promise.all([send(f.users[0].socket, command), send(second, command)]);
  assert.ok(results.every(result => result.ok));
  assert.deepEqual(results.map(result => result.duplicate).sort(), [false, true]);
  assert.deepEqual(cash(f), [1425, 1575]);
  assert.equal(game(f).log.filter(event => event.type === 'moneyTransfer').length, 1);
  assert.equal(commits, 1, 'The replay skips durable writes entirely');
  assert.equal(results[0].room._commandReceipts, undefined);
  assert.equal(JSON.stringify(results[0].room).includes(command.commandId), false);
  const persisted = JSON.parse(fs.readFileSync(f.storePath, 'utf8'));
  assert.ok(persisted.rooms[f.code]._commandReceipts.some(receipt => receipt.commandId === command.commandId));
});

test('same command identifier rejects different instructions, canonical key order replays, and IDs are seat scoped', async t => {
  const f = await fixture(t);
  await f.start();
  const id = randomUUID();
  const command = f.command({ type: 'money:send', toPlayerId: f.users[1].playerId, amount: 20, commandId: id });
  assert.equal((await f.rawAction(0, command)).ok, true);
  const before = structuredClone(f.server.store.data.rooms[f.code]);
  const conflict = await f.rawAction(0, { ...command, amount: 21 });
  assert.equal(conflict.errorCode, 'COMMAND_ID_CONFLICT');
  assert.deepEqual(f.server.store.data.rooms[f.code], before);
  const reordered = Object.fromEntries(Object.entries(command).reverse());
  const replay = await f.rawAction(0, reordered);
  assert.equal(replay.ok, true);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.room.decisionVersion, before.decisionVersion);
  await f.success(1, { type: 'money:send', toPlayerId: f.users[0].playerId, amount: 20, commandId: id });
  assert.deepEqual(cash(f), [1500, 1500]);
});

test('different concurrent intents from one rendered decision cannot both spend cash', async t => {
  const f = await fixture(t);
  await f.start();
  const second = await f.connect(f.users[0]);
  const first = f.command({ type: 'money:send', toPlayerId: f.users[1].playerId, amount: 50 });
  const other = { ...first, commandId: randomUUID() };
  const results = await Promise.all([send(f.users[0].socket, first), send(second, other)]);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.find(result => !result.ok).errorCode, 'STALE_DECISION');
  assert.deepEqual(cash(f), [1450, 1550]);
});

test('chat, votes, appearance and presence do not invalidate a pending game decision', async t => {
  const f = await fixture(t);
  await f.start();
  pinDice(f, [1, 2]);
  const command = f.command({ type: 'roll' });
  const beforeVersion = f.server.store.data.rooms[f.code].version;
  await f.success(1, { type: 'chat:send', text: 'A harmless chat update' });
  await f.success(1, { type: 'vote:propose', title: 'A harmless vote', rule: 'majority' });
  await f.success(0, { type: 'room:appearance', appearance: { palette: 'ocean', mode: 'dark' } });
  await f.connect(f.users[0]);
  assert.ok(f.server.store.data.rooms[f.code].version > beforeVersion);
  assert.equal(f.server.store.data.rooms[f.code].decisionVersion, command.expectedDecisionVersion);
  const accepted = await f.rawAction(0, command);
  assert.equal(accepted.ok, true, accepted.error);
  assert.equal(accepted.room.game.pendingPurchase, 3);
});

test('delayed buy and end-turn commands cannot attach to a later property or a returning seat', async t => {
  const f = await fixture(t);
  await f.start();
  await roll(f, 0, [1, 2]);
  const delayedBuy = f.command({ type: 'buy', propertyId: 3 });
  await f.success(0, { type: 'buy', propertyId: 3 });
  const delayedEnd = f.command({ type: 'endTurn' });
  await f.success(0, { type: 'endTurn' });
  await roll(f, 1, [1, 2]); // Rent is resolved normally on the first player's deed.
  await f.success(1, { type: 'endTurn' });
  await roll(f, 0, [2, 3]); // A new purchase decision, now on space 8.
  assert.equal(game(f).pendingPurchase, 8);
  const before = structuredClone(f.server.store.data.rooms[f.code]);
  const staleBuy = await f.rawAction(0, delayedBuy);
  assert.equal(staleBuy.errorCode, 'STALE_DECISION');
  assert.equal(staleBuy.room.game.pendingPurchase, 8);
  assert.deepEqual(f.server.store.data.rooms[f.code], before);
  const wrongTarget = await f.action(0, { type: 'buy', propertyId: 3 });
  assert.equal(wrongTarget.ok, false);
  assert.match(wrongTarget.error, /purchase decision changed/);
  const missingTarget = f.command({ type: 'buy' });
  delete missingTarget.propertyId;
  assert.equal((await f.rawAction(0, missingTarget)).ok, false);
  await f.success(0, { type: 'buy', propertyId: 8 });
  assert.equal(game(f).properties[8].ownerId, f.users[0].playerId);
  const beforeEnd = structuredClone(f.server.store.data.rooms[f.code]);
  const staleEnd = await f.rawAction(0, delayedEnd);
  assert.equal(staleEnd.errorCode, 'STALE_DECISION');
  assert.deepEqual(f.server.store.data.rooms[f.code], beforeEnd);
  await f.success(0, { type: 'endTurn' });
  assert.equal(game(f).turn, 4);
});

test('current decision version cannot excuse the wrong turn, seat or phase, and auction targets are explicit', async t => {
  const f = await fixture(t);
  await f.start();
  for (const wrong of [{ expectedTurn: 0 }, { expectedCurrentPlayerId: f.users[1].playerId }, { expectedPhase: 'end' }]) {
    const result = await f.rawAction(0, f.command({ type: 'roll', ...wrong }));
    assert.equal(result.errorCode, 'STALE_DECISION');
  }
  const outOfTurn = await f.action(1, { type: 'roll' });
  assert.equal(outOfTurn.ok, false);
  assert.match(outOfTurn.error, /not available/);
  await roll(f, 0, [1, 2]);
  assert.equal((await f.action(0, { type: 'auction', propertyId: 6 })).ok, false);
  const room = await f.success(0, { type: 'auction', propertyId: 3 });
  assert.equal(room.game.auction.propertyId, 3);
  await f.success(1, { type: 'bid', amount: 1 });
  await f.success(0, { type: 'passAuction' });
  assert.equal(game(f).properties[3].ownerId, f.users[1].playerId);
});

test('accepted roll retries are harmless during presentation and fresh intentional doubles still work', async t => {
  const f = await fixture(t, 2, { presentationTiming: { rollMs: 80, stepMs: 8, settleMs: 10, cardPauseMs: 10 } });
  await f.start();
  pinDice(f, [2, 2]); // Income tax ends resolution in roll phase because it was doubles.
  const command = f.command({ type: 'roll' });
  const accepted = await f.rawAction(0, command);
  const replay = await f.rawAction(0, command);
  assert.equal(accepted.ok, true);
  assert.equal(replay.ok, true);
  assert.equal(replay.duplicate, true);
  assert.equal(game(f).log.filter(event => event.type === 'roll').length, 1);
  assert.equal(game(f).players[0].position, 4);
  assert.equal((await f.action(0, { type: 'roll' })).ok, false);
  await new Promise(resolve => setTimeout(resolve, Math.max(0, accepted.room.presentation.endsAt - Date.now() + 20)));
  const next = await roll(f, 0, [1, 2]);
  assert.equal(next.game.log.filter(event => event.type === 'roll').length, 2);
  assert.equal(next.game.turn, 1, 'A new intentional roll after doubles stays on the same turn');
});

test('payment replay remains exactly once after reconnect and server restart', async t => {
  const f = await fixture(t);
  await f.start();
  const command = f.command({ type: 'money:send', toPlayerId: f.users[1].playerId, amount: 60 });
  const accepted = await f.rawAction(0, command);
  await f.server.close();
  const restarted = createApp({ storePath: f.storePath });
  t.after(() => restarted.close());
  const address = await restarted.listen(0, '127.0.0.1');
  const socket = io(`http://127.0.0.1:${address.port}`, { transports: ['websocket'], reconnection: false, auth: { roomCode: f.code, sessionToken: f.users[0].sessionToken } });
  t.after(() => socket.disconnect());
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  const duplicate = await send(socket, command);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.appliedDecisionVersion, accepted.appliedDecisionVersion);
  assert.deepEqual(duplicate.room.game.players.map(player => player.cash), [1440, 1560]);
  assert.equal(duplicate.room._commandReceipts, undefined);
});

test('a lost payment acknowledgement is recoverable by its own seat and replay never charges again', async t => {
  const f = await fixture(t);
  await f.start();
  const command = f.command({ type: 'money:send', toPlayerId: f.users[1].playerId, amount: 90 });
  const committed = new Promise(resolve => {
    const listener = room => {
      if (!room.game.log.some(event => event.type === 'moneyTransfer')) return;
      f.users[1].socket.off('room:state', listener);
      resolve(room);
    };
    f.users[1].socket.on('room:state', listener);
  });
  f.users[0].socket.emit('action', command); // No acknowledgement callback: model a lost ACK.
  await committed;
  f.users[0].socket.disconnect();
  const recovery = await fetch(`${f.base}/api/rooms/${f.code}/commands/${command.commandId}`, { headers: { Authorization: `Bearer ${f.users[0].sessionToken}` } });
  const result = await recovery.json();
  assert.equal(result.status, 'applied');
  assert.equal(result.commandId, command.commandId);
  assert.equal(result.appliedDecisionVersion, result.room.decisionVersion);
  assert.equal(result.hash, undefined);
  assert.equal(result.room._commandReceipts, undefined);
  assert.deepEqual(result.room.game.players.map(player => player.cash), [1410, 1590]);
  const foreign = await fetch(`${f.base}/api/rooms/${f.code}/commands/${command.commandId}`, { headers: { Authorization: `Bearer ${f.users[1].sessionToken}` } });
  assert.equal((await foreign.json()).status, 'unknown', 'A seat cannot inspect another seat\'s command receipt');
  assert.equal((await fetch(`${f.base}/api/rooms/${f.code}/commands/${command.commandId}`)).status, 400);
  const reconnected = await f.connect(f.users[0]);
  const retry = await send(reconnected, command);
  assert.equal(retry.ok, true);
  assert.equal(retry.duplicate, true);
  assert.deepEqual(cash(f), [1410, 1590]);
  assert.equal(game(f).log.filter(event => event.type === 'moneyTransfer').length, 1);
  const absent = await fetch(`${f.base}/api/rooms/${f.code}/commands/${randomUUID()}`, { headers: { Authorization: `Bearer ${f.users[0].sessionToken}` } });
  assert.equal((await absent.json()).status, 'unknown');
});

test('duplicate final loan signatures disburse once and duplicate overdue payments settle once', async t => {
  const f = await fixture(t);
  await f.start();
  const [a, b] = f.users.map(user => user.playerId);
  let room = await f.success(0, { type: 'contract:propose', counterpartyId: b, terms: {
    transfers: [{ fromPlayerId: a, toPlayerId: b, cash: 100 }],
    obligations: [{ debtorId: b, creditorId: a, amount: 105, trigger: { type: 'afterTurns', turns: 1 } }],
    finance: { kind: 'loan', payerId: b, payeeId: a, principal: 100, interestBps: 500, obligationIndex: 0 },
  } });
  const loan = room.contracts[0];
  await f.success(0, { type: 'contract:sign', contractId: loan.id, revision: 1 });
  const otherB = await f.connect(f.users[1]);
  const signature = f.command({ type: 'contract:sign', contractId: loan.id, revision: 1 });
  const signatures = await Promise.all([f.rawAction(1, signature), send(otherB, signature)]);
  assert.ok(signatures.every(result => result.ok));
  assert.equal(signatures.filter(result => !result.duplicate).length, 1);
  assert.deepEqual(cash(f), [1400, 1600]);
  f.server.store.transaction(data => { data.rooms[f.code].game.phase = 'end'; });
  await f.success(0, { type: 'endTurn' });
  assert.deepEqual(cash(f), [1505, 1495]);
  assert.equal((await f.rawAction(1, signature)).duplicate, true);
  assert.deepEqual(cash(f), [1505, 1495]);

  room = await f.success(0, { type: 'contract:propose', counterpartyId: b, terms: { obligations: [{ debtorId: a, creditorId: b, amount: 1600, trigger: { type: 'manual', condition: 'Both explicitly confirm now' } }] } });
  const debt = room.contracts[0];
  await f.success(0, { type: 'contract:sign', contractId: debt.id, revision: 1 });
  room = await f.success(1, { type: 'contract:sign', contractId: debt.id, revision: 1 });
  const obligationId = room.contracts[0].obligations[0].id;
  for (const index of [0, 1]) await f.success(index, { type: 'contract:confirm', contractId: debt.id, obligationId });
  assert.equal(f.server.store.data.rooms[f.code].contracts[0].obligations[0].status, 'defaulted');
  await f.success(1, { type: 'money:send', toPlayerId: a, amount: 200 });
  const pay = f.command({ type: 'contract:pay', contractId: debt.id, obligationId });
  const otherA = await f.connect(f.users[0]);
  const payments = await Promise.all([f.rawAction(0, pay), send(otherA, pay)]);
  assert.ok(payments.every(result => result.ok));
  assert.equal(payments.filter(result => !result.duplicate).length, 1);
  assert.deepEqual(cash(f), [105, 2895]);
  assert.equal(f.server.store.data.rooms[f.code].contracts[0].obligations[0].paidCount, 1);
});

test('bounded receipts can expire but stale financial intent can never debit a second time', async t => {
  const f = await fixture(t);
  await f.start();
  const command = f.command({ type: 'money:send', toPlayerId: f.users[1].playerId, amount: 25 });
  await f.rawAction(0, command);
  f.server.store.transaction(data => {
    const room = data.rooms[f.code];
    for (let index = 0; index < COMMAND_RECEIPT_LIMIT; index++) rememberCommand(room, f.users[1].playerId, { id: randomUUID(), hash: String(index) });
  });
  assert.equal(f.server.store.data.rooms[f.code]._commandReceipts.length, COMMAND_RECEIPT_LIMIT);
  assert.ok(!f.server.store.data.rooms[f.code]._commandReceipts.some(receipt => receipt.commandId === command.commandId));
  const stale = await f.rawAction(0, command);
  assert.equal(stale.errorCode, 'STALE_DECISION');
  assert.deepEqual(cash(f), [1475, 1525]);
});

for (const playerCount of [2, 4]) test(`${playerCount}-player adversarial game keeps doubles, card movement and explicit matching purchases`, async t => {
  const f = await fixture(t, playerCount);
  await f.start();
  f.server.store.transaction(data => {
    const game = data.rooms[f.code].game;
    game._decks.chance = ['chance-back-three', ...game._decks.chance.filter(id => id !== 'chance-back-three')];
  });
  const dice = [[3, 4], [1, 1], [2, 3], [2, 2], [1, 2], [1, 1], [1, 1], [1, 1]];
  const purchases = [];
  let rolls = 0;
  for (let step = 0; step < 110 && game(f).turn <= 14; step++) {
    const current = game(f);
    const actor = f.users.findIndex(user => user.playerId === current.currentPlayerId);
    if (current.phase === 'roll') {
      const wrongActor = (actor + 1) % playerCount;
      assert.equal((await f.action(wrongActor, { type: 'roll' })).ok, false);
      pinDice(f, dice[rolls++ % dice.length]);
      const command = f.command({ type: 'roll' });
      const result = await f.rawAction(actor, command);
      assert.equal(result.ok, true, result.error);
      assert.equal((await f.rawAction(actor, command)).duplicate, true);
      assert.equal((await f.rawAction(actor, { ...command, commandId: randomUUID() })).errorCode, 'STALE_DECISION');
    } else if (current.phase === 'buy') {
      const id = current.pendingPurchase;
      const price = getBoard(current)[id].price;
      const before = structuredClone(current);
      assert.equal((await f.action(actor, { type: 'buy', propertyId: (id + 1) % 40 })).ok, false);
      assert.deepEqual(game(f), before);
      if (current.players[actor].cash >= price) {
        await f.success(actor, { type: 'buy', propertyId: id });
        purchases.push({ id, playerId: f.users[actor].playerId });
      } else await f.success(actor, { type: 'auction', propertyId: id });
    } else if (current.phase === 'auction') {
      for (const index of f.users.map((_, index) => index)) {
        if (!game(f).auction) break;
        const auction = game(f).auction;
        if (!auction.passedPlayerIds.includes(f.users[index].playerId)) await f.success(index, { type: 'passAuction' });
      }
    } else if (current.phase === 'end') await f.success(actor, { type: 'endTurn' });
    else if (current.phase === 'debt') break; // Mandatory debt remains a decision; this test never auto-liquidates.
    else throw new Error(`Unexpected adversarial phase ${current.phase}`);
  }
  const final = game(f);
  assert.ok(final.turn >= 8, 'Multiple table rounds completed');
  assert.ok(final.log.some(event => event.type === 'roll' && event.doubles));
  assert.ok(final.log.some(event => event.type === 'move' && event.back && event.path.length === 3));
  assert.equal(final.log.filter(event => event.type === 'purchase').length, purchases.length);
  const lastLanding = new Map();
  let purchaseIndex = 0;
  for (const event of final.log) {
    if (event.type === 'land') lastLanding.set(event.playerId, event.propertyId);
    if (event.type === 'purchase') {
      assert.equal(event.propertyId, lastLanding.get(event.playerId));
      assert.deepEqual({ id: event.propertyId, playerId: event.playerId }, purchases[purchaseIndex++]);
    }
  }
  assert.ok(final.players.every(player => player.cash >= 0));
});
