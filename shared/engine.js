import { getBoard, getPropertySpaces, getGroups, getCardDecks, normalizeEdition, EDITION_INFO, PLAYER_COLORS, TOKENS } from './board.js';
import { movementPath } from './presentation.js';

const cards = (game) => Object.fromEntries(Object.values(getCardDecks(game)).flat().map((card) => [card.id, card]));
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const fail = (condition, message) => { if (!condition) throw new Error(message); };
const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const live = (game) => game.players.filter((p) => !p.bankrupt);
const player = (game, id) => game.players.find((p) => p.id === id);
const group = (game, square) => (getGroups(game)[square.group] || []).map((id) => game.properties[id]);
const property = (game, id) => {
  fail(integer(Number(id)) && own(game.properties, id), 'Choose a property on the board.');
  return [getBoard(game)[Number(id)], game.properties[id]];
};

export function recordEvent(game, type, data = {}, message = '') {
  const seq = ++game._eventSeq;
  const event = { ...data, id: `event-${seq}`, seq, type, turn: game.turn, at: new Date().toISOString(), message };
  game.log.push(event);
  if (game.log.length > 500) game.log.splice(0, game.log.length - 500);
  return event;
}

function random(game) {
  // Serializable private PRNG state makes saved games and deterministic tests replayable.
  let n = game._randomState | 0;
  n ^= n << 13; n ^= n >>> 17; n ^= n << 5;
  game._randomState = n >>> 0;
  return game._randomState / 0x100000000;
}

function shuffle(game, input) {
  const list = input.slice();
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random(game) * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function rollDice(game, options = {}) {
  if (options.dice) {
    fail(Array.isArray(options.dice) && options.dice.length === 2 && options.dice.every((n) => integer(n, 1) && n <= 6), 'Invalid test dice.');
    return [...options.dice];
  }
  return [1 + Math.floor(random(game) * 6), 1 + Math.floor(random(game) * 6)];
}

export function createGame(inputPlayers, options = {}) {
  fail(options.allowPassingUnowned === undefined || typeof options.allowPassingUnowned === 'boolean', 'Allow passing on unowned properties must be true or false.');
  const edition = normalizeEdition(options.edition);
  const isInland = edition === 'inland';
  const startingCash = isInland ? 1630 : 1500;
  fail(Array.isArray(inputPlayers) && inputPlayers.length >= 2 && inputPlayers.length <= EDITION_INFO[edition].maxPlayers, `This edition needs 2–${EDITION_INFO[edition].maxPlayers} players.`);
  fail(new Set(inputPlayers.map((p) => p.id)).size === inputPlayers.length && inputPlayers.every((p) => typeof p.id === 'string' && p.id), 'Players need unique IDs.');
  const game = {
    status: 'playing', edition, editionInfo: EDITION_INFO[edition], openingRolls: [],
    players: inputPlayers.map((p, index) => ({ id: p.id, name: String(p.name || `Player ${index + 1}`).slice(0, 32), token: p.token || TOKENS[index].id, color: p.color || PLAYER_COLORS[index], cash: startingCash, position: isInland ? -1 : 0, inJail: false, jailTurns: 0, bankrupt: false, jailCards: [], skipTurns: 0 })),
    currentPlayerId: inputPlayers[0].id, phase: 'roll', turn: 1, round: 1, dice: [1, 1],
    properties: Object.fromEntries(getPropertySpaces(edition).map((p) => [p.id, { ownerId: null, houses: 0, mortgaged: false }])),
    bank: { houses: 32, hotels: 12 }, centerPot: 0, log: [], lastCard: null, pendingPurchase: null, pendingMortgage: null, auction: null, debt: null, winnerId: null,
    rules: { startingCash, goSalary: 200, jailFee: isInland ? 100 : 50, voluntaryJailFee: !isInland, incomeTax: 200, luxuryTax: isInland ? 75 : 100, freeParkingPot: isInland, buildingAuctions: !isInland, cardSet: isInland ? 'researched-two-verified-plus-marked-classic-fallbacks' : 'traditional-us-2008', firstMoveFromCenter: isInland, allowPassingUnowned: options.allowPassingUnowned === true, version: 2 },
    _randomState: ((options.seed ?? Math.floor(Math.random() * 0xffffffff)) >>> 0) || 2463534242,
    _eventSeq: 0, _effects: [], _resumePhase: 'roll', _doubleCount: 0, _advanceTurnAfterEffects: false,
    _decks: { chance: [], chest: [] },
  };
  game._decks.chance = shuffle(game, getCardDecks(game).chance.map((c) => c.id));
  game._decks.chest = shuffle(game, getCardDecks(game).chest.map((c) => c.id));
  if (options.firstPlayerId) {
    fail(player(game, options.firstPlayerId), 'Unknown starting player.');
    game.currentPlayerId = options.firstPlayerId;
  } else {
    let contenders = game.players;
    while (contenders.length > 1) {
      const opening = contenders.map((p) => ({ playerId: p.id, dice: rollDice(game) }));
      game.openingRolls.push(...opening);
      const high = Math.max(...opening.map((r) => r.dice[0] + r.dice[1]));
      contenders = contenders.filter((p) => opening.some((r) => r.playerId === p.id && r.dice[0] + r.dice[1] === high));
    }
    game.currentPlayerId = contenders[0].id;
  }
  game._roundStartIndex = game.players.findIndex((p) => p.id === game.currentPlayerId);
  recordEvent(game, 'start', {}, `Game started. Each player receives $${startingCash.toLocaleString('en-US')}.`);
  recordEvent(game, 'turn', { playerId: game.currentPlayerId }, `${player(game, game.currentPlayerId).name} takes the first turn.`);
  if (isInland && !options.firstPlayerId) {
    // In the publisher-family rules the winning opening roll is itself the first move.
    const opening = game.openingRolls.findLast((entry) => entry.playerId === game.currentPlayerId);
    applyAction(game, game.currentPlayerId, { type: 'roll' }, { dice: opening.dice });
  }
  return game;
}

export function availableCash(game, playerId) {
  const p = player(game, playerId);
  if (!p || p.bankrupt) return 0;
  return p.cash - (game.auction?.highestBidderId === playerId ? game.auction.currentBid : 0);
}

export function calculateRent(game, propertyId, diceTotal = game.dice.reduce((a, b) => a + b, 0), modifiers = {}) {
  const [square, state] = property(game, propertyId);
  if (!state.ownerId || state.mortgaged) return 0;
  if (square.type === 'railroad') {
    const count = group(game, square).filter((p) => p.ownerId === state.ownerId).length;
    return square.rents[count - 1] * (modifiers.railroadMultiplier || 1);
  }
  if (square.type === 'utility') {
    const count = group(game, square).filter((p) => p.ownerId === state.ownerId).length;
    return diceTotal * (modifiers.utilityMultiplier || (count === 2 ? 10 : 4));
  }
  if (state.houses) return square.rents[state.houses];
  return square.rents[0] * (group(game, square).every((p) => p.ownerId === state.ownerId) ? 2 : 1);
}

function payment(game, fromId, toId, amount, reason, context = {}) {
  fail(integer(amount), 'Payment must be a nonnegative whole dollar amount.');
  const from = fromId ? player(game, fromId) : null;
  const to = toId ? player(game, toId) : null;
  if (!amount || from?.bankrupt || to?.bankrupt || fromId === toId) return true;
  if (from && from.cash < amount) {
    game.debt = { playerId: fromId, creditorId: toId || null, amount, reason, ...context };
    game.phase = 'debt';
    recordEvent(game, 'debt', { ...game.debt }, `${from.name} owes $${amount} and must raise funds or declare bankruptcy.`);
    return false;
  }
  if (from) from.cash -= amount;
  if (to) to.cash += amount;
  const intoCenterPot = from && !to && game.rules.freeParkingPot && !reason.startsWith('Auction:');
  if (intoCenterPot) game.centerPot += amount;
  recordEvent(game, 'payment', { playerId: fromId || toId, fromPlayerId: fromId || null, toPlayerId: toId || null, amount, reason, intoCenterPot: Boolean(intoCenterPot) }, `${from?.name || 'Bank'} pays ${to?.name || (intoCenterPot ? 'the center pot' : 'Bank')} $${amount}: ${reason}.`);
  return true;
}

function prepend(game, effects) { game._effects.unshift(...effects); }

function sendToJail(game, p) {
  const from = p.position;
  p.position = 10; p.inJail = true; p.jailTurns = 0;
  game._doubleCount = 0; game._resumePhase = 'end'; game._effects = [];
  recordEvent(game, 'jail', { playerId: p.id, from, to: 10, path: [10], direct: true }, `${p.name} goes directly to jail.`);
}

function move(game, p, effect) {
  const previousPosition = p.position;
  const target = effect.target ?? ((p.position + effect.steps + 40) % 40);
  const passesGo = !effect.back && (previousPosition === -1 || (effect.target !== undefined ? target < previousPosition || (target === 0 && effect.forceGo) : previousPosition + effect.steps >= 40));
  p.position = target;
  recordEvent(game, 'move', {
    playerId: p.id, from: previousPosition, to: target, back: Boolean(effect.back),
    path: movementPath(previousPosition, target, { back: effect.back, steps: effect.steps }),
  }, `${p.name} moves to ${getBoard(game)[target].name}.`);
  if (passesGo) {
    payment(game, null, p.id, 200, 'Passing GO');
    recordEvent(game, 'passGo', { playerId: p.id, amount: 200 }, `${p.name} passes GO and receives $200.`);
  }
  prepend(game, [{ type: 'land', playerId: p.id, modifiers: effect.modifiers || {} }]);
}

function land(game, p, modifiers) {
  const square = getBoard(game)[p.position];
  recordEvent(game, 'land', { playerId: p.id, propertyId: square.id, position: square.id }, `${p.name} lands on ${square.name}.`);
  if (square.price) {
    const state = game.properties[square.id];
    if (!state.ownerId) { game.pendingPurchase = square.id; game.phase = 'buy'; return; }
    if (state.ownerId === p.id || state.mortgaged) return;
    let diceTotal = game.dice[0] + game.dice[1];
    if (modifiers.utilityMultiplier) {
      const dice = rollDice(game);
      diceTotal = dice[0] + dice[1];
      recordEvent(game, 'utilityRoll', { playerId: p.id, dice, total: diceTotal }, `${p.name} rolls ${dice.join(' + ')} for utility rent.`);
    }
    const amount = calculateRent(game, square.id, diceTotal, modifiers);
    prepend(game, [{ type: 'pay', fromId: p.id, toId: state.ownerId, amount, reason: `Rent: ${square.name}` }]);
  } else if (square.type === 'tax') {
    prepend(game, [{ type: 'pay', fromId: p.id, toId: null, amount: square.amount, reason: square.name }]);
  } else if (square.type === 'freeParking' && game.rules.freeParkingPot) {
    const amount = game.centerPot; game.centerPot = 0; p.cash += amount;
    recordEvent(game, 'jackpot', { playerId: p.id, amount }, `${p.name} collects $${amount} from the center pot.`);
  } else if (square.type === 'goToJail') sendToJail(game, p);
  else if (square.type === 'chance' || square.type === 'chest') prepend(game, [{ type: 'draw', playerId: p.id, deck: square.type }]);
}

function draw(game, p, deck) {
  const cardId = game._decks[deck].shift();
  const card = cards(game)[cardId];
  fail(card, 'The card deck is invalid.');
  if (card.effect !== 'jailCard') game._decks[deck].push(card.id);
  game.lastCard = { id: card.id, deck, title: card.title, text: card.text, playerId: p.id, verification: card.verification || 'classic-card-set' };
  recordEvent(game, 'card', { playerId: p.id, cardId: card.id, deck }, `${p.name} draws ${card.title}: ${card.text}`);
  const pay = (fromId, toId, amount) => ({ type: 'pay', fromId, toId, amount, reason: card.title });
  switch (card.effect) {
    case 'advance': prepend(game, [{ type: 'move', playerId: p.id, target: card.target, forceGo: card.target === 0 }]); break;
    case 'back': prepend(game, [{ type: 'move', playerId: p.id, steps: -card.amount, back: true }]); break;
    case 'railroad': {
      const target = [5, 15, 25, 35].find((id) => id > p.position) ?? 5;
      prepend(game, [{ type: 'move', playerId: p.id, target, modifiers: { railroadMultiplier: 2 } }]); break;
    }
    case 'utility': {
      const target = [12, 28].find((id) => id > p.position) ?? 12;
      prepend(game, [{ type: 'move', playerId: p.id, target, modifiers: { utilityMultiplier: 10 } }]); break;
    }
    case 'receive': prepend(game, [pay(null, p.id, card.amount)]); break;
    case 'pay': prepend(game, [pay(p.id, null, card.amount)]); break;
    case 'payEach': prepend(game, live(game).filter((other) => other.id !== p.id).map((other) => pay(p.id, other.id, card.amount))); break;
    case 'receiveEach': prepend(game, live(game).filter((other) => other.id !== p.id).map((other) => pay(other.id, p.id, card.amount))); break;
    case 'repairs': {
      const amount = Object.values(game.properties).filter((s) => s.ownerId === p.id).reduce((sum, s) => sum + (s.houses === 5 ? card.hotel : s.houses * card.house), 0);
      prepend(game, [pay(p.id, null, amount)]); break;
    }
    case 'jailCard': p.jailCards.push(deck); break;
    case 'loseTurn': p.skipTurns += card.amount; break;
    case 'jail': sendToJail(game, p); break;
  }
}

function nextTurn(game) {
  let index = game.players.findIndex((p) => p.id === game.currentPlayerId);
  for (let attempts = 0; attempts < 100; attempts++) {
    const nextIndex = (index + 1) % game.players.length;
    const next = game.players[nextIndex];
    if (nextIndex === (game._roundStartIndex ?? 0)) game.round += 1;
    index = nextIndex;
    if (next.bankrupt) continue;
    game.turn += 1;
    if (next.skipTurns > 0) {
      next.skipTurns -= 1;
      recordEvent(game, 'skipTurn', { playerId: next.id }, `${next.name} misses this turn.`);
      continue;
    }
    game.currentPlayerId = next.id; game.phase = 'roll'; game._resumePhase = 'roll';
    game._doubleCount = 0; game.lastCard = null;
    recordEvent(game, 'turn', { playerId: next.id, round: game.round }, `${next.name}'s turn.`);
    break;
  }
}

function runEffects(game) {
  if (game.status !== 'playing' || game.debt || game.auction || game.pendingMortgage || game.pendingPurchase !== null) return;
  while (game._effects.length) {
    const effect = game._effects.shift();
    const p = effect.playerId ? player(game, effect.playerId) : null;
    if (p?.bankrupt) continue;
    if (effect.type === 'move') move(game, p, effect);
    else if (effect.type === 'land') land(game, p, effect.modifiers || {});
    else if (effect.type === 'draw') draw(game, p, effect.deck);
    else if (effect.type === 'pay') payment(game, effect.fromId, effect.toId, effect.amount, effect.reason, effect.context);
    else if (effect.type === 'releaseJail') { p.inJail = false; p.jailTurns = 0; recordEvent(game, 'releaseJail', { playerId: p.id }, `${p.name} leaves jail.`); }
    else if (effect.type === 'auction') startAuction(game, effect.propertyId, effect.reason);
    else if (effect.type === 'liftInheritedMortgage') game.properties[effect.propertyId].mortgaged = false;
    else if (effect.type === 'mortgageChoice') {
      const square = getBoard(game)[effect.propertyId];
      game.pendingMortgage = { playerId: effect.playerId, propertyId: effect.propertyId, retainCost: Math.ceil(square.mortgage / 10), redeemCost: square.mortgage + Math.ceil(square.mortgage / 10) };
      game.phase = 'mortgageChoice';
    }
    if (game.debt || game.auction || game.pendingMortgage || game.pendingPurchase !== null || game.status !== 'playing') return;
  }
  game.phase = game._resumePhase;
  if (game._advanceTurnAfterEffects) { game._advanceTurnAfterEffects = false; nextTurn(game); }
}

function resolveDebt(game) {
  if (!game.debt) return;
  const debt = game.debt;
  const debtor = player(game, debt.playerId);
  if (debtor.cash < debt.amount) return;
  game.debt = null;
  payment(game, debtor.id, debt.creditorId, debt.amount, debt.reason);
  recordEvent(game, 'debtCleared', { playerId: debtor.id }, `${debtor.name} settles the outstanding debt.`);
  runEffects(game);
}

export function settleDebt(game) { resolveDebt(game); return game; }

export function chargePlayer(game, fromId, toId, amount, reason = 'Agreement payment') {
  fail(game.status === 'playing' && !game.debt && !game.auction && !game.pendingMortgage && game.pendingPurchase === null, 'Resolve the pending game decision before charging a payment.');
  fail(player(game, fromId) && (!toId || player(game, toId)), 'Unknown payment participant.');
  fail(integer(amount, 1), 'Payment must be a positive whole dollar amount.');
  game._resumePhase = game.phase;
  prepend(game, [{ type: 'pay', fromId, toId: toId || null, amount, reason }]);
  runEffects(game);
  return game;
}

function startAuction(game, propertyId, reason = 'Declined purchase') {
  const [square, state] = property(game, propertyId);
  fail(!state.ownerId, 'This property is already owned.');
  game.pendingPurchase = null;
  game.auction = { kind: 'property', propertyId: square.id, currentBid: 0, highestBidderId: null, passedPlayerIds: [], eligiblePlayerIds: live(game).map((p) => p.id), reason };
  game.phase = 'auction';
  recordEvent(game, 'auction', { propertyId: square.id }, `Auction opened for ${square.name}. Bidding begins at $1.`);
}

function buildingCandidates(game, playerId, building) {
  return getPropertySpaces(game).filter((square) => {
    const state = game.properties[square.id];
    if (square.type !== 'property' || state.ownerId !== playerId || state.mortgaged) return false;
    const set = group(game, square);
    if (!set.every((s) => s.ownerId === playerId && !s.mortgaged)) return false;
    if (state.houses !== Math.min(...set.map((s) => s.houses))) return false;
    return building === 'hotel' ? state.houses === 4 : state.houses < 4;
  }).map((square) => square.id);
}

function startBuildingAuction(game, p, propertyId) {
  const [square, state] = requireOwner(game, p.id, propertyId);
  fail(square.type === 'property' && state.houses < 5, 'Choose a property that can receive a building.');
  const building = state.houses === 4 ? 'hotel' : 'house';
  const stock = building === 'hotel' ? game.bank.hotels : game.bank.houses;
  fail(stock > 0, 'The bank has no building of this type to auction.');
  const eligiblePropertyIdsByPlayer = Object.fromEntries(live(game).map((other) => [other.id, buildingCandidates(game, other.id, building)]).filter(([, ids]) => ids.length));
  fail(eligiblePropertyIdsByPlayer[p.id]?.includes(square.id), 'Build evenly in a complete unmortgaged color group.');
  fail(Object.keys(eligiblePropertyIdsByPlayer).length >= 2, 'A building auction needs at least two eligible players.');
  const eligibleGroups = new Set(Object.values(eligiblePropertyIdsByPlayer).flat().map((id) => getBoard(game)[id].group));
  const demand = getPropertySpaces(game).filter((s) => eligibleGroups.has(s.group)).reduce((total, s) => total + (building === 'hotel' ? Number(game.properties[s.id].houses === 4) : Math.max(0, 4 - game.properties[s.id].houses)), 0);
  fail(stock < demand, 'The bank has enough buildings for the eligible groups; buy at the printed cost.');
  game._resumePhase = game.phase;
  game.auction = { kind: 'building', building, propertyId: square.id, highestPropertyId: null, currentBid: 0, highestBidderId: null, passedPlayerIds: [], eligiblePlayerIds: Object.keys(eligiblePropertyIdsByPlayer), eligiblePropertyIdsByPlayer, reason: 'Competing building requests' };
  game.phase = 'auction';
  recordEvent(game, 'auction', { playerId: p.id, kind: 'building', building }, `${p.name} opens a ${building} auction for players competing over the bank's supply.`);
}

function finishAuctionIfReady(game) {
  const auction = game.auction;
  const remaining = auction.eligiblePlayerIds.filter((id) => !auction.passedPlayerIds.includes(id) && id !== auction.highestBidderId);
  if (remaining.length) return;
  const winner = player(game, auction.highestBidderId);
  game.auction = null;
  if (winner) {
    payment(game, winner.id, null, auction.currentBid, `Auction: ${auction.kind === 'building' ? auction.building : getBoard(game)[auction.propertyId].name}`);
    if (auction.kind === 'building') {
      const state = game.properties[auction.highestPropertyId];
      if (state.houses === 4) { game.bank.hotels -= 1; game.bank.houses += 4; } else game.bank.houses -= 1;
      state.houses += 1;
      recordEvent(game, 'build', { playerId: winner.id, propertyId: auction.highestPropertyId, houses: state.houses, amount: auction.currentBid, auction: true }, `${winner.name} wins a ${auction.building} for $${auction.currentBid} and builds on ${getBoard(game)[auction.highestPropertyId].name}.`);
    } else {
      game.properties[auction.propertyId].ownerId = winner.id;
      recordEvent(game, 'purchase', { playerId: winner.id, propertyId: auction.propertyId, amount: auction.currentBid, auction: true }, `${winner.name} wins ${getBoard(game)[auction.propertyId].name} for $${auction.currentBid}.`);
    }
  } else recordEvent(game, 'auctionClosed', { propertyId: auction.propertyId }, `No bids for ${getBoard(game)[auction.propertyId].name}; it remains with the bank.`);
  runEffects(game);
}

function requireOwner(game, playerId, propertyId) {
  const [square, state] = property(game, propertyId);
  fail(state.ownerId === playerId, 'You do not own that property.');
  return [square, state];
}

function build(game, p, propertyId) {
  const [square, state] = requireOwner(game, p.id, propertyId);
  fail(square.type === 'property', 'Only colored properties can have buildings.');
  const set = group(game, square);
  fail(set.every((s) => s.ownerId === p.id), 'Own the complete color group before building.');
  fail(set.every((s) => !s.mortgaged), 'Unmortgage every property in the color group before building.');
  fail(state.houses < 5 && state.houses === Math.min(...set.map((s) => s.houses)), 'Build evenly across the color group, up to one hotel per property.');
  fail(availableCash(game, p.id) >= square.houseCost, 'Not enough available cash for this building.');
  fail(state.houses === 4 ? game.bank.hotels > 0 : game.bank.houses > 0, 'The bank has no building of this type available.');
  p.cash -= square.houseCost;
  if (state.houses === 4) { game.bank.hotels -= 1; game.bank.houses += 4; } else game.bank.houses -= 1;
  state.houses += 1;
  recordEvent(game, 'build', { playerId: p.id, propertyId: square.id, houses: state.houses, amount: square.houseCost }, `${p.name} builds ${state.houses === 5 ? 'a hotel' : 'a house'} on ${square.name}.`);
}

function trialGroupBuild(game, playerId, propertyId, targetLevel) {
  fail(Number.isSafeInteger(propertyId), 'Choose a colored property by its whole-number board ID.');
  fail(Number.isSafeInteger(targetLevel) && targetLevel >= 1 && targetLevel <= 5, 'Choose a building level from one house to one hotel.');
  const [square] = requireOwner(game, playerId, propertyId);
  fail(square.type === 'property', 'Only colored property groups can have buildings.');
  const propertyIds = getGroups(game)[square.group];
  fail(propertyIds.every(id => game.properties[id].ownerId === playerId), 'Own the complete color group before building.');
  fail(propertyIds.every(id => !game.properties[id].mortgaged), 'Unmortgage every property in the color group before building.');
  fail(propertyIds.every(id => game.properties[id].houses <= targetLevel), 'The selected level cannot remove existing buildings.');
  fail(propertyIds.some(id => game.properties[id].houses < targetLevel), 'This color group already has the selected building level.');

  // The exact single-property rules run before the original game is touched.
  // Public snapshots omit private counters, so give quotes their own valid sequence.
  const trial = structuredClone(game);
  trial._eventSeq ??= Math.max(0, ...trial.log.map(event => Number.isSafeInteger(event.seq) ? event.seq : 0));
  const groupBuildId = `build-group-${trial.turn}-${trial._eventSeq + 1}`;
  const builder = player(trial, playerId), steps = [];
  while (propertyIds.some(id => trial.properties[id].houses < targetLevel)) {
    const id = propertyIds.filter(id => trial.properties[id].houses < targetLevel)
      .sort((a, b) => trial.properties[a].houses - trial.properties[b].houses || a - b)[0];
    const from = trial.properties[id].houses;
    build(trial, builder, id);
    trial.log.at(-1).groupBuildId = groupBuildId;
    steps.push({ propertyId: id, from, to: from + 1, cost: getBoard(trial)[id].houseCost });
  }
  return {
    trial, groupBuildId,
    quote: { propertyIds: [...propertyIds], targetLevel, cost: player(game, playerId).cash - builder.cash, steps, bankAfter: { ...trial.bank } },
  };
}

export function quoteGroupBuild(game, playerId, propertyId, targetLevel) {
  fail(game?.status === 'playing' && getLegalActions(game, playerId).includes('buildGroup'), 'Building is not available at this point in the game.');
  return trialGroupBuild(game, playerId, propertyId, targetLevel).quote;
}

function buildGroup(game, p, propertyId, targetLevel) {
  const { trial, quote, groupBuildId } = trialGroupBuild(game, p.id, propertyId, targetLevel);
  const level = targetLevel === 5 ? 'one hotel each' : `${targetLevel} house${targetLevel === 1 ? '' : 's'} each`;
  recordEvent(trial, 'buildGroup', { playerId: p.id, propertyIds: quote.propertyIds, targetLevel, amount: quote.cost, groupBuildId }, `${p.name} develops the color group to ${level} for $${quote.cost}.`);
  Object.assign(game, trial);
}

function sellBuilding(game, p, propertyId) {
  const [square, state] = requireOwner(game, p.id, propertyId);
  fail(square.type === 'property' && state.houses > 0, 'There is no building to sell here.');
  fail(state.houses === Math.max(...group(game, square).map((s) => s.houses)), 'Sell buildings evenly across the color group.');
  fail(state.houses !== 5 || game.bank.houses >= 4, 'The bank needs four houses to break down this hotel. Sell all buildings in the group instead.');
  if (state.houses === 5) { game.bank.hotels += 1; game.bank.houses -= 4; } else game.bank.houses += 1;
  state.houses -= 1; p.cash += square.houseCost / 2;
  recordEvent(game, 'sellBuilding', { playerId: p.id, propertyId: square.id, houses: state.houses, amount: square.houseCost / 2 }, `${p.name} sells one building on ${square.name}.`);
}

function sellGroupBuildings(game, p, propertyId) {
  const [square] = requireOwner(game, p.id, propertyId);
  fail(square.type === 'property', 'Choose a colored property.');
  const set = getGroups(game)[square.group].map((id) => [getBoard(game)[id], game.properties[id]]);
  fail(set.every(([, s]) => s.ownerId === p.id) && set.some(([, s]) => s.houses > 0), 'You need buildings in a complete color group to sell them.');
  let amount = 0;
  for (const [s, state] of set) {
    amount += state.houses * s.houseCost / 2;
    if (state.houses === 5) game.bank.hotels += 1; else game.bank.houses += state.houses;
    state.houses = 0;
  }
  p.cash += amount;
  recordEvent(game, 'sellBuilding', { playerId: p.id, group: square.group, amount }, `${p.name} sells all buildings in the ${square.group} group for $${amount}.`);
}

function mortgage(game, p, propertyId) {
  const [square, state] = requireOwner(game, p.id, propertyId);
  fail(!state.mortgaged, 'This property is already mortgaged.');
  fail(group(game, square).every((s) => !s.houses), 'Sell all buildings in this color group before mortgaging.');
  state.mortgaged = true; p.cash += square.mortgage;
  recordEvent(game, 'mortgage', { playerId: p.id, propertyId: square.id, amount: square.mortgage }, `${p.name} mortgages ${square.name} for $${square.mortgage}.`);
}

function unmortgage(game, p, propertyId) {
  const [square, state] = requireOwner(game, p.id, propertyId);
  fail(state.mortgaged, 'This property is not mortgaged.');
  const cost = square.mortgage + Math.ceil(square.mortgage / 10);
  fail(availableCash(game, p.id) >= cost, `Lifting this mortgage costs $${cost}.`);
  p.cash -= cost; state.mortgaged = false;
  if (game.rules.freeParkingPot) game.centerPot += cost;
  recordEvent(game, 'unmortgage', { playerId: p.id, propertyId: square.id, amount: cost }, `${p.name} lifts the mortgage on ${square.name} for $${cost}.`);
}

export function transferProperty(game, fromId, toId, propertyId, { liftMortgage = false } = {}) {
  fail(game.status === 'playing', 'The game is not active.');
  fail(game.auction?.kind !== 'building', 'Finish the building auction before trading property.');
  const unsettledInheritance = game.pendingMortgage?.propertyId === Number(propertyId) || game.debt?.mortgagePropertyId === Number(propertyId) || game._effects.some((effect) => ['mortgageChoice', 'liftInheritedMortgage'].includes(effect.type) && effect.propertyId === Number(propertyId));
  fail(!unsettledInheritance, 'Settle the inherited mortgage on this property before trading it.');
  const from = player(game, fromId), to = player(game, toId);
  fail(from && to && !from.bankrupt && !to.bankrupt && fromId !== toId, 'Choose two different active players.');
  const [square, state] = requireOwner(game, fromId, propertyId);
  fail(group(game, square).every((s) => !s.houses), 'Sell every building in the color group before trading a property.');
  const fee = state.mortgaged ? Math.ceil(square.mortgage / 10) + (liftMortgage ? square.mortgage : 0) : 0;
  fail(availableCash(game, toId) >= fee, `The recipient needs $${fee} for this mortgage transfer.`);
  if (fee) payment(game, toId, null, fee, `Mortgage transfer: ${square.name}`);
  state.ownerId = toId;
  if (liftMortgage) state.mortgaged = false;
  recordEvent(game, 'transferProperty', { playerId: fromId, fromPlayerId: fromId, toPlayerId: toId, propertyId: square.id, amount: fee }, `${from.name} transfers ${square.name} to ${to.name}.`);
  return game;
}

export function liquidatableValue(game, playerId) {
  const p = player(game, playerId);
  if (!p || p.bankrupt) return 0;
  return p.cash + getPropertySpaces(game).reduce((sum, square) => {
    const state = game.properties[square.id];
    return sum + (state.ownerId === p.id ? (state.mortgaged ? 0 : square.mortgage) + state.houses * (square.houseCost || 0) / 2 : 0);
  }, 0);
}

function bankrupt(game, p) {
  fail(game.debt?.playerId === p.id, 'Only a player with an unresolved debt can declare bankruptcy.');
  fail(liquidatableValue(game, p.id) < game.debt.amount, 'You can still cover this debt by selling buildings and mortgaging assets.');
  const debt = game.debt;
  const creditor = debt.creditorId ? player(game, debt.creditorId) : null;
  const auctionProperties = [];
  const inheritedMortgages = [];
  for (const square of getPropertySpaces(game)) {
    const state = game.properties[square.id];
    if (state.ownerId !== p.id) continue;
    if (state.houses) {
      p.cash += state.houses * square.houseCost / 2;
      if (state.houses === 5) game.bank.hotels += 1; else game.bank.houses += state.houses;
      state.houses = 0;
    }
    if (creditor) {
      state.ownerId = creditor.id;
      if (state.mortgaged) inheritedMortgages.push(square.id);
    } else {
      state.ownerId = null; state.mortgaged = false; auctionProperties.push(square.id);
    }
  }
  if (creditor) {
    creditor.cash += p.cash;
    creditor.jailCards.push(...p.jailCards);
  } else for (const deck of p.jailCards) game._decks[deck].push(getCardDecks(game)[deck].find((c) => c.effect === 'jailCard').id);
  p.cash = 0; p.jailCards = []; p.bankrupt = true;
  game.debt = null;
  recordEvent(game, 'bankruptcy', { playerId: p.id, creditorId: creditor?.id || null }, `${p.name} is bankrupt${creditor ? `; assets pass to ${creditor.name}` : '; remaining properties return to auction'}.`);
  if (live(game).length === 1) {
    game.status = 'finished'; game.phase = 'end'; game.winnerId = live(game)[0].id;
    game._effects = []; game.auction = null; game.pendingPurchase = null;
    recordEvent(game, 'win', { playerId: game.winnerId }, `${live(game)[0].name} wins the game!`);
    return;
  }
  if (p.id === game.currentPlayerId) { game._advanceTurnAfterEffects = true; game._resumePhase = 'end'; }
  const effects = auctionProperties.map((propertyId) => ({ type: 'auction', propertyId, reason: 'Bankruptcy to bank' }));
  for (const propertyId of inheritedMortgages.reverse()) effects.unshift({ type: 'mortgageChoice', playerId: creditor.id, propertyId });
  prepend(game, effects);
  runEffects(game);
}

export function getLegalActions(game, playerId) {
  const p = player(game, playerId);
  if (!p || p.bankrupt || game.status !== 'playing') return [];
  if (game.debt) return game.debt.playerId === p.id ? ['mortgage', 'sellBuilding', 'sellGroupBuildings', ...(liquidatableValue(game, p.id) < game.debt.amount ? ['bankrupt'] : [])] : [];
  if (game.pendingMortgage) return game.pendingMortgage.playerId === p.id ? ['mortgage', 'sellBuilding', 'sellGroupBuildings', ...(game.edition === 'inland' ? [] : ['retainMortgage']), 'redeemMortgage'] : [];
  const actions = ['build', 'buildGroup', 'sellBuilding', 'sellGroupBuildings', 'mortgage', 'unmortgage'];
  if (game.auction) {
    const auctionActions = game.auction.kind === 'building' ? [] : actions;
    if (game.auction.eligiblePlayerIds.includes(p.id) && !game.auction.passedPlayerIds.includes(p.id) && game.auction.highestBidderId !== p.id) auctionActions.push('bid', 'passAuction');
    return auctionActions;
  }
  if (game.rules.buildingAuctions && ['roll', 'end'].includes(game.phase)) actions.push('auctionBuilding');
  if (game.currentPlayerId !== p.id) return actions;
  if (game.phase === 'roll') {
    actions.push('roll');
    if (p.inJail) { if (game.rules.voluntaryJailFee) actions.push('payJail'); if (p.jailCards.length) actions.push('useJailCard'); }
  }
  if (game.phase === 'buy') actions.push('buy', 'auction', ...(game.rules.allowPassingUnowned === true ? ['declinePurchase'] : []));
  if (game.phase === 'end') actions.push('endTurn');
  return actions;
}

export function publicGame(game) {
  const output = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(game).filter(([key]) => !key.startsWith('_')))));
  output.permittedActions = Object.fromEntries(game.players.map((p) => [p.id, getLegalActions(game, p.id)]));
  output.doubles = game._doubleCount;
  return output;
}

export function applyAction(game, playerId, action, options = {}) {
  fail(game?.status === 'playing', 'The game is not active.');
  fail(action && typeof action.type === 'string', 'Choose a game action.');
  const p = player(game, playerId);
  fail(p && !p.bankrupt, 'Only an active player can act.');
  fail(getLegalActions(game, playerId).includes(action.type), 'That action is not available at this point in the game.');
  switch (action.type) {
    case 'roll': {
      const dice = rollDice(game, options), total = dice[0] + dice[1], doubles = dice[0] === dice[1];
      game.dice = dice; game.lastCard = null;
      recordEvent(game, 'roll', { playerId: p.id, dice, total, doubles }, `${p.name} rolls ${dice.join(' + ')}${doubles ? ' — doubles' : ''}.`);
      if (p.inJail) {
        game._resumePhase = 'end';
        if (doubles) prepend(game, [{ type: 'releaseJail', playerId: p.id }, { type: 'move', playerId: p.id, steps: total }]);
        else {
          p.jailTurns += 1;
          if (p.jailTurns >= 3) prepend(game, [{ type: 'pay', fromId: p.id, toId: null, amount: game.rules.jailFee, reason: 'Third jail turn release fee' }, { type: 'releaseJail', playerId: p.id }, { type: 'move', playerId: p.id, steps: total }]);
          else recordEvent(game, 'jailAttempt', { playerId: p.id, attempts: p.jailTurns }, `${p.name} remains in jail (${p.jailTurns} of 3 attempts).`);
        }
      } else {
        game._doubleCount = doubles ? game._doubleCount + 1 : 0;
        game._resumePhase = doubles ? 'roll' : 'end';
        if (game._doubleCount >= 3) sendToJail(game, p);
        else prepend(game, [{ type: 'move', playerId: p.id, steps: total }]);
      }
      runEffects(game); break;
    }
    case 'buy': {
      fail(Number.isSafeInteger(action.propertyId) && action.propertyId === game.pendingPurchase, 'The purchase decision changed. Choose the property currently offered.');
      const [square, state] = property(game, game.pendingPurchase);
      fail(!state.ownerId && availableCash(game, p.id) >= square.price, 'Not enough cash to buy this property. Auction it instead.');
      p.cash -= square.price; state.ownerId = p.id; game.pendingPurchase = null;
      recordEvent(game, 'purchase', { playerId: p.id, propertyId: square.id, amount: square.price, auction: false }, `${p.name} buys ${square.name} for $${square.price}.`);
      runEffects(game); break;
    }
    case 'declinePurchase': {
      fail(game.rules.allowPassingUnowned === true, 'Passing on an unowned property is not enabled for this game.');
      fail(Number.isSafeInteger(action.propertyId) && action.propertyId === game.pendingPurchase, 'The purchase decision changed. Choose the property currently offered.');
      const [square, state] = property(game, game.pendingPurchase);
      fail(!state.ownerId, 'This property is already owned.');
      game.pendingPurchase = null;
      recordEvent(game, 'declinePurchase', { playerId: p.id, propertyId: square.id }, `${p.name} passes on ${square.name}, leaving it with the bank.`);
      runEffects(game); break;
    }
    case 'auction':
      fail(Number.isSafeInteger(action.propertyId) && action.propertyId === game.pendingPurchase, 'The purchase decision changed. Choose the property currently offered.');
      startAuction(game, game.pendingPurchase); break;
    case 'auctionBuilding': startBuildingAuction(game, p, action.propertyId); break;
    case 'bid': {
      const auction = game.auction;
      fail(integer(action.amount, 1) && action.amount > auction.currentBid, 'Bid a whole dollar amount higher than the current bid.');
      fail(p.cash >= action.amount, 'You do not have enough cash for that bid.');
      if (auction.kind === 'building') {
        const target = action.propertyId === undefined ? auction.eligiblePropertyIdsByPlayer[p.id][0] : Number(action.propertyId);
        fail(auction.eligiblePropertyIdsByPlayer[p.id].includes(target), 'Choose one of your eligible properties for this building.');
        auction.highestPropertyId = target;
      }
      auction.currentBid = action.amount; auction.highestBidderId = p.id;
      recordEvent(game, 'bid', { playerId: p.id, propertyId: auction.propertyId, amount: action.amount }, `${p.name} bids $${action.amount}.`);
      finishAuctionIfReady(game); break;
    }
    case 'passAuction': game.auction.passedPlayerIds.push(p.id); recordEvent(game, 'passAuction', { playerId: p.id }, `${p.name} leaves the auction.`); finishAuctionIfReady(game); break;
    case 'endTurn': nextTurn(game); break;
    case 'build': build(game, p, action.propertyId); break;
    case 'buildGroup': buildGroup(game, p, action.propertyId, action.targetLevel); break;
    case 'sellBuilding': sellBuilding(game, p, action.propertyId); resolveDebt(game); break;
    case 'sellGroupBuildings': sellGroupBuildings(game, p, action.propertyId); resolveDebt(game); break;
    case 'mortgage': mortgage(game, p, action.propertyId); resolveDebt(game); break;
    case 'unmortgage': unmortgage(game, p, action.propertyId); break;
    case 'retainMortgage':
    case 'redeemMortgage': {
      const pending = game.pendingMortgage;
      game.pendingMortgage = null;
      const effects = [{ type: 'pay', fromId: p.id, toId: null, amount: action.type === 'redeemMortgage' ? pending.redeemCost : pending.retainCost, reason: 'Inherited mortgage settlement', context: { mortgagePropertyId: pending.propertyId } }];
      if (action.type === 'redeemMortgage') effects.push({ type: 'liftInheritedMortgage', propertyId: pending.propertyId });
      prepend(game, effects); runEffects(game); break;
    }
    case 'payJail': {
      fail(p.inJail, 'You are not in jail.');
      game._resumePhase = 'roll';
      prepend(game, [{ type: 'pay', fromId: p.id, toId: null, amount: game.rules.jailFee, reason: 'Voluntary jail release fee' }, { type: 'releaseJail', playerId: p.id }]);
      runEffects(game); break;
    }
    case 'useJailCard': {
      fail(p.inJail && p.jailCards.length, 'You need a jail card and must be in jail.');
      const deck = action.deck && p.jailCards.includes(action.deck) ? action.deck : p.jailCards[0];
      p.jailCards.splice(p.jailCards.indexOf(deck), 1); game._decks[deck].push(getCardDecks(game)[deck].find((c) => c.effect === 'jailCard').id);
      p.inJail = false; p.jailTurns = 0;
      recordEvent(game, 'releaseJail', { playerId: p.id, deck }, `${p.name} uses a Get Out of Jail Free card.`); break;
    }
    case 'bankrupt': bankrupt(game, p); break;
  }
  return game;
}
