import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createGame, applyAction, publicGame } from '../shared/engine.js';
import { prepareCommand } from '../src/action-gate.js';
import { fixture } from './server-helpers.js';

const players = [{ id: 'a', name: 'Avery' }, { id: 'b', name: 'Jordan' }];
const setup = options => createGame(players, { seed: 42, firstPlayerId: 'a', ...options });
const roll = (game, dice) => applyAction(game, game.currentPlayerId, { type: 'roll' }, { dice });
const pass = (game, propertyId = game.pendingPurchase) => applyAction(game, game.currentPlayerId, { type: 'declinePurchase', propertyId });

test('passing is off by default, including an older saved game without the rule', () => {
  const game = setup(); roll(game, [1, 2]);
  assert.equal(game.rules.allowPassingUnowned, false);
  for (const old of [false, true]) {
    if (old) delete game.rules.allowPassingUnowned;
    const before = structuredClone(game);
    assert.ok(!publicGame(game).permittedActions.a.includes('declinePurchase'));
    assert.throws(() => pass(game), /not available/);
    assert.deepEqual(game, before);
  }
  assert.throws(() => setup({ allowPassingUnowned: 'true' }), /true or false/);
});

test('passing leaves an unowned deed with the bank without charging cash or starting an auction', () => {
  const game = setup({ allowPassingUnowned: true }); roll(game, [1, 2]);
  const cash = game.players.map(player => player.cash);
  assert.equal(game.pendingPurchase, 3);
  assert.ok(publicGame(game).permittedActions.a.includes('declinePurchase'));
  pass(game);
  assert.equal(game.phase, 'end'); assert.equal(game.pendingPurchase, null); assert.equal(game.auction, null);
  assert.equal(game.properties[3].ownerId, null); assert.deepEqual(game.players.map(player => player.cash), cash);
  assert.equal(game.log.at(-1).type, 'declinePurchase'); assert.equal(game.log.at(-1).propertyId, 3);
  assert.equal(game.log.filter(event => event.type === 'purchase').length, 0);
  const before = structuredClone(game); assert.throws(() => pass(game, 3), /not available/); assert.deepEqual(game, before);
});

test('passing resumes the same doubles roll and still enforces third-doubles jail', () => {
  const game = setup({ allowPassingUnowned: true }); game.players[0].position = 1;
  roll(game, [1, 1]); pass(game);
  assert.equal(game.phase, 'roll'); assert.equal(game._doubleCount, 1); assert.equal(game.turn, 1);
  roll(game, [1, 1]); pass(game);
  assert.equal(game.phase, 'roll'); assert.equal(game._doubleCount, 2);
  roll(game, [1, 1]);
  assert.equal(game.players[0].inJail, true); assert.equal(game.players[0].position, 10); assert.equal(game.phase, 'end');
});

test('a card landing can be passed and Inland opening movement keeps its own turn rules', () => {
  const game = setup({ allowPassingUnowned: true }); game.players[0].position = 1;
  game._decks.chance = ['chance-boardwalk', ...game._decks.chance.filter(id => id !== 'chance-boardwalk')];
  roll(game, [2, 4]); assert.equal(game.pendingPurchase, 39); pass(game);
  assert.equal(game.players[0].position, 39); assert.equal(game.phase, 'end'); assert.equal(game.properties[39].ownerId, null);
  const inland = setup({ edition: 'inland', allowPassingUnowned: true });
  roll(inland, [1, 1]); assert.equal(inland.pendingPurchase, 1);
  const cash = inland.players[0].cash; pass(inland);
  assert.equal(inland.properties[1].ownerId, null); assert.equal(inland.players[0].cash, cash); assert.equal(inland.phase, 'roll');
});

test('passing rejects wrong seats, missing IDs, mismatched deeds and forged rule fields without mutation', () => {
  const game = setup({ allowPassingUnowned: true }); roll(game, [1, 2]);
  for (const command of [{}, { propertyId: 1 }, { propertyId: '3' }]) {
    const before = structuredClone(game);
    assert.throws(() => applyAction(game, 'a', { type: 'declinePurchase', ...command }), /purchase decision changed/);
    assert.deepEqual(game, before);
  }
  assert.throws(() => applyAction(game, 'b', { type: 'declinePurchase', propertyId: 3 }), /not available/);
  const disabled = setup(); roll(disabled, [1, 2]);
  assert.throws(() => applyAction(disabled, 'a', { type: 'declinePurchase', propertyId: 3, allowPassingUnowned: true }), /not available/);
});

test('the host alone can configure a shared persisted rule and it locks at game start', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.server.publicRoom(f.server.store.data.rooms[f.code]).rules, { allowPassingUnowned: false });
  assert.equal((await f.action(1, { type: 'room:rules', rules: { allowPassingUnowned: true } })).ok, false);
  for (const rules of [null, [], { allowPassingUnowned: 'true' }, { allowPassingUnowned: null }, { otherRule: true }]) assert.equal((await f.action(0, { type: 'room:rules', rules })).ok, false);
  const changed = await f.success(0, { type: 'room:rules', rules: { allowPassingUnowned: true } });
  assert.equal(changed.rules.allowPassingUnowned, true);
  assert.equal(JSON.parse(fs.readFileSync(f.storePath, 'utf8')).rooms[f.code].rules.allowPassingUnowned, true);
  const guest = await fetch(`${f.base}/api/rooms/${f.code}`, { headers: { Authorization: `Bearer ${f.users[1].sessionToken}` } }).then(r => r.json());
  assert.equal(guest.room.rules.allowPassingUnowned, true);
  const started = await f.start(); assert.equal(started.game.rules.allowPassingUnowned, true);
  assert.equal((await f.action(0, { type: 'room:rules', rules: { allowPassingUnowned: false } })).ok, false);
  assert.equal(f.server.store.data.rooms[f.code].game.rules.allowPassingUnowned, true);
});

test('room creation accepts an opt-in, while missing old room settings project safely as disabled', async t => {
  const f = await fixture(t, 2, { rules: { allowPassingUnowned: true } });
  assert.equal((await f.start()).game.rules.allowPassingUnowned, true);
  f.server.store.transaction(data => { delete data.rooms[f.code].rules; delete data.rooms[f.code].game.rules.allowPassingUnowned; });
  const old = f.server.publicRoom(f.server.store.data.rooms[f.code]);
  assert.equal(old.rules.allowPassingUnowned, false);
  assert.ok(!old.game.permittedActions[f.users[0].playerId].includes('declinePurchase'));
});

test('socket purchase passing is exact once across concurrent seats and authentic receipt recovery', async t => {
  const f = await fixture(t, 2, { rules: { allowPassingUnowned: true } }); await f.start();
  f.server.store.transaction(data => applyAction(data.rooms[f.code].game, f.users[0].playerId, { type: 'roll' }, { dice: [1, 2] }));
  const second = await f.connect(f.users[0]);
  const command = f.command({ type: 'declinePurchase', propertyId: 3 });
  const results = await Promise.all([f.rawAction(0, command), second.timeout(3000).emitWithAck('action', command)]);
  assert.ok(results.every(result => result.ok)); assert.deepEqual(results.map(r => r.duplicate).sort(), [false, true]);
  const room = f.server.store.data.rooms[f.code];
  assert.equal(room.game.log.filter(event => event.type === 'declinePurchase').length, 1);
  assert.equal(room.game.properties[3].ownerId, null); assert.equal(room.game.auction, null); assert.equal(room.game.phase, 'end');
  const stale = await f.rawAction(0, { ...command, commandId: 'different-command-123456789' }); assert.equal(stale.errorCode, 'STALE_DECISION');
  const receipt = await fetch(`${f.base}/api/rooms/${f.code}/commands/${command.commandId}`, { headers: { Authorization: `Bearer ${f.users[0].sessionToken}` } }).then(r => r.json());
  assert.equal(receipt.status, 'applied'); assert.equal(receipt.appliedDecisionVersion, room.decisionVersion);
  assert.equal(receipt.room._commandReceipts, undefined);
});

test('client passing packets bind to the displayed deed and financial decision version', () => {
  const game = setup({ allowPassingUnowned: true }); roll(game, [1, 2]);
  const room = { code: 'RULE', actionProtocol: 2, decisionVersion: 7, game: publicGame(game), presentation: null };
  const input = { type: 'declinePurchase', propertyId: 3 }, options = { commandId: 'client-command-123456', serverTime: Date.now() };
  const packet = prepareCommand(input, room, room, 'a', options);
  assert.equal(packet.expectedDecisionVersion, 7); assert.equal(packet.expectedPhase, 'buy'); assert.equal(packet.propertyId, 3);
  assert.throws(() => prepareCommand({ ...input, propertyId: 1 }, room, room, 'a', options), /property decision/);
  assert.throws(() => prepareCommand(input, room, { ...room, decisionVersion: 8 }, 'a', options), /table changed/);
});
