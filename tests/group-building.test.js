import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, publicGame, quoteGroupBuild } from '../shared/engine.js';
import { getBoard } from '../shared/board.js';
import { fixture } from './server-helpers.js';

function setup({ levels = [0, 0], cash = 1500, edition = 'classic' } = {}) {
  const game = createGame([{ id: 'a', name: 'Alex' }, { id: 'b', name: 'Blair' }], { seed: 42, firstPlayerId: 'a', edition });
  game.players[0].cash = cash;
  [1, 3].forEach((id, index) => { game.properties[id].ownerId = 'a'; game.properties[id].houses = levels[index]; });
  game.bank.houses -= levels.reduce((count, level) => count + (level < 5 ? level : 0), 0);
  game.bank.hotels -= levels.filter(level => level === 5).length;
  return game;
}
const act = (game, targetLevel, propertyId = 1) => applyAction(game, 'a', { type: 'buildGroup', propertyId, targetLevel });
function unchangedFailure(game, action, pattern) {
  const before = structuredClone(game);
  assert.throws(action, pattern);
  assert.deepEqual(game, before, 'A rejected group build must not change cash, stock, buildings, logs, or private state.');
}

test('public quotes show the exact balanced plan without private counters or mutation', () => {
  const game = publicGame(setup({ levels: [1, 0] }));
  const before = structuredClone(game);
  const quote = quoteGroupBuild(game, 'a', 3, 2);
  assert.deepEqual(quote.propertyIds, [1, 3]);
  assert.deepEqual(quote.steps.map(step => [step.propertyId, step.from, step.to]), [[3, 0, 1], [1, 1, 2], [3, 1, 2]]);
  assert.equal(quote.cost, 150);
  assert.deepEqual(quote.bankAfter, { houses: 28, hotels: 12 });
  assert.deepEqual(game, before);
  assert.equal(JSON.stringify(quote).includes('null'), false, 'A public quote has no NaN counter fields.');
  assert.equal(quote.trial, undefined);
});

test('a group action develops every deed and records one aggregate cost', () => {
  const game = setup({ levels: [1, 0] });
  const oldEvents = structuredClone(game.log);
  act(game, 2);
  assert.equal(game.players[0].cash, 1350);
  assert.deepEqual([game.properties[1].houses, game.properties[3].houses], [2, 2]);
  assert.deepEqual(game.bank, { houses: 28, hotels: 12 });
  assert.deepEqual(game.log.slice(0, oldEvents.length), oldEvents);
  const builds = game.log.filter(event => event.type === 'build');
  const aggregate = game.log.filter(event => event.type === 'buildGroup');
  assert.equal(builds.length, 3); assert.equal(aggregate.length, 1);
  assert.equal(aggregate[0].amount, 150);
  assert.ok(builds.every(event => event.groupBuildId === aggregate[0].groupBuildId));
  assert.ok(game.log.every(event => Number.isSafeInteger(event.seq)));
});

test('a direct hotel target follows every house stage and returns houses on conversion', () => {
  const game = setup();
  act(game, 5);
  assert.deepEqual([game.properties[1].houses, game.properties[3].houses], [5, 5]);
  assert.equal(game.players[0].cash, 1000);
  assert.deepEqual(game.bank, { houses: 32, hotels: 10 });
  assert.equal(game.log.filter(event => event.type === 'build').length, 10);
  assert.equal(game.log.at(-1).amount, 500);
});

test('late cash, house-stock and hotel-stock failures are atomic even outside the room transaction', () => {
  const poor = setup({ cash: 75 });
  unchangedFailure(poor, () => act(poor, 1), /available cash/);
  const shortHouses = setup(); shortHouses.bank.houses = 1;
  unchangedFailure(shortHouses, () => act(shortHouses, 1), /no building/);
  const shortHotels = setup({ levels: [4, 4] }); shortHotels.bank.hotels = 1;
  unchangedFailure(shortHotels, () => act(shortHotels, 5), /no building/);
});

test('hotel plans require enough houses for the legal intermediate balanced levels', () => {
  const short = setup(); short.bank.houses = 7;
  unchangedFailure(short, () => act(short, 5), /no building/);
  const enough = setup(); enough.bank.houses = 8;
  act(enough, 5);
  assert.deepEqual(enough.bank, { houses: 8, hotels: 10 });
});

test('strict packet IDs and levels cannot coerce, sell, or rebuild a complete group', () => {
  for (const propertyId of ['1', 1.5, Number.MAX_SAFE_INTEGER + 1, 0, 5]) {
    const game = setup(); unchangedFailure(game, () => act(game, 1, propertyId), /property|colored|own/i);
  }
  for (const target of ['2', 0, 6, 1.5, Infinity, NaN]) {
    const game = setup(); unchangedFailure(game, () => act(game, target), /level/);
  }
  const complete = setup({ levels: [2, 2] });
  unchangedFailure(complete, () => act(complete, 2), /already/);
  unchangedFailure(complete, () => act(complete, 1), /cannot remove/);
});

test('group building respects full ownership, mortgages, debt and auction reservations', () => {
  const partial = setup(); partial.properties[3].ownerId = 'b';
  unchangedFailure(partial, () => act(partial, 1), /complete color group/);
  const mortgaged = setup(); mortgaged.properties[3].mortgaged = true;
  unchangedFailure(mortgaged, () => act(mortgaged, 1), /Unmortgage/);
  const debt = setup(); debt.phase = 'debt'; debt.debt = { playerId: 'a', amount: 2000 };
  unchangedFailure(debt, () => act(debt, 1), /not available/);
  const reserved = setup({ cash: 500 });
  reserved.auction = { kind: 'property', propertyId: 8, highestBidderId: 'a', currentBid: 450, passedPlayerIds: [], eligiblePlayerIds: ['a', 'b'] }; reserved.phase = 'auction';
  unchangedFailure(reserved, () => act(reserved, 1), /available cash/);
  reserved.auction.currentBid = 300; act(reserved, 1);
  assert.equal(reserved.players[0].cash, 400);
});

test('Inland Empire groups use their own deed costs and stock', () => {
  const game = setup({ edition: 'inland' });
  const expectedCost = [1, 3].reduce((amount, id) => amount + getBoard(game)[id].houseCost, 0);
  act(game, 1);
  assert.equal(game.players[0].cash, 1500 - expectedCost);
  assert.deepEqual([game.properties[1].houses, game.properties[3].houses], [1, 1]);
});

test('duplicate group commands replay once and stale reviewed targets cannot spend again', async t => {
  const f = await fixture(t); await f.start();
  const id = f.users[0].playerId;
  f.server.store.transaction(data => { for (const propertyId of [1, 3]) data.rooms[f.code].game.properties[propertyId].ownerId = id; });
  const command = f.command({ type: 'buildGroup', propertyId: 1, targetLevel: 1 });
  const [first, replay] = await Promise.all([f.rawAction(0, command), f.rawAction(0, command)]);
  assert.ok(first.ok && replay.ok);
  assert.deepEqual([first.duplicate, replay.duplicate].sort(), [false, true]);
  let game = f.server.store.data.rooms[f.code].game;
  assert.equal(game.players[0].cash, 1400);
  assert.equal(game.log.filter(event => event.type === 'buildGroup').length, 1);
  const after = structuredClone(game);
  const stale = await f.rawAction(0, { ...command, commandId: 'stale-group-command-0001', targetLevel: 2 });
  assert.equal(stale.errorCode, 'STALE_DECISION');
  assert.deepEqual(f.server.store.data.rooms[f.code].game, after);
  const conflict = await f.rawAction(0, { ...command, targetLevel: 2 });
  assert.equal(conflict.errorCode, 'COMMAND_ID_CONFLICT');
});

test('a failed server batch has no receipt, partial spend or public building events', async t => {
  const f = await fixture(t); await f.start(); const id = f.users[0].playerId;
  f.server.store.transaction(data => {
    const game = data.rooms[f.code].game;
    for (const propertyId of [1, 3]) game.properties[propertyId].ownerId = id;
    game.players[0].cash = 75;
  });
  const before = structuredClone(f.server.store.data.rooms[f.code]);
  const rejected = await f.action(0, { type: 'buildGroup', propertyId: 1, targetLevel: 1 });
  assert.equal(rejected.ok, false); assert.match(rejected.error, /available cash/);
  assert.deepEqual(f.server.store.data.rooms[f.code], before);
});
