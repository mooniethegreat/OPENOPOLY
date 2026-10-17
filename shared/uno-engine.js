import { createUnoDeck, normalizeUnoRules, UNO_COLORS, UNO_EDITIONS, unoCardPoints } from './uno-cards.js';

const requireRule = (condition, message) => { if (!condition) throw new Error(message); };
const participant = (game, id) => game.players.find(player => player.id === id);
const hand = (game, id) => game._hands[id];
const topCard = game => game._discardPile.at(-1) ?? null;
const copy = value => value == null ? value : structuredClone(value);
const publicCard = card => card ? Object.fromEntries(['id', 'definitionId', 'kind', 'color', 'value', 'label', 'points'].map(key => [key, card[key]])) : null;
const PUBLIC_EVENT_FIELDS = {
  reshuffle: [], draw: ['playerId', 'count', 'reason'], turn: ['playerId'], uno: ['playerId'],
  'round-start': ['dealerId', 'card'], 'round-won': ['playerId', 'points', 'score'], 'game-won': ['playerId', 'score'],
  'uno-caught': ['playerId', 'targetPlayerId'], pass: ['playerId'], color: ['playerId', 'color'],
  'draw-four-pending': ['playerId', 'offenderId'], play: ['playerId', 'card'],
  challenge: ['offenderId', 'playerId', 'successful', 'drawCount'],
  'ohana-complete': ['playerId'], 'ohana-discard': ['playerId', 'count'],
};

function publicLog(game) {
  return game.log.filter(item => Object.hasOwn(PUBLIC_EVENT_FIELDS, item.type)).map(item => Object.fromEntries(
    [...['id', 'seq', 'type', 'turn', 'round', 'at', 'message'], ...PUBLIC_EVENT_FIELDS[item.type]]
      .map(key => [key, key === 'card' ? publicCard(item.card) : item[key]])
  ));
}

function event(game, type, data = {}, message = '') {
  const seq = ++game._eventSeq;
  game.log.push({ ...data, id: `uno-event-${seq}`, seq, type, turn: game.turn, round: game.round, at: new Date().toISOString(), message });
  if (game.log.length > 300) game.log.splice(0, game.log.length - 300);
}

function random(game) {
  let value = game._randomState | 0;
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  game._randomState = value >>> 0;
  return game._randomState / 0x100000000;
}

function shuffle(game, cards) {
  const result = cards.slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random(game) * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function nextId(game, fromId, steps = 1) {
  const index = game.players.findIndex(player => player.id === fromId);
  return game.players[(index + game.direction * steps + game.players.length * steps) % game.players.length].id;
}

function drawCards(game, playerId, count, reason) {
  const cards = [];
  for (let index = 0; index < count; index += 1) {
    if (!game._drawPile.length && game._discardPile.length > 1) {
      const top = game._discardPile.pop();
      game._drawPile = shuffle(game, game._discardPile);
      game._discardPile = [top];
      event(game, 'reshuffle', {}, 'The discard pile was shuffled into a new draw pile.');
    }
    if (!game._drawPile.length) break;
    const card = game._drawPile.pop();
    hand(game, playerId).push(card);
    cards.push(card);
  }
  if (cards.length) {
    participant(game, playerId).unoCalled = false;
    if (game.unoWindow?.playerId === playerId) game.unoWindow = null;
  }
  // Draw events intentionally contain no card IDs or definitions.
  event(game, 'draw', { playerId, count: cards.length, reason }, `${participant(game, playerId).name} draws ${cards.length} card${cards.length === 1 ? '' : 's'}.`);
  return cards;
}

function clearDrawn(game) {
  game._drawnCardId = null;
  game._drawnPlayerId = null;
}

function advance(game, fromId, steps = 1) {
  clearDrawn(game);
  game.pendingColor = null;
  game._pendingEffect = null;
  game._pendingDrawFour = null;
  game._ohana = null;
  game.currentPlayerId = nextId(game, fromId, steps);
  game.turn += 1;
  game.phase = 'play';
  event(game, 'turn', { playerId: game.currentPlayerId }, `${participant(game, game.currentPlayerId).name}'s turn.`);
}

function closeUnoWindow(game) { game.unoWindow = null; }

function updateUnoWindow(game, playerId, called) {
  const player = participant(game, playerId);
  player.unoCalled = hand(game, playerId).length === 1 && called;
  game.unoWindow = hand(game, playerId).length === 1 ? { playerId, called: player.unoCalled } : null;
  if (player.unoCalled) event(game, 'uno', { playerId }, `${player.name} calls UNO!`);
}

function finishRound(game, winnerId) {
  const points = game.players.filter(player => player.id !== winnerId).reduce((sum, player) => sum + hand(game, player.id).reduce((total, card) => total + unoCardPoints(card), 0), 0);
  const winner = participant(game, winnerId);
  winner.score += points;
  game.roundWinnerId = winnerId;
  game.roundScore = points;
  game.roundHistory.push({ round: game.round, winnerId, points, scores: Object.fromEntries(game.players.map(player => [player.id, player.score])) });
  const finished = game.rules.scoreMode === 'single-round' || winner.score >= game.rules.targetScore;
  game.status = finished ? 'finished' : 'round-over';
  game.phase = finished ? 'game-over' : 'round-over';
  game.winnerId = finished ? winnerId : null;
  game.pendingColor = null;
  game._pendingEffect = null;
  game._pendingDrawFour = null;
  game._ohana = null;
  clearDrawn(game);
  closeUnoWindow(game);
  event(game, 'round-won', { playerId: winnerId, points, score: winner.score }, `${winner.name} wins round ${game.round} and scores ${points} points.`);
  if (finished) event(game, 'game-won', { playerId: winnerId, score: winner.score }, `${winner.name} wins the match.`);
}

function finishIfEmpty(game, playerId) {
  if (hand(game, playerId).length) return false;
  finishRound(game, playerId);
  return true;
}

function dealRound(game) {
  game._drawPile = shuffle(game, createUnoDeck(game.rules.edition));
  game._discardPile = [];
  game._hands = Object.fromEntries(game.players.map(player => [player.id, []]));
  game.direction = 1;
  game.status = 'playing';
  game.phase = 'play';
  game.activeColor = null;
  game.roundWinnerId = null;
  game.roundScore = 0;
  game.pendingColor = null;
  game._pendingEffect = null;
  game._pendingDrawFour = null;
  game._lastChallenge = null;
  game._ohana = null;
  game.unoWindow = null;
  clearDrawn(game);
  for (const player of game.players) player.unoCalled = false;
  const firstId = nextId(game, game.dealerId);
  for (let card = 0; card < 7; card += 1) {
    let playerId = firstId;
    for (let seat = 0; seat < game.players.length; seat += 1) {
      hand(game, playerId).push(game._drawPile.pop());
      playerId = nextId(game, playerId);
    }
  }
  let opening;
  do {
    opening = game._drawPile.pop();
    if (game.rules.edition === 'classic' && opening.kind === 'wild-draw-four') {
      game._drawPile = shuffle(game, [...game._drawPile, opening]);
      opening = null;
    } else if (game.rules.edition === 'stitch' && opening.kind !== 'number') {
      game._discardPile.push(opening);
      opening = null;
    }
  } while (!opening);
  game._discardPile.push(opening);
  game.activeColor = opening.color === 'wild' ? null : opening.color;
  game.currentPlayerId = firstId;
  event(game, 'round-start', { dealerId: game.dealerId, card: copy(opening) }, `Round ${game.round} begins. Each player receives seven cards.`);
  if (game.rules.edition === 'classic') {
    if (opening.kind === 'draw-two') {
      drawCards(game, firstId, 2, 'opening-draw-two');
      game.currentPlayerId = nextId(game, firstId);
    } else if (opening.kind === 'skip') game.currentPlayerId = nextId(game, firstId);
    else if (opening.kind === 'reverse') {
      game.direction = -1;
      game.currentPlayerId = game.dealerId;
    } else if (opening.kind === 'wild') {
      game.phase = 'choose-color';
      game.pendingColor = { playerId: firstId };
      game._pendingEffect = { kind: 'opening-wild', actorId: firstId };
    }
  }
  event(game, 'turn', { playerId: game.currentPlayerId }, `${participant(game, game.currentPlayerId).name} takes the first turn.`);
}

export function createUnoGame(inputPlayers, options = {}) {
  requireRule(Array.isArray(inputPlayers) && inputPlayers.length >= 2 && inputPlayers.length <= 10, 'UNO requires 2 to 10 players');
  requireRule(inputPlayers.every(player => typeof player.id === 'string' && player.id) && new Set(inputPlayers.map(player => player.id)).size === inputPlayers.length, 'Players need unique IDs');
  const rules = normalizeUnoRules(options.rules ?? { edition: options.edition ?? 'classic', scoreMode: options.scoreMode ?? 'points' });
  const game = {
    kind: 'uno', rules, status: 'playing', phase: 'play', round: 1, turn: 1,
    players: inputPlayers.map((player, index) => ({ id: player.id, name: String(player.name || `Player ${index + 1}`).slice(0, 32), token: player.token ?? null, color: player.color ?? null, score: 0, unoCalled: false })),
    currentPlayerId: null, dealerId: null, direction: 1, activeColor: null, winnerId: null,
    roundWinnerId: null, roundScore: 0, roundHistory: [], log: [], pendingColor: null, unoWindow: null,
    _hands: {}, _drawPile: [], _discardPile: [], _drawnCardId: null, _drawnPlayerId: null,
    _pendingEffect: null, _pendingDrawFour: null, _ohana: null, _lastChallenge: null,
    _randomState: ((options.seed ?? Math.floor(Math.random() * 0xffffffff)) >>> 0) || 2463534242, _eventSeq: 0,
  };
  requireRule(options.dealerId === undefined || participant(game, options.dealerId), 'Unknown UNO dealer');
  game.dealerId = options.dealerId ?? game.players[Math.floor(random(game) * game.players.length)].id;
  dealRound(game);
  return game;
}

export function canPlayUnoCard(game, card) {
  const top = topCard(game);
  if (!card || !top) return false;
  return card.color === 'wild' || card.color === game.activeColor ||
    (card.kind === 'number' && top.kind === 'number' && card.value === top.value) ||
    (card.kind !== 'number' && card.color !== 'wild' && card.kind === top.kind);
}

function finishOhana(game) {
  const actorId = game._ohana.actorId;
  // Printed order is excess discards first, then every short hand draws.
  for (const player of game.players) {
    if (hand(game, player.id).length < 4) drawCards(game, player.id, 4 - hand(game, player.id).length, 'ohana');
    player.unoCalled = false;
  }
  closeUnoWindow(game);
  event(game, 'ohana-complete', { playerId: actorId }, 'Ohana: everyone now has four cards.');
  // The printed sequence chooses the resumed color after all hands reach four.
  game._ohana = null;
  game.pendingColor = { playerId: actorId };
  game._pendingEffect = { kind: 'ohana-complete', actorId };
  game.phase = 'choose-color';
}

function beginOhana(game, actorId) {
  const playerIds = game.players.filter(player => hand(game, player.id).length > 4).map(player => player.id);
  game._ohana = { actorId, playerIds, completedPlayerIds: [] };
  game.activeColor = null;
  game.phase = 'ohana';
  // Resolve Ohana for the actor too, even if it was their final card. The
  // printed last-card rule is ambiguous here; this table completes the effect
  // before checking for a win, so the actor draws back up to four.
  if (!playerIds.length) finishOhana(game);
}

function resolveWild(game) {
  const effect = game._pendingEffect;
  game.pendingColor = null;
  game._pendingEffect = null;
  if (effect.kind === 'opening-wild') { game.phase = 'play'; return; }
  if (effect.kind === 'wild-draw-four') {
    game._pendingDrawFour = { offenderId: effect.actorId, playerId: nextId(game, effect.actorId), previousColor: effect.previousColor, cards: effect.cards, illegal: effect.illegal };
    game.currentPlayerId = game._pendingDrawFour.playerId;
    game.turn += 1;
    game.phase = 'draw-four';
    event(game, 'draw-four-pending', { playerId: game.currentPlayerId, offenderId: effect.actorId }, `${participant(game, game.currentPlayerId).name} may accept four cards or challenge.`);
  } else if (!finishIfEmpty(game, effect.actorId)) advance(game, effect.actorId);
}

function legalActions(game, playerId, hostId) {
  const player = participant(game, playerId);
  if (!player) return [];
  if (game.status === 'round-over') return !hostId || hostId === playerId ? ['uno:next-round'] : [];
  if (game.status !== 'playing') return [];
  const actions = [];
  if (game.unoWindow?.playerId === playerId && !game.unoWindow.called) actions.push('uno:call');
  if (game.unoWindow && game.unoWindow.playerId !== playerId && !game.unoWindow.called) actions.push('uno:catch');
  if (game.phase === 'choose-color' && game.pendingColor?.playerId === playerId) actions.push('uno:color');
  if (game.phase === 'draw-four' && game._pendingDrawFour?.playerId === playerId) actions.push('uno:accept-draw', 'uno:challenge');
  if (game.phase === 'ohana' && game._ohana?.playerIds.includes(playerId) && !game._ohana.completedPlayerIds.includes(playerId)) actions.push('uno:ohana');
  if (game.currentPlayerId === playerId && game.phase === 'play') actions.push('uno:play', 'uno:draw');
  if (game.currentPlayerId === playerId && game.phase === 'drawn') actions.push('uno:play', 'uno:pass');
  return actions;
}

export function getUnoLegalActions(game, playerId, options = {}) { return legalActions(game, playerId, options.hostId); }

function validateFields(action) {
  const fields = {
    'uno:play': ['type', 'cardId', 'color', 'callUno'], 'uno:draw': ['type'], 'uno:pass': ['type'],
    'uno:color': ['type', 'color'], 'uno:accept-draw': ['type'], 'uno:challenge': ['type'],
    'uno:call': ['type'], 'uno:catch': ['type', 'targetPlayerId'], 'uno:ohana': ['type', 'cardIds'], 'uno:next-round': ['type'],
  }[action.type];
  requireRule(fields && Object.keys(action).every(key => fields.includes(key)), 'Unknown or unsupported UNO action field');
}

export function applyUnoAction(game, playerId, action) {
  requireRule(game?.kind === 'uno' && participant(game, playerId), 'Only an UNO player can act');
  requireRule(action && typeof action === 'object' && !Array.isArray(action), 'Choose an UNO action');
  validateFields(action);
  requireRule(legalActions(game, playerId).includes(action.type), 'That UNO action is not available at this point');
  if (action.type === 'uno:next-round') {
    game.round += 1; game.turn += 1;
    game.dealerId = nextId({ ...game, direction: 1 }, game.dealerId);
    dealRound(game);
    return game;
  }
  if (action.type === 'uno:call') {
    requireRule(hand(game, playerId).length === 1, 'Call UNO when you have one card');
    game.unoWindow.called = true;
    participant(game, playerId).unoCalled = true;
    event(game, 'uno', { playerId }, `${participant(game, playerId).name} calls UNO!`);
  } else if (action.type === 'uno:catch') {
    requireRule(game.unoWindow?.playerId === action.targetPlayerId && !game.unoWindow.called, 'That player cannot be caught now');
    requireRule(action.targetPlayerId !== playerId && hand(game, action.targetPlayerId).length === 1, 'Catch another player who forgot UNO');
    const targetId = action.targetPlayerId;
    closeUnoWindow(game);
    drawCards(game, targetId, 2, 'missed-uno');
    event(game, 'uno-caught', { playerId, targetPlayerId: targetId }, `${participant(game, playerId).name} catches ${participant(game, targetId).name} without UNO.`);
  } else if (action.type === 'uno:draw') {
    closeUnoWindow(game);
    const [card] = drawCards(game, playerId, 1, 'turn');
    if (card) {
      game._drawnCardId = card.id;
      game._drawnPlayerId = playerId;
      // Every draw gets the same public play/pass phase. Auto-passing only
      // unplayable cards would reveal a property of the private drawn card.
      game.phase = 'drawn';
    } else advance(game, playerId);
  } else if (action.type === 'uno:pass') {
    event(game, 'pass', { playerId }, `${participant(game, playerId).name} keeps the drawn card and passes.`);
    advance(game, playerId);
  } else if (action.type === 'uno:color') {
    requireRule(UNO_COLORS.includes(action.color), 'Choose an UNO color');
    game.activeColor = action.color;
    event(game, 'color', { playerId, color: action.color }, `${participant(game, playerId).name} chooses ${UNO_EDITIONS[game.rules.edition].colorNames[action.color]}.`);
    resolveWild(game);
  } else if (action.type === 'uno:play') {
    requireRule(typeof action.cardId === 'string', 'Choose a card from your hand');
    requireRule(action.callUno === undefined || typeof action.callUno === 'boolean', 'UNO call must be true or false');
    const index = hand(game, playerId).findIndex(card => card.id === action.cardId);
    requireRule(index >= 0, 'That card is not in your hand');
    const card = hand(game, playerId)[index];
    requireRule(game.phase !== 'drawn' || card.id === game._drawnCardId, 'After drawing, only the drawn card may be played');
    requireRule(canPlayUnoCard(game, card), 'Match the color, number, or action, or play a Wild');
    requireRule(action.color === undefined || (card.color === 'wild' && card.kind !== 'ohana' && UNO_COLORS.includes(action.color)), 'Choose a valid color for a Wild card after any Ohana choices');
    const previousColor = game.activeColor;
    // A Wild Draw Four can be bluffed. Only a challenge tests this private evidence.
    const evidence = hand(game, playerId).filter(held => held.id !== card.id);
    const illegal = evidence.some(held => held.color === previousColor || (game.rules.edition === 'stitch' && held.color === 'wild'));
    closeUnoWindow(game);
    game._lastChallenge = null;
    hand(game, playerId).splice(index, 1);
    game._discardPile.push(card);
    clearDrawn(game);
    updateUnoWindow(game, playerId, action.callUno === true);
    event(game, 'play', { playerId, card: copy(card) }, `${participant(game, playerId).name} plays ${card.color === 'wild' ? '' : `${UNO_EDITIONS[game.rules.edition].colorNames[card.color]} `}${card.label}.`);
    if (card.kind === 'ohana') {
      beginOhana(game, playerId);
    } else if (card.color === 'wild') {
      game._pendingEffect = { kind: card.kind, actorId: playerId, previousColor, cards: copy(evidence), illegal };
      if (action.color !== undefined) {
        game.activeColor = action.color;
        event(game, 'color', { playerId, color: action.color }, `${participant(game, playerId).name} chooses ${UNO_EDITIONS[game.rules.edition].colorNames[action.color]}.`);
        resolveWild(game);
      } else {
        game.activeColor = null;
        game.pendingColor = { playerId };
        game.phase = 'choose-color';
      }
    } else {
      game.activeColor = card.color;
      let steps = 1;
      if (card.kind === 'skip') steps = 2;
      if (card.kind === 'reverse') { game.direction *= -1; if (game.players.length === 2) steps = 2; }
      if (card.kind === 'draw-two') { drawCards(game, nextId(game, playerId), 2, 'draw-two'); steps = 2; }
      if (!finishIfEmpty(game, playerId)) advance(game, playerId, steps);
    }
  } else if (['uno:accept-draw', 'uno:challenge'].includes(action.type)) {
    const pending = game._pendingDrawFour;
    if (action.type === 'uno:challenge') {
      const successful = pending.illegal;
      game._lastChallenge = { offenderId: pending.offenderId, challengerId: playerId, successful, drawCount: successful ? 4 : 6, cards: copy(pending.cards), challengedColor: pending.previousColor };
      event(game, 'challenge', { offenderId: pending.offenderId, playerId, successful, drawCount: successful ? 4 : 6 }, `${participant(game, playerId).name}'s challenge ${successful ? 'succeeds' : 'fails'}.`);
      if (successful) {
        drawCards(game, pending.offenderId, 4, 'successful-challenge');
        game._pendingDrawFour = null;
        game.phase = 'play';
      } else {
        closeUnoWindow(game);
        drawCards(game, playerId, 6, 'failed-challenge');
        if (!finishIfEmpty(game, pending.offenderId)) advance(game, playerId);
      }
    } else {
      closeUnoWindow(game);
      drawCards(game, playerId, 4, 'wild-draw-four');
      if (!finishIfEmpty(game, pending.offenderId)) advance(game, playerId);
    }
  } else if (action.type === 'uno:ohana') {
    requireRule(Array.isArray(action.cardIds) && action.cardIds.length === hand(game, playerId).length - 4 && new Set(action.cardIds).size === action.cardIds.length && action.cardIds.every(id => typeof id === 'string' && hand(game, playerId).some(card => card.id === id)), 'Choose exactly the excess cards to leave four in your hand');
    const chosen = hand(game, playerId).filter(card => action.cardIds.includes(card.id));
    game._hands[playerId] = hand(game, playerId).filter(card => !action.cardIds.includes(card.id));
    const top = game._discardPile.pop();
    game._discardPile.push(...chosen, top);
    game._ohana.completedPlayerIds.push(playerId);
    participant(game, playerId).unoCalled = false;
    event(game, 'ohana-discard', { playerId, count: chosen.length }, `${participant(game, playerId).name} chooses ${chosen.length} excess card${chosen.length === 1 ? '' : 's'} to place under Ohana.`);
    if (game._ohana.completedPlayerIds.length === game._ohana.playerIds.length) finishOhana(game);
  }
  return game;
}

/** An explicit allowlist prevents future private engine fields reaching any seat. */
export function publicUnoGame(game, viewerId = null, { hostId = null } = {}) {
  const viewer = participant(game, viewerId);
  const viewerHand = viewer ? hand(game, viewerId) : [];
  const output = {
    kind: 'uno', status: game.status, phase: game.phase, stage: game.phase,
    rules: { edition: game.rules.edition, scoreMode: game.rules.scoreMode, targetScore: game.rules.targetScore }, edition: game.rules.edition, editionInfo: copy(UNO_EDITIONS[game.rules.edition]),
    round: game.round, turn: game.turn, currentPlayerId: game.currentPlayerId, dealerId: game.dealerId,
    direction: game.direction, activeColor: game.activeColor, discardTop: publicCard(topCard(game)), drawPileCount: game._drawPile.length,
    players: game.players.map(player => ({ id: player.id, name: player.name, token: player.token, color: player.color, score: player.score, unoCalled: player.unoCalled, cardCount: hand(game, player.id).length })),
    hand: viewerHand.map(publicCard),
    playableCardIds: viewer && game.currentPlayerId === viewerId && ['play', 'drawn'].includes(game.phase) ? viewerHand.filter(card => (game.phase !== 'drawn' || card.id === game._drawnCardId) && canPlayUnoCard(game, card)).map(card => card.id) : [],
    drawnCardId: game._drawnPlayerId === viewerId ? game._drawnCardId : null,
    pendingColor: game.pendingColor ? { playerId: game.pendingColor.playerId } : null,
    pendingDrawFour: game._pendingDrawFour ? { offenderId: game._pendingDrawFour.offenderId, playerId: game._pendingDrawFour.playerId, amount: 4 } : null,
    pendingOhana: game._ohana ? { playerIds: [...game._ohana.playerIds], completedPlayerIds: [...game._ohana.completedPlayerIds] } : null,
    unoWindow: game.unoWindow ? { playerId: game.unoWindow.playerId, called: game.unoWindow.called } : null,
    lastChallenge: game._lastChallenge ? { offenderId: game._lastChallenge.offenderId, challengerId: game._lastChallenge.challengerId, successful: game._lastChallenge.successful, drawCount: game._lastChallenge.drawCount, ...(game._lastChallenge.challengerId === viewerId ? { cards: game._lastChallenge.cards.map(publicCard), challengedColor: game._lastChallenge.challengedColor } : {}) } : null,
    roundWinnerId: game.roundWinnerId, winnerId: game.winnerId, roundScore: game.roundScore,
    roundHistory: game.roundHistory.map(item => ({ round: item.round, winnerId: item.winnerId, points: item.points, scores: Object.fromEntries(game.players.map(player => [player.id, item.scores[player.id]])) })), log: publicLog(game),
    // These action names depend only on public phase, counts and UNO declarations.
    // In particular they never encode whether a Wild Draw Four would be legal.
    permittedActions: Object.fromEntries(game.players.map(player => [player.id, legalActions(game, player.id, hostId)])),
  };
  return output;
}

export function applyUnoTimeout(game, playerId) {
  requireRule(game.status === 'playing' && game.currentPlayerId === playerId && ['play', 'drawn'].includes(game.phase), 'The UNO turn clock is paused');
  if (game.phase === 'play') applyUnoAction(game, playerId, { type: 'uno:draw' });
  if (game.phase === 'drawn' && game.currentPlayerId === playerId) applyUnoAction(game, playerId, { type: 'uno:pass' });
  return game;
}
