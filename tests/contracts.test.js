import test from 'node:test';
import assert from 'node:assert/strict';
import { chargePlayer, applyAction } from '../shared/engine.js';
import { fixture } from './server-helpers.js';

async function propose(f, terms) {
  const room = await f.success(0, { type: 'contract:propose', counterpartyId: f.users[1].playerId, title: 'Fair deal', terms });
  return room.contracts[0];
}
async function sign(f, contract, index) { return f.success(index, { type: 'contract:sign', contractId: contract.id, revision: contract.revision }); }
async function bothSign(f, contract) { await sign(f, contract, 0); return sign(f, contract, 1); }

test('same-revision signatures execute atomically and strangers cannot sign', async t => {
  const f = await fixture(t, 3);
  await f.start();
  const [a, b] = f.users.map(u => u.playerId);
  f.server.store.transaction(data => { data.rooms[f.code].game.properties[1].ownerId = a; });
  const contract = await propose(f, { transfers: [{ fromPlayerId: a, toPlayerId: b, propertyIds: [1] }, { fromPlayerId: b, toPlayerId: a, cash: 100 }] });
  assert.equal((await f.action(2, { type: 'contract:sign', contractId: contract.id, revision: 1 })).ok, false);
  let room = await sign(f, contract, 0);
  assert.equal(room.game.properties[1].ownerId, a);
  assert.equal(room.contracts[0].signatures.length, 1);
  room = await sign(f, contract, 1);
  assert.equal(room.game.properties[1].ownerId, b);
  assert.equal(room.game.players[0].cash, 1600);
  assert.equal(room.game.players[1].cash, 1400);
  assert.equal(room.contracts[0].status, 'completed');
  assert.equal(room.contracts[0].signatures.length, 2);
  assert.equal((await f.action(0, { type: 'contract:revise', contractId: contract.id, revision: 1, terms: { customTerms: 'Changed' } })).ok, false);
});

test('revision invalidates prior signatures and failing final validation rolls back all transfers', async t => {
  const f = await fixture(t);
  await f.start();
  const [a, b] = f.users.map(u => u.playerId);
  const contract = await propose(f, { transfers: [{ fromPlayerId: a, toPlayerId: b, cash: 100 }] });
  await sign(f, contract, 0);
  const room = await f.success(1, { type: 'contract:revise', contractId: contract.id, revision: 1, terms: { transfers: [{ fromPlayerId: a, toPlayerId: b, cash: 1600 }] } });
  assert.equal(room.contracts[0].revision, 2);
  assert.equal(room.contracts[0].signatures.length, 0);
  assert.equal((await f.action(0, { type: 'contract:sign', contractId: contract.id, revision: 1 })).ok, false);
  await sign(f, { ...contract, revision: 2 }, 0);
  const failed = await f.action(1, { type: 'contract:sign', contractId: contract.id, revision: 2 });
  assert.equal(failed.ok, false);
  const saved = f.server.store.data.rooms[f.code];
  assert.equal(saved.game.players[0].cash, 1500);
  assert.equal(saved.game.players[1].cash, 1500);
  assert.equal(saved.contracts[0].signatures.length, 1);
});

test('property trades require cleared buildings and charge mortgaged transfer interest', async t => {
  const f = await fixture(t);
  await f.start();
  const [a, b] = f.users.map(u => u.playerId);
  f.server.store.transaction(data => {
    const game = data.rooms[f.code].game;
    game.properties[1].ownerId = a;
    game.properties[3].ownerId = a;
    game.properties[3].houses = 1;
  });
  let contract = await propose(f, { transfers: [{ fromPlayerId: a, toPlayerId: b, propertyIds: [1] }] });
  await sign(f, contract, 0);
  assert.equal((await f.action(1, { type: 'contract:sign', contractId: contract.id, revision: 1 })).ok, false);
  f.server.store.transaction(data => {
    const game = data.rooms[f.code].game;
    game.properties[3].houses = 0;
    game.properties[1].mortgaged = true;
  });
  const room = await sign(f, contract, 1);
  assert.equal(room.game.properties[1].ownerId, b);
  assert.equal(room.game.properties[1].mortgaged, true);
  assert.equal(room.game.players[1].cash, 1497);
});

test('a property-for-cash contract rescues core game debt and resumes play', async t => {
  const f = await fixture(t, 3);
  await f.start();
  const [a, b, creditor] = f.users.map(u => u.playerId);
  f.server.store.transaction(data => {
    const game = data.rooms[f.code].game;
    game.players[0].cash = 50;
    game.properties[1].ownerId = a;
    chargePlayer(game, a, creditor, 125, 'Rent');
  });
  const contract = await propose(f, { transfers: [{ fromPlayerId: a, toPlayerId: b, propertyIds: [1] }, { fromPlayerId: b, toPlayerId: a, cash: 100 }] });
  const room = await bothSign(f, contract);
  assert.equal(room.game.debt, null);
  assert.equal(room.game.players[0].cash, 25);
  assert.equal(room.game.players[1].cash, 1400);
  assert.equal(room.game.players[2].cash, 1625);
  assert.equal(room.game.properties[1].ownerId, b);
  assert.notEqual(room.game.phase, 'debt');
});

test('future turn payments default visibly and can be settled without a negative balance', async t => {
  const f = await fixture(t);
  await f.start();
  const [a, b] = f.users.map(u => u.playerId);
  const contract = await propose(f, { obligations: [{ debtorId: a, creditorId: b, amount: 1600, trigger: { type: 'afterTurns', turns: 1 } }] });
  await bothSign(f, contract);
  f.server.store.transaction(data => { data.rooms[f.code].game.phase = 'end'; });
  let room = await f.success(0, { type: 'endTurn' });
  const obligation = room.contracts[0].obligations[0];
  assert.equal(obligation.status, 'defaulted');
  assert.equal(room.game.players[0].cash, 1500);
  assert.equal((await f.action(1, { type: 'contract:pay', contractId: contract.id, obligationId: obligation.id })).ok, false);
  f.server.store.transaction(data => { data.rooms[f.code].game.players[0].cash = 1700; });
  room = await f.success(0, { type: 'contract:pay', contractId: contract.id, obligationId: obligation.id });
  assert.equal(room.contracts[0].status, 'completed');
  assert.equal(room.game.players[0].cash, 100);
  assert.equal(room.game.players[1].cash, 3100);
});

test('manual monetary conditions require both parties to attest and repeated payments are capped', async t => {
  const f = await fixture(t);
  await f.start();
  const [a, b] = f.users.map(u => u.playerId);
  const contract = await propose(f, { obligations: [{ debtorId: a, creditorId: b, amount: 50, trigger: { type: 'manual', condition: 'We both agree the favor happened' }, repeat: true, maxOccurrences: 2 }], customTerms: 'This prose records the agreement; it is not an automated trigger.' });
  let room = await bothSign(f, contract);
  const id = room.contracts[0].obligations[0].id;
  room = await f.success(0, { type: 'contract:confirm', contractId: contract.id, obligationId: id });
  assert.equal(room.game.players[0].cash, 1500);
  assert.equal((await f.action(0, { type: 'contract:confirm', contractId: contract.id, obligationId: id })).ok, false);
  room = await f.success(1, { type: 'contract:confirm', contractId: contract.id, obligationId: id });
  assert.equal(room.game.players[0].cash, 1450);
  assert.equal(room.contracts[0].obligations[0].paidCount, 1);
  await f.success(1, { type: 'contract:confirm', contractId: contract.id, obligationId: id });
  room = await f.success(0, { type: 'contract:confirm', contractId: contract.id, obligationId: id });
  assert.equal(room.game.players[0].cash, 1400);
  assert.equal(room.contracts[0].status, 'completed');
});

test('GO and landing triggers execute once per new event and stop at the agreed count', async t => {
  const f = await fixture(t);
  await f.start();
  const [a, b] = f.users.map(u => u.playerId);
  const contract = await propose(f, { obligations: [
    { debtorId: a, creditorId: b, amount: 75, trigger: { type: 'passGo' }, repeat: true, maxOccurrences: 2 },
    { debtorId: a, creditorId: b, amount: 20, trigger: { type: 'landOn', propertyId: 1 }, repeat: true, maxOccurrences: 2 },
  ] });
  await bothSign(f, contract);
  function nextRandom(seed) {
    let value = seed | 0;
    value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
    return value >>> 0;
  }
  // Pick a private seed for a deterministic 1+2 roll; the wire never accepts dice.
  let seed = 1;
  while (seed < 1000000) {
    const first = nextRandom(seed), second = nextRandom(first);
    if (Math.floor(first / 0x100000000 * 6) === 0 && Math.floor(second / 0x100000000 * 6) === 1) break;
    seed += 1;
  }
  assert.ok(seed < 1000000);
  const setRoll = () => f.server.store.transaction(data => {
    const game = data.rooms[f.code].game;
    game.players[0].position = 38;
    game.currentPlayerId = a;
    game.phase = 'roll';
    game.pendingPurchase = null;
    game._randomState = seed;
  });
  setRoll();
  let room = await f.success(0, { type: 'roll' });
  assert.deepEqual(room.game.dice, [1, 2]);
  assert.equal(room.game.players[0].cash, 1605);
  assert.equal(room.contracts[0].obligations[0].paidCount, 1);
  room = await f.success(1, { type: 'vote:propose', title: 'No duplicate payments', rule: 'majority' });
  assert.equal(room.game.players[0].cash, 1605);
  setRoll();
  room = await f.success(0, { type: 'roll' });
  assert.equal(room.game.players[0].cash, 1710);
  assert.equal(room.contracts[0].status, 'completed');
  setRoll();
  room = await f.success(0, { type: 'roll' });
  assert.equal(room.game.players[0].cash, 1910);
  assert.equal(room.game.log.filter(event => event.type === 'contractPayment').length, 4);
});

test('cash reserved for an auction cannot be spent by a newly signed contract', async t => {
  const f = await fixture(t);
  await f.start();
  const [a, b] = f.users.map(u => u.playerId);
  f.server.store.transaction(data => {
    const game = data.rooms[f.code].game;
    game.auction = { kind: 'property', propertyId: 1, highestBidderId: a, currentBid: 1450, eligiblePlayerIds: [a, b], passedPlayerIds: [], reason: 'Test auction' };
    game.phase = 'auction';
  });
  const contract = await propose(f, { transfers: [{ fromPlayerId: a, toPlayerId: b, cash: 100 }] });
  await sign(f, contract, 0);
  const result = await f.action(1, { type: 'contract:sign', contractId: contract.id, revision: 1 });
  assert.equal(result.ok, false);
  assert.match(result.error, /available cash/);
  assert.equal(f.server.store.data.rooms[f.code].game.players[0].cash, 1500);
});

test('newly signed conditions do not charge for landing events that preceded their activation', async t => {
  const f = await fixture(t);
  await f.start();
  const [a, b] = f.users.map(u => u.playerId);
  f.server.store.transaction(data => {
    const game = data.rooms[f.code].game;
    Object.assign(game.players[0], { position: 10, inJail: true, jailTurns: 2, cash: 0 });
    applyAction(game, a, { type: 'roll' }, { dice: [1, 2] });
    assert.equal(game.debt.amount, 50);
  });
  const contract = await propose(f, {
    transfers: [{ fromPlayerId: b, toPlayerId: a, cash: 50 }],
    obligations: [{ debtorId: a, creditorId: b, amount: 20, trigger: { type: 'landOn', propertyId: 13 } }],
  });
  const room = await bothSign(f, contract);
  assert.equal(room.game.debt, null);
  assert.equal(room.game.players[0].position, 13);
  assert.equal(room.game.players[0].cash, 0);
  assert.equal(room.contracts[0].obligations[0].status, 'pending');
  assert.equal(room.contracts[0].obligations[0].events.length, 0);
});

test('a signed mortgage-redemption term pays principal and interest exactly once', async t => {
  const f = await fixture(t);
  await f.start();
  const [a, b] = f.users.map(u => u.playerId);
  f.server.store.transaction(data => {
    Object.assign(data.rooms[f.code].game.properties[1], { ownerId: a, mortgaged: true });
  });
  const contract = await propose(f, { transfers: [{ fromPlayerId: a, toPlayerId: b, propertyIds: [1], liftMortgagePropertyIds: [1] }] });
  const room = await bothSign(f, contract);
  assert.equal(room.game.properties[1].ownerId, b);
  assert.equal(room.game.properties[1].mortgaged, false);
  assert.equal(room.game.players[1].cash, 1467);
});

test('repeating turn payments count skipped table turns and each turn in one action batch', async t => {
  const f = await fixture(t);
  await f.start();
  const [a, b] = f.users.map(u => u.playerId);
  const contract = await propose(f, { obligations: [{ debtorId: a, creditorId: b, amount: 25, trigger: { type: 'afterTurns', turns: 1 }, repeat: true, maxOccurrences: 3 }] });
  await bothSign(f, contract);
  f.server.store.transaction(data => {
    const game = data.rooms[f.code].game;
    game.phase = 'end';
    game.players[1].skipTurns = 1;
  });
  const room = await f.success(0, { type: 'endTurn' });
  assert.equal(room.game.turn, 3);
  assert.equal(room.game.currentPlayerId, a);
  assert.ok(room.game.log.some(event => event.type === 'skipTurn' && event.turn === 2));
  assert.ok(room.game.log.some(event => event.type === 'turn' && event.turn === 3));
  assert.equal(room.contracts[0].obligations[0].paidCount, 2);
  assert.equal(room.contracts[0].obligations[0].nextDueTurn, 4);
  assert.equal(room.contracts[0].obligations[0].status, 'pending');
  assert.equal(room.game.players[0].cash, 1450);
  assert.equal(room.game.players[1].cash, 1550);
});
