import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createGame, applyAction, publicGame } from '../shared/engine.js';
import { getCardDecks } from '../shared/board.js';
import { fixture } from './server-helpers.js';

const act = (game, playerId, type, fields = {}, dice) => applyAction(game, playerId, { type, ...fields }, dice ? { dice } : {});
const buyIfOffered = game => { if (game.phase === 'buy') act(game, game.currentPlayerId, 'buy', { propertyId: game.pendingPurchase }); };
const legal = (game, playerId) => publicGame(game).permittedActions[playerId];

for (const edition of ['classic', 'inland']) test(`${edition}: a held release card survives three doubles and is usable before the next turn's roll`, () => {
  const game = createGame([{ id: 'a', name: 'Card holder' }, { id: 'b', name: 'Other player' }], { edition, seed: 42, firstPlayerId: 'a' });
  const cardId = getCardDecks(game).chance.find(card => card.effect === 'jailCard').id;
  // Obtain the card through the real draw effect, so it must leave the deck.
  game._decks.chance = [cardId, ...game._decks.chance.filter(id => id !== cardId)];
  game.players[0].position = 4;
  act(game, 'a', 'roll', {}, [1, 2]);
  assert.deepEqual(game.players[0].jailCards, ['chance']);
  assert(!game._decks.chance.includes(cardId));
  act(game, 'a', 'endTurn');
  act(game, 'b', 'roll', {}, [1, 2]); buyIfOffered(game); act(game, 'b', 'endTurn');
  act(game, 'a', 'roll', {}, [1, 1]); buyIfOffered(game);
  act(game, 'a', 'roll', {}, [1, 1]); buyIfOffered(game);
  act(game, 'a', 'roll', {}, [1, 1]);
  assert.equal(game.players[0].inJail, true);
  assert.equal(game.players[0].position, 10);
  assert.equal(game.phase, 'end');
  assert.deepEqual(game.players[0].jailCards, ['chance']);
  assert(!legal(game, 'a').includes('useJailCard'));
  const justJailed = structuredClone(game);
  assert.throws(() => act(game, 'a', 'useJailCard'), /not available/);
  assert.deepEqual(game, justJailed);
  act(game, 'a', 'endTurn');
  assert(!legal(game, 'a').includes('useJailCard'));
  assert.throws(() => act(game, 'a', 'useJailCard'), /not available/);
  act(game, 'b', 'roll', {}, [1, 2]); buyIfOffered(game); act(game, 'b', 'endTurn');
  assert(legal(game, 'a').includes('useJailCard'));
  const cashBefore = game.players[0].cash;
  act(game, 'a', 'useJailCard', { deck: 'chance' });
  assert.equal(game.players[0].inJail, false);
  assert.equal(game.players[0].jailTurns, 0);
  assert.equal(game.players[0].position, 10);
  assert.equal(game.players[0].cash, cashBefore);
  assert.equal(game.phase, 'roll');
  assert.deepEqual(game.players[0].jailCards, []);
  assert.equal(game._decks.chance.at(-1), cardId);
  assert.equal(game._decks.chance.filter(id => id === cardId).length, 1);
  assert.throws(() => act(game, 'a', 'useJailCard'), /not available/);
  act(game, 'a', 'roll', {}, [1, 2]);
  assert.equal(game.players[0].position, 13);
});

test('a failed jail roll ends card eligibility until the following turn', () => {
  const game = createGame([{ id: 'a' }, { id: 'b' }], { seed: 42, firstPlayerId: 'a' });
  Object.assign(game.players[0], { inJail: true, position: 10, jailCards: ['chest'] });
  game._decks.chest = game._decks.chest.filter(id => id !== 'chest-jail-free');
  assert(legal(game, 'a').includes('useJailCard'));
  act(game, 'a', 'roll', {}, [1, 2]);
  assert.equal(game.phase, 'end');
  assert.equal(game.players[0].jailTurns, 1);
  assert(!legal(game, 'a').includes('useJailCard'));
  assert.throws(() => act(game, 'a', 'useJailCard'), /not available/);
  assert.deepEqual(game.players[0].jailCards, ['chest']);
});

test('release commands reject wrong turns and stale context, and duplicate accepted use returns the card once', async t => {
  const f = await fixture(t);
  await f.start();
  f.server.store.transaction(data => {
    const game = data.rooms[f.code].game;
    Object.assign(game.players[0], { inJail: true, position: 10, jailCards: ['chance'] });
    game._decks.chance = game._decks.chance.filter(id => id !== 'chance-jail-free');
    game.phase = 'end'; game._resumePhase = 'end';
  });
  assert.equal((await f.action(0, { type: 'useJailCard' })).ok, false);
  const oldContext = f.command({ type: 'useJailCard', deck: 'chance' });
  await f.success(0, { type: 'endTurn' });
  assert.equal((await f.action(0, { type: 'useJailCard' })).ok, false);
  // The other player's normal roll ends on a property; resolve its purchase.
  let peer = await f.success(1, { type: 'roll' });
  if (peer.game.phase === 'buy') await f.success(1, { type: 'buy', propertyId: peer.game.pendingPurchase });
  while (f.server.store.data.rooms[f.code].game.phase === 'roll') {
    peer = await f.success(1, { type: 'roll' });
    if (peer.game.phase === 'buy') await f.success(1, { type: 'buy', propertyId: peer.game.pendingPurchase });
  }
  await f.success(1, { type: 'endTurn' });
  const stale = await f.rawAction(0, oldContext);
  assert.equal(stale.errorCode, 'STALE_DECISION');
  const command = f.command({ type: 'useJailCard', deck: 'chance' });
  const used = await f.rawAction(0, command);
  assert.equal(used.ok, true);
  assert.equal(used.room.game.players[0].inJail, false);
  assert.equal(used.room.game.phase, 'roll');
  const after = structuredClone(f.server.store.data.rooms[f.code]);
  const repeated = await f.rawAction(0, command);
  assert.equal(repeated.duplicate, true);
  assert.deepEqual(f.server.store.data.rooms[f.code], after);
  assert.equal(after.game._decks.chance.filter(id => id === 'chance-jail-free').length, 1);
  assert.equal(after.game.log.filter(event => event.type === 'releaseJail').length, 1);
  assert.equal((await f.rawAction(0, { ...command, commandId: randomUUID() })).errorCode, 'STALE_DECISION');
});
