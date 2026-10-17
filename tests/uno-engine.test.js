import test from 'node:test';
import assert from 'node:assert/strict';
import { createUnoDeck, normalizeUnoRules, UNO_COLORS, unoCardPoints } from '../shared/uno-cards.js';
import { createUnoGame, applyUnoAction, applyUnoTimeout, canPlayUnoCard, publicUnoGame } from '../shared/uno-engine.js';

const players = count => Array.from({ length: count }, (_, index) => ({ id: `p${index}`, name: `Player ${index}` }));
const sizes = game => game.players.map(player => game._hands[player.id].length);
const act = (game, type, extra = {}, id = game.currentPlayerId) => applyUnoAction(game, id, { type, ...extra });

function conservation(game) {
  const cards = [...Object.values(game._hands).flat(), ...game._drawPile, ...game._discardPile];
  const expected = createUnoDeck(game.rules.edition).map(card => card.id).sort();
  assert.deepEqual(cards.map(card => card.id).sort(), expected, 'Every physical card remains in exactly one place');
}

function table({ edition = 'classic', scoreMode = 'points', hands = [['red-1-0', 'blue-1-0'], ['green-1-0', 'yellow-1-0']], top = 'red-5-0', draw = [] } = {}) {
  const game = createUnoGame(players(hands.length), { seed: 123, dealerId: `p${hands.length - 1}`, rules: { edition, scoreMode } });
  const pool = createUnoDeck(edition);
  const take = id => {
    const index = pool.findIndex(card => card.id === id);
    assert(index >= 0, `Unique fixture card ${id}`);
    return pool.splice(index, 1)[0];
  };
  game._hands = Object.fromEntries(hands.map((ids, index) => [`p${index}`, ids.map(take)]));
  game._discardPile = [take(top)];
  const firstDraws = draw.map(take);
  game._drawPile = [...pool, ...firstDraws.reverse()];
  Object.assign(game, { currentPlayerId: 'p0', phase: 'play', direction: 1, activeColor: game._discardPile[0].color, pendingColor: null, unoWindow: null, _pendingEffect: null, _pendingDrawFour: null, _ohana: null, _lastChallenge: null, _drawnCardId: null, _drawnPlayerId: null, log: [], _eventSeq: 0 });
  conservation(game);
  return game;
}

test('official editions contain 108/112 unique cards, exact action sets, and official scoring', () => {
  for (const edition of ['classic', 'stitch']) {
    const deck = createUnoDeck(edition);
    assert.equal(deck.length, edition === 'classic' ? 108 : 112);
    assert.equal(new Set(deck.map(card => card.id)).size, deck.length);
    for (const color of UNO_COLORS) {
      assert.equal(deck.filter(card => card.color === color && card.kind === 'number').length, 19);
      assert.equal(deck.filter(card => card.color === color && card.kind === 'number' && card.value === 0).length, 1);
      for (const kind of ['skip', 'reverse', 'draw-two']) assert.equal(deck.filter(card => card.color === color && card.kind === kind).length, 2);
    }
    for (const kind of ['wild', 'wild-draw-four', ...(edition === 'stitch' ? ['ohana'] : [])]) assert.equal(deck.filter(card => card.kind === kind).length, 4);
    assert(deck.every(card => card.points === unoCardPoints(card)));
  }
  assert.deepEqual(normalizeUnoRules(), { edition: 'classic', scoreMode: 'points', targetScore: 500 });
  for (const rules of [{ stacking: true }, { edition: 'fake' }, { targetScore: 100 }, { scoreMode: 'last-standing' }]) assert.throws(() => normalizeUnoRules(rules));
});

test('2–10 seats receive seven cards and edition-specific opening rules conserve the deck', () => {
  const openings = new Set();
  for (const edition of ['classic', 'stitch']) {
    for (const count of [2, 10]) {
      for (let seed = 1; seed <= 100; seed += 1) {
        const game = createUnoGame(players(count), { seed, dealerId: `p${count - 1}`, rules: { edition } });
        conservation(game);
        const opening = game._discardPile.at(-1);
        assert.notEqual(opening.kind, 'wild-draw-four');
        if (edition === 'stitch') {
          assert.equal(opening.kind, 'number');
          assert.equal(game.currentPlayerId, 'p0');
          assert.equal(game.direction, 1);
          assert(game._discardPile.slice(0, -1).every(card => card.kind !== 'number'));
          assert(sizes(game).every(size => size === 7));
        } else {
          openings.add(opening.kind);
          if (opening.kind === 'draw-two') {
            assert.equal(sizes(game)[0], 9);
            assert.equal(game.currentPlayerId, 'p1');
          } else if (opening.kind === 'reverse') {
            assert.equal(game.currentPlayerId, `p${count - 1}`);
            assert.equal(game.direction, -1);
          } else if (opening.kind === 'skip') assert.equal(game.currentPlayerId, 'p1');
          else if (opening.kind === 'wild') {
            assert.equal(game.phase, 'choose-color');
            act(game, 'uno:color', { color: 'blue' }, 'p0');
            assert.equal(game.currentPlayerId, 'p0');
            assert.equal(game.phase, 'play');
          }
        }
      }
    }
  }
  for (const kind of ['number', 'skip', 'reverse', 'draw-two', 'wild']) assert(openings.has(kind));
  for (const count of [0, 1, 11]) assert.throws(() => createUnoGame(players(count)), /2 to 10/);
});

test('matching validates color, number and action without enforcing private Wild Draw Four legality', () => {
  const game = table({ hands: [['red-1-0', 'blue-5-0', 'blue-skip-0', 'wild-draw-four-0'], ['green-1-0']] });
  assert(canPlayUnoCard(game, game._hands.p0[0]));
  assert(canPlayUnoCard(game, game._hands.p0[1]));
  assert.equal(canPlayUnoCard(game, game._hands.p0[2]), false);
  assert(canPlayUnoCard(game, game._hands.p0[3]), 'Bluffing a Wild Draw Four is allowed');
  const before = structuredClone(game);
  assert.throws(() => act(game, 'uno:play', { cardId: 'blue-skip-0' }), /Match the color/);
  assert.throws(() => act(game, 'uno:draw', {}, 'p1'), /not available/);
  assert.throws(() => act(game, 'uno:play', { cardId: 'red-1-0', state: {} }), /unsupported/);
  assert.deepEqual(game, before, 'Invalid choices make no mutation');
  act(game, 'uno:play', { cardId: 'wild-draw-four-0', color: 'green' });
  assert.equal(game.phase, 'draw-four');
  assert.equal(game._pendingDrawFour.illegal, true);
  conservation(game);
  const matchAction = table({ top: 'red-skip-0', hands: [['blue-skip-0', 'green-2-0'], ['red-2-0']] });
  assert(canPlayUnoCard(matchAction, matchAction._hands.p0[0]));
});

test('Skip, Reverse and Draw Two skip correctly with two seats; Reverse changes direction with more seats', () => {
  for (const kind of ['skip', 'reverse', 'draw-two']) {
    const game = table({ hands: [[`red-${kind}-0`, 'blue-1-0'], ['green-1-0', 'yellow-1-0']] });
    act(game, 'uno:play', { cardId: `red-${kind}-0`, callUno: true });
    assert.equal(game.currentPlayerId, 'p0');
    assert.equal(game.turn, 2);
    assert.deepEqual(sizes(game), [1, kind === 'draw-two' ? 4 : 2]);
    conservation(game);
  }
  const game = table({ hands: [['red-reverse-0', 'blue-1-0'], ['green-1-0'], ['yellow-1-0']] });
  act(game, 'uno:play', { cardId: 'red-reverse-0' });
  assert.equal(game.currentPlayerId, 'p2');
  assert.equal(game.direction, -1);
});

test('drawing permits only the new card, keeps a uniform public choice, and timeout draws then passes', () => {
  for (const newCard of ['green-4-0', 'red-4-0']) {
    const game = table({ draw: [newCard] });
    act(game, 'uno:draw');
    assert.equal(game.phase, 'drawn', 'Even an unplayable card gets a pass choice, avoiding an opponent playability leak');
    assert.equal(publicUnoGame(game, 'p0').drawnCardId, newCard);
    assert.equal(publicUnoGame(game, 'p1').drawnCardId, null);
    assert.deepEqual(publicUnoGame(game, 'p1').playableCardIds, []);
    assert.throws(() => act(game, 'uno:play', { cardId: 'red-1-0' }), /only the drawn/);
    assert.throws(() => act(game, 'uno:draw'), /not available/);
    act(game, 'uno:pass');
    assert.equal(game.currentPlayerId, 'p1');
    conservation(game);
  }
  const playable = table({ draw: ['red-4-0'] });
  act(playable, 'uno:draw');
  act(playable, 'uno:play', { cardId: 'red-4-0' });
  assert.equal(playable.currentPlayerId, 'p1');
  const timeout = table({ draw: ['red-4-0'] });
  applyUnoTimeout(timeout, 'p0');
  assert.equal(timeout.phase, 'play');
  assert.equal(timeout.currentPlayerId, 'p1');
  assert.deepEqual(sizes(timeout), [3, 2]);
  act(timeout, 'uno:draw');
  const count = timeout._hands.p1.length;
  applyUnoTimeout(timeout, 'p1');
  assert.equal(timeout._hands.p1.length, count, 'An already drawn card is passed without drawing again');
});

test('Wild Draw Four challenges use a private play-time hand snapshot and preserve chosen color', () => {
  const game = table({ hands: [['wild-draw-four-0', 'red-1-0'], ['green-1-0'], ['yellow-1-0']], draw: ['blue-2-0', 'blue-3-0'] });
  act(game, 'uno:play', { cardId: 'wild-draw-four-0', color: 'blue' });
  assert.throws(() => act(game, 'uno:challenge', {}, 'p2'), /not available/);
  act(game, 'uno:catch', { targetPlayerId: 'p0' }, 'p2');
  assert.equal(game._hands.p0.length, 3);
  act(game, 'uno:challenge');
  assert.equal(game.currentPlayerId, 'p1');
  assert.equal(game.phase, 'play');
  assert.equal(game.activeColor, 'blue');
  assert.deepEqual(sizes(game), [7, 1, 1]);
  assert.deepEqual(publicUnoGame(game, 'p1').lastChallenge.cards.map(card => card.id), ['red-1-0'], 'Evidence excludes cards drawn after the Wild Draw Four');
  for (const viewer of ['p0', 'p2', null]) {
    assert.equal(publicUnoGame(game, viewer).lastChallenge.cards, undefined);
    assert.equal(publicUnoGame(game, viewer).lastChallenge.challengedColor, undefined);
  }
  conservation(game);
});

test('Classic permits other Wilds and same-number cards for a Wild Draw Four; Stitch counts other Wilds as a color match', () => {
  for (const edition of ['classic', 'stitch']) {
    for (const held of ['wild-0', 'blue-5-0', 'red-1-0', ...(edition === 'stitch' ? ['ohana-0'] : [])]) {
      const game = table({ edition, hands: [['wild-draw-four-0', held], ['green-1-0'], ['yellow-1-0']] });
      act(game, 'uno:play', { cardId: 'wild-draw-four-0', color: 'green', callUno: true });
      const successful = held === 'red-1-0' || (edition === 'stitch' && ['wild-0', 'ohana-0'].includes(held));
      act(game, 'uno:challenge');
      assert.equal(game._lastChallenge.successful, successful, `${edition}: ${held}`);
      assert.deepEqual(sizes(game), successful ? [5, 1, 1] : [1, 7, 1]);
      assert.equal(game.currentPlayerId, successful ? 'p1' : 'p2');
      conservation(game);
    }
  }
});

test('final Draw Two and Wild Draw Four penalties settle before scoring and a 500-point match continues by round', () => {
  const two = table({ hands: [['red-draw-two-0'], ['blue-1-0']], draw: ['red-2-0', 'green-3-0'], scoreMode: 'single-round' });
  act(two, 'uno:play', { cardId: 'red-draw-two-0' });
  assert.equal(two.status, 'finished');
  assert.equal(two.roundScore, 6);
  assert.deepEqual(sizes(two), [0, 3]);
  for (const choice of ['uno:accept-draw', 'uno:challenge']) {
    const four = table({ hands: [['wild-draw-four-0'], ['blue-1-0']], draw: ['red-2-0', 'green-3-0', 'yellow-4-0', 'blue-6-0', 'green-7-0', 'red-8-0'] });
    act(four, 'uno:play', { cardId: 'wild-draw-four-0' });
    assert.equal(four.phase, 'choose-color');
    assert.equal(four.roundWinnerId, null);
    assert.throws(() => applyUnoTimeout(four, 'p0'), /paused/);
    act(four, 'uno:color', { color: 'red' });
    assert.equal(four.phase, 'draw-four');
    assert.equal(four.roundWinnerId, null);
    act(four, choice);
    assert.equal(four.status, 'round-over');
    assert.equal(four.roundScore, choice === 'uno:challenge' ? 31 : 16);
    assert.equal(four.roundHistory.length, 1);
    const score = four.players[0].score;
    const dealerId = four.dealerId;
    act(four, 'uno:next-round', {}, 'p0');
    assert.equal(four.round, 2);
    assert.notEqual(four.dealerId, dealerId);
    assert.equal(four.players[0].score, score);
    assert.equal(four.roundHistory.length, 1);
    conservation(four);
  }
  const match = table({ hands: [['red-1-0'], ['blue-1-0']] });
  match.players[0].score = 499;
  act(match, 'uno:play', { cardId: 'red-1-0' });
  assert.equal(match.players[0].score, 500);
  assert.equal(match.winnerId, 'p0');
  assert.equal(match.status, 'finished');
});

test('UNO calls are atomic, can beat a catch, and close only when the next player draws or plays', () => {
  for (const callUno of [true, false]) {
    const game = table({ hands: [['red-1-0', 'blue-1-0'], ['green-2-0', 'yellow-2-0']] });
    act(game, 'uno:play', { cardId: 'red-1-0', callUno });
    assert.equal(game.unoWindow.called, callUno);
    if (callUno) assert.throws(() => act(game, 'uno:catch', { targetPlayerId: 'p0' }), /not available/);
    else {
      const before = structuredClone(game);
      assert.throws(() => act(game, 'uno:play', { cardId: 'green-2-0' }), /Match the color/);
      assert.deepEqual(game, before, 'A rejected next action does not close the catch window');
      act(game, 'uno:catch', { targetPlayerId: 'p0' });
      assert.equal(game._hands.p0.length, 3);
      assert.equal(game.unoWindow, null);
    }
  }
  const selfCall = table();
  act(selfCall, 'uno:play', { cardId: 'red-1-0' });
  act(selfCall, 'uno:call', {}, 'p0');
  assert.equal(selfCall.unoWindow.called, true);
  const draw = table();
  act(draw, 'uno:play', { cardId: 'red-1-0' });
  act(draw, 'uno:draw');
  assert.equal(draw.unoWindow, null);
  assert.throws(() => act(draw, 'uno:call', {}, 'p0'), /not available/);
  const play = table({ hands: [['red-1-0', 'blue-1-0'], ['red-2-0', 'green-2-0']] });
  act(play, 'uno:play', { cardId: 'red-1-0' });
  act(play, 'uno:play', { cardId: 'red-2-0', callUno: true });
  assert.equal(play.unoWindow.playerId, 'p1');
  assert.throws(() => act(play, 'uno:catch', { targetPlayerId: 'p0' }, 'p0'), /not available/);
});

test('Ohana applies to every player, privately discards excess before all draw-ups, then chooses color', () => {
  const game = table({ edition: 'stitch', hands: [
    ['ohana-0', 'red-1-0', 'red-2-0', 'red-3-0', 'red-4-0', 'red-6-0', 'red-7-0'],
    ['blue-1-0', 'blue-2-0', 'blue-3-0', 'blue-4-0', 'blue-5-0', 'blue-6-0', 'blue-7-0'],
    ['green-1-0', 'green-2-0'],
  ] });
  const before = structuredClone(game);
  assert.throws(() => act(game, 'uno:play', { cardId: 'ohana-0', color: 'red' }), /after any Ohana/);
  assert.deepEqual(game, before);
  act(game, 'uno:play', { cardId: 'ohana-0' });
  assert.equal(game.phase, 'ohana');
  assert.equal(game.pendingColor, null);
  const waiting = structuredClone(game);
  assert.throws(() => act(game, 'uno:ohana', { cardIds: ['red-1-0'] }), /exactly the excess/);
  assert.throws(() => act(game, 'uno:ohana', { cardIds: ['red-1-0', 'red-1-0'] }), /exactly the excess/);
  assert.deepEqual(game, waiting);
  act(game, 'uno:ohana', { cardIds: ['red-1-0', 'red-2-0'] });
  assert.deepEqual(sizes(game), [4, 7, 2], 'Short hands do not draw before all excess choices commit');
  act(game, 'uno:ohana', { cardIds: ['blue-1-0', 'blue-2-0', 'blue-3-0'] }, 'p1');
  assert.deepEqual(sizes(game), [4, 4, 4]);
  assert.equal(game._discardPile.at(-1).kind, 'ohana');
  assert.equal(game.phase, 'choose-color');
  assert.deepEqual(game.pendingColor, { playerId: 'p0' });
  assert.equal(game._ohana, null);
  act(game, 'uno:color', { color: 'yellow' }, 'p0');
  assert.equal(game.currentPlayerId, 'p1');
  assert.equal(game.activeColor, 'yellow');
  conservation(game);
  const final = table({ edition: 'stitch', hands: [['ohana-0'], ['blue-1-0', 'blue-2-0']] });
  act(final, 'uno:play', { cardId: 'ohana-0' });
  assert.deepEqual(sizes(final), [4, 4], 'Documented online interpretation finishes Ohana even when it was the last card');
  assert.equal(final.roundWinnerId, null);
  assert.equal(final.phase, 'choose-color');
  act(final, 'uno:color', { color: 'green' });
  assert.equal(final.status, 'playing');
  conservation(final);
});

test('reshuffling preserves the top discard and handles every other card being held', () => {
  const game = table();
  const top = game._discardPile.at(-1);
  game._discardPile = [...game._drawPile, top];
  game._drawPile = [];
  act(game, 'uno:draw');
  assert.equal(game._discardPile.length, 1);
  assert.equal(game._discardPile[0].id, top.id);
  assert(game.log.some(item => item.type === 'reshuffle'));
  conservation(game);
  const exhausted = table();
  exhausted._hands.p1.push(...exhausted._drawPile);
  exhausted._drawPile = [];
  act(exhausted, 'uno:draw');
  assert.equal(exhausted.currentPlayerId, 'p1');
  assert.equal(exhausted._hands.p0.length, 2);
  conservation(exhausted);
});

test('public projections allowlist nested data and keep guilt, other hands, RNG and draw order private', () => {
  const game = table({ hands: [['wild-draw-four-0', 'red-1-0'], ['blue-3-0', 'blue-4-0'], ['green-1-0']] });
  act(game, 'uno:play', { cardId: 'wild-draw-four-0' });
  game.hiddenSecret = 'PRIVATE_SENTINEL';
  game.players[0].privateHand = 'PRIVATE_SENTINEL';
  game._hands.p1[0].privateProperty = 'PRIVATE_SENTINEL';
  game._discardPile.at(-1).privateProperty = 'PRIVATE_SENTINEL';
  game.log[0].privateHand = 'PRIVATE_SENTINEL';
  game.log.push({ type: 'future-private', cards: 'PRIVATE_SENTINEL' });
  game.pendingColor.privateHand = 'PRIVATE_SENTINEL';
  game.unoWindow.privateHand = 'PRIVATE_SENTINEL';
  for (const viewer of ['p0', 'p1', 'p2', null, 'stranger']) {
    const view = publicUnoGame(game, viewer);
    const raw = JSON.stringify(view);
    assert.equal(raw.includes('PRIVATE_SENTINEL'), false);
    assert.equal(Object.keys(view).some(key => key.startsWith('_')), false);
    assert.equal(view._hands, undefined);
    assert.equal(view._randomState, undefined);
    assert.equal(view._drawPile, undefined);
    assert.equal(view._discardPile, undefined);
    assert.equal(view._pendingEffect, undefined);
    assert.equal(view.hand.length, game._hands[viewer]?.length ?? 0);
    if (viewer !== 'p0') assert.equal(raw.includes('red-1-0'), false);
  }
  act(game, 'uno:color', { color: 'blue' });
  const changed = structuredClone(game);
  changed._pendingDrawFour.illegal = !changed._pendingDrawFour.illegal;
  changed._pendingDrawFour.cards = [{ ...changed._pendingDrawFour.cards[0], color: 'yellow' }];
  changed._hands.p0[0] = { ...changed._hands.p0[0], color: 'yellow', id: 'different-private-card' };
  assert.deepEqual(publicUnoGame(game, 'p1'), publicUnoGame(changed, 'p1'), 'A challenger cannot infer guilt or hidden-card playability before challenging');
  const view = publicUnoGame(game, 'p1');
  view.hand[0].label = 'Mutated client copy';
  assert.notEqual(game._hands.p1[0].label, 'Mutated client copy');
});

test('seeded complete games and repeated reshuffles preserve every card with 2 and 10 players', () => {
  for (const edition of ['classic', 'stitch']) for (const count of [2, 10]) for (const seed of [11, 337, 899]) {
    const game = createUnoGame(players(count), { seed, rules: { edition, scoreMode: 'single-round' } });
    let actions = 0;
    while (game.status === 'playing' && actions < 2500) {
      const id = game.currentPlayerId;
      if (game.phase === 'choose-color') act(game, 'uno:color', { color: UNO_COLORS[actions % 4] }, game.pendingColor.playerId);
      else if (game.phase === 'draw-four') act(game, actions % 3 ? 'uno:accept-draw' : 'uno:challenge');
      else if (game.phase === 'ohana') {
        const chooser = game._ohana.playerIds.find(playerId => !game._ohana.completedPlayerIds.includes(playerId));
        act(game, 'uno:ohana', { cardIds: game._hands[chooser].slice(4).map(card => card.id) }, chooser);
      } else {
        const cardId = publicUnoGame(game, id).playableCardIds[0];
        if (cardId) act(game, 'uno:play', { cardId, callUno: true });
        else act(game, game.phase === 'drawn' ? 'uno:pass' : 'uno:draw');
      }
      actions += 1;
      conservation(game);
    }
    assert.equal(game.status, 'finished', `${edition}, ${count} players, seed ${seed} should finish`);
    assert(game.roundScore >= 0);
  }
});
