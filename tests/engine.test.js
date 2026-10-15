import test from 'node:test';
import assert from 'node:assert/strict';
import { BOARD, getBoard, getCardDecks, getPropertySpaces, getGroups } from '../shared/board.js';
import { createGame, applyAction, publicGame, calculateRent, chargePlayer, transferProperty, liquidatableValue, availableCash, settleDebt } from '../shared/engine.js';

const setup = (count = 3, options = {}) => createGame(Array.from({ length: count }, (_, i) => ({ id: String.fromCharCode(97 + i), name: `Player ${i + 1}` })), { seed: 42, firstPlayerId: 'a', ...options });
const act = (g, type, values = {}, id = g.currentPlayerId) => applyAction(g, id, { type, ...(['buy', 'auction'].includes(type) ? { propertyId: g.pendingPurchase } : {}), ...values });
const roll = (g, dice = [1, 2], id = g.currentPlayerId) => applyAction(g, id, { type: 'roll' }, { dice });
const grant = (g, ids, ownerId = 'a') => ids.forEach((id) => { g.properties[id].ownerId = ownerId; });
const forceCard = (g, deck, id) => { g._decks[deck] = [id, ...g._decks[deck].filter((item) => item !== id)]; };
const landWithRoll = (g, destination, dice = [1, 2]) => { g.players.find((p) => p.id === g.currentPlayerId).position = (destination - dice[0] - dice[1] + 40) % 40; return roll(g, dice); };
const invariants = (g) => {
  for (const p of g.players) {
    assert(Number.isSafeInteger(p.cash) && p.cash >= 0, 'No negative/fractional cash');
    assert(p.position >= (g.edition === 'inland' ? -1 : 0) && p.position < 40);
  }
  const buildings = Object.values(g.properties);
  assert.equal(g.bank.houses + buildings.reduce((n, p) => n + (p.houses < 5 ? p.houses : 0), 0), 32);
  assert.equal(g.bank.hotels + buildings.filter((p) => p.houses === 5).length, 12);
  for (const state of buildings) {
    assert(state.houses >= 0 && state.houses <= 5);
    if (state.mortgaged) assert.equal(state.houses, 0);
    if (state.ownerId) assert(g.players.some((p) => p.id === state.ownerId && !p.bankrupt));
  }
};

test('classic economics cover all 40 spaces, 28 deeds and 32 cards', () => {
  assert.equal(BOARD.length, 40);
  assert.equal(getPropertySpaces().length, 28);
  assert.deepEqual(BOARD[39].rents, [50, 200, 600, 1400, 1700, 2000]);
  assert.equal(BOARD[39].houseCost, 200);
  assert.equal(BOARD[4].amount, 200); assert.equal(BOARD[38].amount, 100);
  assert.equal(getCardDecks().chance.length, 16); assert.equal(getCardDecks().chest.length, 16);
  assert.equal(new Set(Object.values(getCardDecks()).flat().map((c) => c.id)).size, 32);
});

test('setup validation, high-roll starter and private state projection', () => {
  assert.throws(() => setup(1), /needs/); assert.throws(() => setup(9), /needs/);
  assert.throws(() => createGame([{ id: 'a' }, { id: 'a' }]), /unique/);
  const g = createGame([{ id: 'a' }, { id: 'b' }], { seed: 42 });
  assert(g.openingRolls.length >= 2);
  assert(g.players.every((p) => p.cash === 1500 && p.position === 0));
  assert.equal(g.bank.houses, 32); assert.equal(g.bank.hotels, 12);
  const snapshot = publicGame(g);
  assert(!Object.keys(snapshot).some((key) => key.startsWith('_')));
  assert(snapshot.permittedActions[g.currentPlayerId].includes('roll'));
  snapshot.players[0].cash = 0; assert.equal(g.players[0].cash, 1500);
});

test('forged out-of-turn rolls, unknown actions and invalid dice are rejected unchanged', () => {
  const g = setup(); const before = JSON.stringify(g);
  assert.throws(() => roll(g, [1, 2], 'b'), /not available/);
  assert.throws(() => act(g, 'cash', { amount: 99999 }), /not available/);
  assert.throws(() => roll(g, [0, 7]), /test dice/);
  assert.equal(JSON.stringify(g), before);
});

test('client-provided dice field does not override trusted dice source', () => {
  const g = setup(); applyAction(g, 'a', { type: 'roll', dice: [6, 6] }, { dice: [1, 2] });
  assert.deepEqual(g.dice, [1, 2]); assert.equal(g.players[0].position, 3);
});

test('buying a deed resolves the turn; rent is paid to its owner', () => {
  const g = setup(); roll(g); assert.equal(g.phase, 'buy'); assert.equal(g.pendingPurchase, 3);
  act(g, 'buy'); assert.equal(g.properties[3].ownerId, 'a'); assert.equal(g.players[0].cash, 1440); assert.equal(g.phase, 'end');
  act(g, 'endTurn'); roll(g); assert.equal(g.players[1].cash, 1496); assert.equal(g.players[0].cash, 1444); assert.equal(g.phase, 'end');
});

test('GO salary on crossing and landing is $200, not doubled for exact landing', () => {
  const g = setup(); g.players[0].position = 37; roll(g);
  assert.equal(g.players[0].position, 0); assert.equal(g.players[0].cash, 1700);
  assert.equal(g.log.filter((e) => e.type === 'passGo').length, 1);
});

test('doubles continue after property resolution; third doubles send directly to jail', () => {
  const g = setup(); g.players[0].position = 2; roll(g, [1, 1]); assert.equal(g.phase, 'roll');
  roll(g, [1, 1]); assert.equal(g.phase, 'buy'); act(g, 'buy'); assert.equal(g.phase, 'roll');
  roll(g, [1, 1]); assert.equal(g.players[0].position, 10); assert(g.players[0].inJail); assert.equal(g.phase, 'end');
  assert.equal(g._doubleCount, 0);
});

test('go-to-jail ends doubles without collecting GO', () => {
  const g = setup(); g.players[0].position = 24; roll(g, [3, 3]);
  assert.equal(g.players[0].position, 10); assert(g.players[0].inJail); assert.equal(g.players[0].cash, 1500); assert.equal(g.phase, 'end');
});

test('jail doubles release without another roll', () => {
  const g = setup(); Object.assign(g.players[0], { position: 10, inJail: true }); roll(g, [2, 2]);
  assert(!g.players[0].inJail); assert.equal(g.players[0].position, 14); act(g, 'buy'); assert.equal(g.phase, 'end');
});

test('jail third failure pauses for debt, then pays and moves using the existing dice', () => {
  const g = setup(); Object.assign(g.players[0], { position: 10, inJail: true, jailTurns: 2, cash: 20 }); grant(g, [1]);
  roll(g); assert.equal(g.phase, 'debt'); assert.equal(g.debt.amount, 50); assert.equal(g.players[0].position, 10);
  act(g, 'mortgage', { propertyId: 1 });
  assert.equal(g.debt, null); assert(!g.players[0].inJail); assert.equal(g.players[0].position, 13); assert.equal(g.phase, 'buy'); assert.equal(g.players[0].cash, 0);
});

test('voluntary jail payment and a held jail card restore the roll phase', () => {
  const g = setup(); Object.assign(g.players[0], { position: 10, inJail: true }); act(g, 'payJail');
  assert.equal(g.players[0].cash, 1450); assert(!g.players[0].inJail); assert.equal(g.phase, 'roll');
  g.players[0].inJail = true; g.players[0].jailCards = ['chance']; g._decks.chance = g._decks.chance.filter((id) => id !== 'chance-jail-free');
  act(g, 'useJailCard'); assert.equal(g.players[0].jailCards.length, 0); assert.equal(g._decks.chance.at(-1), 'chance-jail-free');
});

test('unimproved monopolies double rent even if another deed in the set is mortgaged', () => {
  const g = setup(); grant(g, [1, 3]); assert.equal(calculateRent(g, 1), 4);
  g.properties[3].mortgaged = true; assert.equal(calculateRent(g, 1), 4); assert.equal(calculateRent(g, 3), 0);
});

test('railroads count owned deeds and utilities multiply the current dice', () => {
  const g = setup(); grant(g, [5, 15, 25, 35, 12, 28]);
  assert.equal(calculateRent(g, 5), 200); g.properties[15].mortgaged = true; assert.equal(calculateRent(g, 5), 200);
  assert.equal(calculateRent(g, 12, 7), 70); g.properties[28].ownerId = 'b'; assert.equal(calculateRent(g, 12, 7), 28);
});

test('declined properties must auction; declining player may bid and a $1 bid is valid', () => {
  const g = setup(); roll(g); assert.throws(() => act(g, 'endTurn'), /not available/); act(g, 'auction');
  act(g, 'bid', { amount: 1 }, 'a'); act(g, 'passAuction', {}, 'b'); act(g, 'passAuction', {}, 'c');
  assert.equal(g.properties[3].ownerId, 'a'); assert.equal(g.players[0].cash, 1499); assert.equal(g.phase, 'end');
});

test('auction overbids, withdrawal by leader and overspending reserved funds are rejected', () => {
  const g = setup(); grant(g, [1, 3]); g.properties[1].mortgaged = true; landWithRoll(g, 6); act(g, 'auction');
  act(g, 'bid', { amount: 1490 }, 'a'); assert.equal(availableCash(g, 'a'), 10);
  assert.throws(() => act(g, 'unmortgage', { propertyId: 1 }), /costs/);
  assert.throws(() => act(g, 'passAuction', {}, 'a'), /not available/);
  assert.throws(() => act(g, 'bid', { amount: 2000 }, 'b'), /cash/);
  assert.throws(() => act(g, 'bid', { amount: 1480 }, 'b'), /higher/);
});

test('an auction with no bids returns the deed to the bank and resumes play', () => {
  const g = setup(); roll(g); act(g, 'auction'); for (const p of g.players) act(g, 'passAuction', {}, p.id);
  assert.equal(g.properties[3].ownerId, null); assert.equal(g.phase, 'end');
});

test('building requires an unmortgaged monopoly and must be even', () => {
  const g = setup(); grant(g, [1]); assert.throws(() => act(g, 'build', { propertyId: 1 }), /complete/);
  grant(g, [3]); act(g, 'build', { propertyId: 1 }); assert.throws(() => act(g, 'build', { propertyId: 1 }), /evenly/);
  act(g, 'build', { propertyId: 3 }); assert.equal(g.bank.houses, 30); assert.equal(calculateRent(g, 3), 20);
  assert.throws(() => act(g, 'mortgage', { propertyId: 1 }), /buildings/); invariants(g);
});

test('hotels need four houses throughout the set, return four houses and sell back correctly', () => {
  const g = setup(); grant(g, [1, 3]);
  for (let row = 0; row < 4; row++) { act(g, 'build', { propertyId: 1 }); act(g, 'build', { propertyId: 3 }); }
  act(g, 'build', { propertyId: 1 }); assert.equal(g.properties[1].houses, 5); assert.equal(g.bank.houses, 28); assert.equal(g.bank.hotels, 11);
  act(g, 'sellBuilding', { propertyId: 1 }); assert.equal(g.properties[1].houses, 4); assert.equal(g.bank.houses, 24); assert.equal(g.bank.hotels, 12); invariants(g);
});

test('scarce house stock blocks construction; hotels can be liquidated as an entire group', () => {
  const g = setup(); grant(g, [1, 3]); g.properties[1].houses = 5; g.properties[3].houses = 5; g.bank.hotels = 10; g.bank.houses = 0;
  assert.throws(() => act(g, 'sellBuilding', { propertyId: 1 }), /four houses/);
  const cash = g.players[0].cash; act(g, 'sellGroupBuildings', { propertyId: 1 }); assert.equal(g.players[0].cash, cash + 250); assert.equal(g.bank.hotels, 12);
  assert.throws(() => act(g, 'build', { propertyId: 1 }), /no building/);
});

test('a building auction supports eligible competing owners and places the winner building', () => {
  const g = setup(); grant(g, [1, 3]); grant(g, [6, 8, 9], 'b');
  assert.throws(() => act(g, 'auctionBuilding', { propertyId: 1 }), /enough buildings/);
  grant(g, [11, 13, 14, 16, 18, 19, 21, 23, 24], 'c');
  for (const id of [11, 13, 14, 16, 18, 19]) g.properties[id].houses = 4;
  g.properties[21].houses = 3; g.properties[23].houses = 2; g.properties[24].houses = 2; g.bank.houses = 1;
  act(g, 'auctionBuilding', { propertyId: 1 }); assert.equal(g.auction.kind, 'building'); assert.deepEqual(g.auction.eligiblePlayerIds, ['a', 'b', 'c']);
  act(g, 'bid', { amount: 60, propertyId: 8 }, 'b'); assert.throws(() => act(g, 'build', { propertyId: 1 }), /not available/);
  act(g, 'passAuction', {}, 'a'); act(g, 'passAuction', {}, 'c'); assert.equal(g.properties[8].houses, 1); assert.equal(g.players[1].cash, 1440); assert.equal(g.bank.houses, 0); assert.equal(g.phase, 'roll'); invariants(g);
});

test('mortgages return printed principal, charge rounded 10% interest and prohibit mortgaged construction', () => {
  const g = setup(); grant(g, [12, 1, 3]); act(g, 'mortgage', { propertyId: 12 }); assert.equal(g.players[0].cash, 1575);
  act(g, 'unmortgage', { propertyId: 12 }); assert.equal(g.players[0].cash, 1492);
  act(g, 'mortgage', { propertyId: 1 }); assert.throws(() => act(g, 'build', { propertyId: 3 }), /Unmortgage/);
});

test('property trades reject buildings anywhere in the group and handle immediate mortgage interest choices', () => {
  const g = setup(); grant(g, [1, 3]); act(g, 'build', { propertyId: 1 }); assert.throws(() => transferProperty(g, 'a', 'b', 3), /every building/);
  act(g, 'sellBuilding', { propertyId: 1 }); act(g, 'mortgage', { propertyId: 1 }); transferProperty(g, 'a', 'b', 1);
  assert.equal(g.players[1].cash, 1497); assert(g.properties[1].mortgaged);
  transferProperty(g, 'b', 'c', 1, { liftMortgage: true }); assert.equal(g.players[2].cash, 1467); assert(!g.properties[1].mortgaged);
});

test('unaffordable rent creates debt without negative cash and mortgage proceeds settle it', () => {
  const g = setup(); grant(g, [1]); grant(g, [3], 'b'); g.players[0].cash = 2; roll(g);
  assert.equal(g.debt.amount, 4); assert.equal(g.players[0].cash, 2); assert.equal(g.phase, 'debt');
  assert.throws(() => act(g, 'bankrupt'), /not available/); act(g, 'mortgage', { propertyId: 1 });
  assert.equal(g.debt, null); assert.equal(g.players[0].cash, 28); assert.equal(g.players[1].cash, 1504); assert.equal(g.phase, 'end');
});

test('cash/property contracts can rescue a debtor and settleDebt resumes queued effects', () => {
  const g = setup(); grant(g, [1]); g.players[0].cash = 0; chargePlayer(g, 'a', null, 80, 'Test fine');
  g.players[1].cash -= 80; g.players[0].cash += 80; transferProperty(g, 'a', 'b', 1); settleDebt(g);
  assert.equal(g.debt, null); assert.equal(g.properties[1].ownerId, 'b'); assert.equal(g.players[0].cash, 0); assert.equal(g.phase, 'roll');
});

test('bankruptcy to another player liquidates buildings and transfers assets, then offers mortgage choice', () => {
  const g = setup(); grant(g, [1, 3]); act(g, 'mortgage', { propertyId: 1 }); g.players[0].cash = 10;
  chargePlayer(g, 'a', 'b', 1000, 'Rent'); act(g, 'bankrupt');
  assert(g.players[0].bankrupt); assert.equal(g.properties[1].ownerId, 'b'); assert.equal(g.players[1].cash, 1510);
  assert.equal(g.phase, 'mortgageChoice'); assert.equal(g.pendingMortgage.redeemCost, 33);
  act(g, 'redeemMortgage', {}, 'b'); assert(!g.properties[1].mortgaged); assert.equal(g.players[1].cash, 1477); assert.equal(g.currentPlayerId, 'b'); invariants(g);
});

test('retaining inherited mortgage charges 10% now and normal payoff later', () => {
  const g = setup(); grant(g, [1]); g.properties[1].mortgaged = true; g.players[0].cash = 0;
  chargePlayer(g, 'a', 'b', 100, 'Rent'); act(g, 'bankrupt'); act(g, 'retainMortgage', {}, 'b'); assert.equal(g.players[1].cash, 1497);
  act(g, 'unmortgage', { propertyId: 1 }, 'b'); assert.equal(g.players[1].cash, 1464);
});

test('inherited mortgage cannot be traded before its selection or mandatory settlement is paid', () => {
  const g = setup(4); grant(g, [1]); g.properties[1].mortgaged = true; g.players[0].cash = 0;
  chargePlayer(g, 'a', 'b', 100, 'Rent'); act(g, 'bankrupt');
  assert.throws(() => transferProperty(g, 'b', 'c', 1), /inherited mortgage/);
  g.players[1].cash = 0; grant(g, [3], 'b'); act(g, 'retainMortgage', {}, 'b');
  assert.equal(g.debt.mortgagePropertyId, 1); assert.throws(() => transferProperty(g, 'b', 'c', 1), /inherited mortgage/);
  transferProperty(g, 'b', 'c', 3); g.players[1].cash = 3; settleDebt(g);
  transferProperty(g, 'b', 'c', 1); assert.equal(g.properties[1].ownerId, 'c');
});

test('round counter follows the starting seat rather than array position zero', () => {
  const g = setup(3, { firstPlayerId: 'c' });
  for (const expected of ['a', 'b']) { landWithRoll(g, 20); act(g, 'endTurn'); assert.equal(g.currentPlayerId, expected); assert.equal(g.round, 1); }
  landWithRoll(g, 20); act(g, 'endTurn'); assert.equal(g.currentPlayerId, 'c'); assert.equal(g.round, 2);
  assert(g.log.every((event) => Number.isFinite(Date.parse(event.at))));
});

test('bankruptcy to bank auctions all returned properties before advancing turn', () => {
  const g = setup(); grant(g, [1, 3]); g.players[0].cash = 0; chargePlayer(g, 'a', null, 1000, 'Tax'); act(g, 'bankrupt');
  assert.equal(g.auction.propertyId, 1); act(g, 'bid', { amount: 1 }, 'b'); act(g, 'passAuction', {}, 'c');
  assert.equal(g.auction.propertyId, 3); act(g, 'bid', { amount: 2 }, 'c'); act(g, 'passAuction', {}, 'b');
  assert.equal(g.properties[1].ownerId, 'b'); assert.equal(g.properties[3].ownerId, 'c'); assert.equal(g.currentPlayerId, 'b'); assert.equal(g.phase, 'roll'); invariants(g);
});

test('the last solvent player wins and no further actions are accepted', () => {
  const g = setup(2); g.players[0].cash = 0; chargePlayer(g, 'a', 'b', 10, 'Rent'); act(g, 'bankrupt');
  assert.equal(g.status, 'finished'); assert.equal(g.winnerId, 'b'); assert.throws(() => act(g, 'roll', {}, 'b'), /not active/);
});

test('advance-to-GO card can earn a second salary in the same roll', () => {
  const g = setup(); forceCard(g, 'chance', 'chance-go'); g.players[0].position = 38; roll(g, [3, 6]);
  assert.equal(g.players[0].cash, 1900); assert.equal(g.players[0].position, 0); assert.equal(g.log.filter((e) => e.type === 'passGo').length, 2);
});

test('back-three Chance card resolves Community Chest on the destination', () => {
  const g = setup(); forceCard(g, 'chance', 'chance-back-three'); forceCard(g, 'chest', 'chest-bank-error'); landWithRoll(g, 36);
  assert.equal(g.players[0].position, 33); assert.equal(g.players[0].cash, 1700); assert.equal(g.lastCard.id, 'chest-bank-error');
});

test('nearest railroad card charges twice normal rent and awards GO salary', () => {
  const g = setup(); grant(g, [5, 15], 'b'); forceCard(g, 'chance', 'chance-railroad-1'); landWithRoll(g, 36);
  assert.equal(g.players[0].position, 5); assert.equal(g.players[0].cash, 1600); assert.equal(g.players[1].cash, 1600);
});

test('nearest utility card rolls fresh dice and applies 10x rent', () => {
  const g = setup(); grant(g, [12], 'b'); forceCard(g, 'chance', 'chance-utility'); landWithRoll(g, 7);
  const event = g.log.find((e) => e.type === 'utilityRoll'); assert(event); assert.equal(g.players[0].cash, 1500 - event.total * 10);
});

test('held jail cards leave the deck until used', () => {
  const g = setup(); forceCard(g, 'chance', 'chance-jail-free'); landWithRoll(g, 7);
  assert.deepEqual(g.players[0].jailCards, ['chance']); assert.equal(g._decks.chance.length, 15); assert(!g._decks.chance.includes('chance-jail-free'));
});

test('repair cards count a hotel once, not as four houses plus a hotel', () => {
  const g = setup(); grant(g, [1, 3]); g.properties[1].houses = 5; g.properties[3].houses = 4;
  forceCard(g, 'chance', 'chance-repairs'); landWithRoll(g, 7); assert.equal(g.players[0].cash, 1300);
});

test('collect-from-each-player card pauses for another player debt and resumes later payers', () => {
  const g = setup(); grant(g, [3], 'b'); g.players[1].cash = 0; forceCard(g, 'chest', 'chest-birthday'); landWithRoll(g, 17);
  assert.equal(g.debt.playerId, 'b'); assert.equal(g.debt.creditorId, 'a'); assert.equal(g.players[2].cash, 1500);
  act(g, 'mortgage', { propertyId: 3 }, 'b'); assert.equal(g.debt, null); assert.equal(g.players[0].cash, 1520); assert.equal(g.players[1].cash, 20); assert.equal(g.players[2].cash, 1490); assert.equal(g.phase, 'end');
});

test('all card effects resolve through valid game phases', () => {
  for (const deck of ['chance', 'chest']) for (const card of getCardDecks()[deck]) {
    const g = setup(); forceCard(g, deck, card.id); landWithRoll(g, deck === 'chance' ? 7 : 17);
    assert(['buy', 'end', 'roll', 'debt'].includes(g.phase), `${card.id}: ${g.phase}`); invariants(g);
  }
});

test('Inland edition has verified prices, different 36/37 layout and separate color grouping', () => {
  const g = setup(3, { edition: 'inland-empire' }); const board = getBoard(g);
  assert.equal(g.edition, 'inland'); assert.equal(g.players[0].cash, 1630); assert.equal(g.players[0].position, -1);
  assert.equal(board[1].price, 70); assert.equal(board[21].price, 210); assert.equal(board[21].mortgage, 110); assert.equal(board[38].amount, 75);
  assert.equal(board[36].name, 'Wine Country'); assert.equal(board[36].type, 'property'); assert.equal(board[37].type, 'chance');
  assert.deepEqual(getGroups(g).darkBlue, [36, 39]); assert.equal(g.properties[37], undefined); assert(g.properties[36]);
  assert.throws(() => setup(7, { edition: 'inland' }), /2–6/);
  assert.match(g.editionInfo.verification, /fallback/);
});

test('the requested Resort replaces only The Mule Car and retains its $70 slot economics', () => {
  const g = setup(3, { edition: 'inland' }); const board = getBoard(g); const resort = board[1];
  assert.equal(board.length, 40); assert.equal(getPropertySpaces(g).length, 28);
  assert.equal(resort.name, 'The Resort'); assert.equal(resort.subtitle, 'Apartment complex'); assert.equal(resort.originalName, 'The Mule Car');
  assert.equal(resort.price, 70); assert.equal(resort.mortgage, 30); assert.deepEqual(resort.rents, BOARD[1].rents); assert.equal(resort.houseCost, 50);
  assert.equal(resort.verification.name, 'user-customization'); assert.equal(resort.verification.economics, 'classic-fallback-unverified');
  assert.equal(g.editionInfo.customizations[0].propertyId, 1); assert.equal(getBoard('classic')[1].name, 'Mediterranean Avenue');
  landWithRoll(g, 1); const cash = g.players[0].cash; act(g, 'buy'); assert.equal(g.players[0].cash, cash - 70); assert.equal(g.properties[1].ownerId, 'a');
});

test('Inland starts from center, counts GO as first step and uses verified property price', () => {
  const g = setup(3, { edition: 'inland' }); roll(g, [1, 3]); assert.equal(g.players[0].position, 3); assert.equal(g.players[0].cash, 1830);
  act(g, 'buy'); assert.equal(g.players[0].cash, 1750); assert.equal(g.properties[3].ownerId, 'a');
});

test('Inland uses the winning opening roll as its first movement in production setup', () => {
  const g = createGame([{ id: 'a' }, { id: 'b' }, { id: 'c' }], { seed: 42, edition: 'inland' });
  const opening = g.openingRolls.findLast((entry) => entry.playerId === g.currentPlayerId);
  const initialRoll = g.log.find((entry) => entry.type === 'roll');
  assert.deepEqual(initialRoll.dice, opening.dice);
  assert(g.log.some((entry) => entry.type === 'move'));
  assert(g.players.filter((p) => p.id !== g.currentPlayerId).every((p) => p.position === -1));
});

test('Inland fines fund the center pot and I Love Inland Empire collects it', () => {
  const g = setup(3, { edition: 'inland' }); landWithRoll(g, 38); assert.equal(g.centerPot, 75); assert.equal(g.players[0].cash, 1555);
  act(g, 'endTurn'); landWithRoll(g, 20); assert.equal(g.centerPot, 0); assert.equal(g.players[1].cash, 1705);
});

test('Inland Traffic Jam third attempt costs $100 and voluntary early fee is unavailable', () => {
  const g = setup(3, { edition: 'inland' }); Object.assign(g.players[0], { position: 10, inJail: true, jailTurns: 2 });
  assert.throws(() => act(g, 'payJail'), /not available/); roll(g); assert.equal(g.players[0].cash, 1530); assert.equal(g.centerPot, 100); assert(!g.players[0].inJail);
});

test('verified Inland card effects pay $20 and skip exactly the next turn', () => {
  const g = setup(3, { edition: 'inland' }); forceCard(g, 'chance', 'inland-contingency-route66'); landWithRoll(g, 7);
  assert.equal(g.players[0].cash, 1650); assert.equal(g.lastCard.verification, 'visible-card-photo');
  g.phase = 'roll'; g._resumePhase = 'roll'; forceCard(g, 'chance', 'inland-contingency-donuts'); landWithRoll(g, 7); assert.equal(g.players[0].skipTurns, 1);
  act(g, 'endTurn'); landWithRoll(g, 20); act(g, 'endTurn'); landWithRoll(g, 20); act(g, 'endTurn');
  assert.equal(g.currentPlayerId, 'b'); assert.equal(g.players[0].skipTurns, 0); assert(g.log.some((e) => e.type === 'skipTurn' && e.playerId === 'a'));
});

test('Inland fallback cards and deeds are explicitly marked', () => {
  const g = setup(3, { edition: 'inland' }); forceCard(g, 'chest', 'inland-chest-stock'); landWithRoll(g, 17);
  assert.equal(g.lastCard.verification, 'classic-fallback-unverified'); assert.equal(getBoard(g)[3].verification.economics, 'classic-fallback-unverified');
  assert.equal(getBoard(g)[39].verification.economics, 'visible-deed-photo');
});

test('liquidatable value includes hotel liquidation and unmortgaged principal exactly once', () => {
  const g = setup(); grant(g, [1, 3]); g.properties[1].houses = 5; g.properties[3].mortgaged = true;
  assert.equal(liquidatableValue(g, 'a'), 1500 + 125 + 30);
});

test('seeded long-running games preserve cash, ownership and finite building inventories', () => {
  for (const edition of ['classic', 'inland']) {
    const g = setup(4, { edition, seed: 109 });
    for (let step = 0; step < 1200 && g.status === 'playing'; step++) {
      if (g.debt) {
        const debtor = g.debt.playerId;
        const sell = Object.entries(g.properties).find(([, s]) => s.ownerId === debtor && s.houses);
        const unmortgaged = Object.entries(g.properties).find(([, s]) => s.ownerId === debtor && !s.mortgaged);
        if (sell) act(g, 'sellGroupBuildings', { propertyId: Number(sell[0]) }, debtor);
        else if (unmortgaged) act(g, 'mortgage', { propertyId: Number(unmortgaged[0]) }, debtor);
        else act(g, 'bankrupt', {}, debtor);
      } else if (g.pendingMortgage) act(g, g.edition === 'inland' ? 'redeemMortgage' : 'retainMortgage', {}, g.pendingMortgage.playerId);
      else if (g.auction) {
        const eligible = g.auction.eligiblePlayerIds.filter((id) => !g.auction.passedPlayerIds.includes(id) && id !== g.auction.highestBidderId);
        act(g, 'passAuction', {}, eligible[0]);
      } else if (g.phase === 'roll') act(g, 'roll');
      else if (g.phase === 'buy') {
        const current = g.players.find((p) => p.id === g.currentPlayerId);
        act(g, current.cash >= getBoard(g)[g.pendingPurchase].price ? 'buy' : 'auction');
      } else if (g.phase === 'end') act(g, 'endTurn');
      else assert.fail(`Unhandled game phase: ${g.phase}`);
      invariants(g);
    }
    assert(g.turn > 40 || g.status === 'finished');
    const ids = g.log.map((event) => event.id); assert.equal(ids.length, new Set(ids).size);
  }
});
