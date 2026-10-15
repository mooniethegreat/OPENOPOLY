import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { handleContract, processScheduledPayments, processContractEvents, nextScheduledPaymentAt, MAX_SCHEDULE_AHEAD_MS } from '../server/contracts.js';
import { createGame, chargePlayer, recordEvent } from '../shared/engine.js';
import { fixture } from './server-helpers.js';
import { RoomStore } from '../server/store.js';

function contractRoom() {
  const players = [{ id: 'a', name: 'Alex' }, { id: 'b', name: 'Bea' }, { id: 'c', name: 'Cam' }];
  return { status: 'playing', players, game: createGame(players, { firstPlayerId: 'a', seed: 15 }), contracts: [] };
}

function signTerms(room, terms) {
  handleContract(room, 'a', { type: 'contract:propose', counterpartyId: 'b', terms });
  const contract = room.contracts[0];
  for (const actor of ['a', 'b']) handleContract(room, actor, { type: 'contract:sign', contractId: contract.id, revision: 1 });
  return contract;
}

async function propose(f, terms) {
  const proposed = await f.success(0, { type: 'contract:propose', counterpartyId: f.users[1].playerId, terms });
  return proposed.contracts[0];
}

async function bothSign(f, contract) {
  await f.success(0, { type: 'contract:sign', contractId: contract.id, revision: contract.revision });
  return f.success(1, { type: 'contract:sign', contractId: contract.id, revision: contract.revision });
}

function stateWhen(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.off('room:state', onState); reject(new Error('Expected scheduled payment broadcast')); }, 4000);
    function onState(room) {
      if (!predicate(room)) return;
      clearTimeout(timeout); socket.off('room:state', onState); resolve(room);
    }
    socket.on('room:state', onState);
  });
}

test('clock conditions require valid future zoned times, a 30-day bound and a single occurrence', () => {
  const future = new Date(Date.now() + 60000).toISOString();
  const base = { debtorId: 'a', creditorId: 'b', amount: 30, trigger: { type: 'atTime', at: future } };
  for (const trigger of [
    { type: 'atTime', at: '2026-10-15T10:00:00' },
    { type: 'atTime', at: '2026-02-30T10:00:00Z' },
    { type: 'atTime', at: '2000-01-01T00:00:00Z' },
    { type: 'atTime', at: new Date(Date.now() + MAX_SCHEDULE_AHEAD_MS + 60000).toISOString() },
    { type: 'atTime', at: 'not a timestamp' },
  ]) assert.throws(() => signTerms(contractRoom(), { obligations: [{ ...base, trigger }] }), /time|30 days|future/);
  assert.throws(() => signTerms(contractRoom(), { obligations: [{ ...base, repeat: true }] }), /only once/);
  const room = contractRoom();
  const contract = signTerms(room, { obligations: [base] });
  assert.equal(contract.obligations[0].trigger.at, future);
  assert.equal(nextScheduledPaymentAt(room), Date.parse(future));
});

test('scheduled payments persist a terminal occurrence and repeated clock processing never charges twice', () => {
  const room = contractRoom();
  const at = new Date(Date.now() + 60000).toISOString();
  const contract = signTerms(room, { obligations: [{ debtorId: 'a', creditorId: 'b', amount: 40, trigger: { type: 'atTime', at } }] });
  assert.equal(processScheduledPayments(room, Date.parse(at) - 1), false);
  assert.equal(processScheduledPayments(room, Date.parse(at)), true);
  assert.deepEqual(room.game.players.map(player => player.cash), [1460, 1540, 1500]);
  assert.equal(contract.status, 'completed');
  assert.equal(contract.obligations[0].paidCount, 1);
  assert.equal(contract.obligations[0].lastPaidAt, at);
  assert.equal(processScheduledPayments(room, Date.parse(at) + 1000), false);
  assert.equal(nextScheduledPaymentAt(room), Infinity);
  assert.equal(room.game.log.filter(event => event.type === 'contractPayment').length, 1);
});

test('a failed deadline commit leaves balances and occurrence state unchanged for a safe retry', () => {
  const room = contractRoom();
  const at = new Date(Date.now() + 60000).toISOString();
  signTerms(room, { obligations: [{ debtorId: 'a', creditorId: 'b', amount: 40, trigger: { type: 'atTime', at } }] });
  const store = new RoomStore(null);
  store.data.rooms.TEST = room;
  const before = structuredClone(store.data);
  const commit = store.commit.bind(store);
  store.commit = () => { throw new Error('Disk unavailable'); };
  assert.throws(() => store.transaction(data => processScheduledPayments(data.rooms.TEST, Date.parse(at))), /Disk unavailable/);
  assert.deepEqual(store.data, before);
  store.commit = commit;
  store.transaction(data => processScheduledPayments(data.rooms.TEST, Date.parse(at)));
  assert.equal(store.data.rooms.TEST.game.players[0].cash, 1460);
  assert.equal(store.data.rooms.TEST.contracts[0].obligations[0].paidCount, 1);
});

test('clock defaults preserve money and reservations, pause permanently, and can be explicitly paid later', () => {
  const room = contractRoom();
  const at = new Date(Date.now() + 60000).toISOString();
  const contract = signTerms(room, { obligations: [{ debtorId: 'a', creditorId: 'b', amount: 100, trigger: { type: 'atTime', at } }] });
  room.game.auction = { highestBidderId: 'a', currentBid: 1450 };
  processScheduledPayments(room, Date.parse(at));
  const obligation = contract.obligations[0];
  assert.equal(obligation.status, 'defaulted');
  assert.equal(obligation.defaultReason, 'Insufficient available cash');
  assert.equal(obligation.dueAt, at);
  assert.deepEqual(room.game.players.map(player => player.cash), [1500, 1500, 1500]);
  room.game.auction = null;
  assert.equal(processScheduledPayments(room, Date.parse(at) + 1000), false);
  assert.equal(obligation.status, 'defaulted', 'Raising money does not create an unapproved automatic retry');
  assert.throws(() => handleContract(room, 'b', { type: 'contract:pay', contractId: contract.id, obligationId: obligation.id }), /Only the debtor/);
  handleContract(room, 'a', { type: 'contract:pay', contractId: contract.id, obligationId: obligation.id });
  assert.equal(obligation.status, 'completed');
  assert.equal(room.game.players[0].cash, 1400);
});

test('scheduled agreements do not displace mandatory debt and terminate when a party is bankrupt', () => {
  const room = contractRoom();
  const at = new Date(Date.now() + 60000).toISOString();
  const contract = signTerms(room, { obligations: [{ debtorId: 'a', creditorId: 'b', amount: 25, trigger: { type: 'atTime', at } }] });
  room.game.players[2].cash = 5;
  chargePlayer(room.game, 'c', null, 100, 'Mandatory fee');
  const debt = structuredClone(room.game.debt);
  processScheduledPayments(room, Date.parse(at));
  assert.equal(contract.obligations[0].status, 'defaulted');
  assert.equal(contract.obligations[0].defaultReason, 'Game debt must be resolved first');
  assert.deepEqual(room.game.debt, debt);
  const bankruptRoom = contractRoom();
  const terminated = signTerms(bankruptRoom, { obligations: [{ debtorId: 'a', creditorId: 'b', amount: 25, trigger: { type: 'atTime', at } }] });
  bankruptRoom.game.players[1].bankrupt = true;
  processScheduledPayments(bankruptRoom, Date.parse(at));
  assert.equal(terminated.obligations[0].status, 'terminated');
  assert.equal(terminated.status, 'completed');
});

test('the last signature revalidates a deadline and rolls back when the proposal expired while waiting', async t => {
  const f = await fixture(t);
  await f.start();
  const [a, b] = f.users.map(user => user.playerId);
  const contract = await propose(f, { obligations: [{ debtorId: a, creditorId: b, amount: 40, trigger: { type: 'atTime', at: new Date(Date.now() + 60000).toISOString() } }] });
  await f.success(0, { type: 'contract:sign', contractId: contract.id, revision: 1 });
  f.server.store.transaction(data => { data.rooms[f.code].contracts[0].terms.obligations[0].trigger.at = '2000-01-01T00:00:00Z'; });
  const before = structuredClone(f.server.store.data.rooms[f.code]);
  const failed = await f.action(1, { type: 'contract:sign', contractId: contract.id, revision: 1 });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /future/);
  assert.deepEqual(f.server.store.data.rooms[f.code], before);
});

test('server clock timer pays and broadcasts without either player taking an action', async t => {
  const f = await fixture(t);
  await f.start();
  const [a, b] = f.users.map(user => user.playerId);
  const contract = await propose(f, { obligations: [{ debtorId: a, creditorId: b, amount: 35, trigger: { type: 'atTime', at: new Date(Date.now() + 350).toISOString() } }] });
  const signed = await bothSign(f, contract);
  const paid = await stateWhen(f.users[1].socket, room => room.contracts[0].obligations[0]?.status === 'completed');
  assert.deepEqual(paid.game.players.map(player => player.cash), [1465, 1535]);
  assert.ok(paid.version > signed.version);
  assert.equal(paid.contracts[0].obligations[0].paidCount, 1);
});

test('scheduled clock money waits for the shared roll to finish before changing cash', async t => {
  const f = await fixture(t, 2, { presentationTiming: { rollMs: 600, stepMs: 20, settleMs: 30, cardPauseMs: 20 } });
  await f.start();
  const [a, b] = f.users.map(user => user.playerId);
  const at = new Date(Date.now() + 350).toISOString();
  const contract = await propose(f, { obligations: [{ debtorId: a, creditorId: b, amount: 50, trigger: { type: 'atTime', at } }] });
  await bothSign(f, contract);
  f.server.store.transaction(data => { data.rooms[f.code].game.players[0].position = 0; });
  const paidUpdate = stateWhen(f.users[1].socket, room => room.contracts[0].status === 'completed');
  const rolling = await f.success(0, { type: 'roll' });
  assert.ok(rolling.presentation.endsAt > Date.parse(at));
  await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(at) - Date.now() + 25)));
  const interim = await f.success(1, { type: 'chat:send', text: 'Payment waits for movement' });
  assert.equal(interim.contracts[0].obligations[0].status, 'pending');
  const paid = await paidUpdate;
  assert.equal(paid.presentation, null);
  assert.ok(Date.parse(paid.contracts[0].obligations[0].lastPaidAt) >= rolling.presentation.endsAt);
  assert.equal(paid.game.players.find(player => player.id === b).cash, rolling.game.players.find(player => player.id === b).cash + 50);
});

test('restart recovers an overdue durable payment once, then subsequent restarts preserve the paid status', async t => {
  const f = await fixture(t);
  await f.start();
  const [a, b] = f.users.map(user => user.playerId);
  const contract = await propose(f, { obligations: [{ debtorId: a, creditorId: b, amount: 80, trigger: { type: 'atTime', at: new Date(Date.now() + 60000).toISOString() } }] });
  await bothSign(f, contract);
  f.server.store.transaction(data => { data.rooms[f.code].contracts[0].obligations[0].trigger.at = '2000-01-01T00:00:00.000Z'; });
  await f.server.close();
  const restarted = createApp({ storePath: f.storePath });
  const restored = restarted.store.data.rooms[f.code];
  assert.deepEqual(restored.game.players.map(player => player.cash), [1420, 1580]);
  assert.equal(restored.contracts[0].obligations[0].paidCount, 1);
  await restarted.close();
  const again = createApp({ storePath: f.storePath });
  t.after(() => again.close());
  assert.deepEqual(again.store.data.rooms[f.code].game.players.map(player => player.cash), [1420, 1580]);
  assert.equal(again.store.data.rooms[f.code].game.log.filter(event => event.type === 'contractPayment').length, 1);
});

test('cash loan metadata locks one principal disbursement and one fixed-interest repayment', () => {
  const room = contractRoom();
  const contract = signTerms(room, {
    transfers: [{ fromPlayerId: 'a', toPlayerId: 'b', cash: 101 }],
    obligations: [{ debtorId: 'b', creditorId: 'a', amount: 107, trigger: { type: 'afterTurns', turns: 2 } }],
    finance: { kind: 'loan', payerId: 'b', payeeId: 'a', principal: 101, interestBps: 500, obligationIndex: 0 },
  });
  assert.deepEqual(room.game.players.map(player => player.cash), [1399, 1601, 1500]);
  assert.equal(contract.terms.finance.interest, 6, 'Fixed interest rounds to a whole dollar once');
  assert.equal(contract.terms.finance.totalOwed, 107);
  assert.equal(contract.obligations[0].amount, 107);
  const event = recordEvent(room.game, 'turn', { playerId: 'b' });
  event.turn = contract.signedTurn + 2;
  processContractEvents(room, [event]);
  processContractEvents(room, [event]);
  assert.equal(contract.obligations[0].paidCount, 1);
  assert.deepEqual(room.game.players.map(player => player.cash), [1506, 1494, 1500]);
});

test('deferred property financing transfers the deed, preserves a downpayment and binds the unpaid price', () => {
  const room = contractRoom();
  room.game.properties[1].ownerId = 'a';
  const contract = signTerms(room, {
    transfers: [{ fromPlayerId: 'a', toPlayerId: 'b', propertyIds: [1] }, { fromPlayerId: 'b', toPlayerId: 'a', cash: 25 }],
    obligations: [{ debtorId: 'b', creditorId: 'a', amount: 55, trigger: { type: 'manual', condition: 'Both agree the agreed due date has arrived' } }],
    finance: { kind: 'deferred', payerId: 'b', payeeId: 'a', principal: 50, interestBps: 1000, obligationIndex: 0 },
  });
  assert.equal(room.game.properties[1].ownerId, 'b');
  assert.deepEqual(room.game.players.map(player => player.cash), [1525, 1475, 1500]);
  assert.deepEqual(contract.terms.finance.propertyIds, [1]);
  assert.equal(contract.terms.finance.totalOwed, 55);
  room.game.players[1].cash = 0;
  const obligation = contract.obligations[0];
  for (const id of ['a', 'b']) handleContract(room, id, { type: 'contract:confirm', contractId: contract.id, obligationId: obligation.id });
  assert.equal(obligation.status, 'defaulted');
  assert.equal(room.game.properties[1].ownerId, 'b', 'The agreed terms do not silently repossess the deed');
});

test('finance rejects false principal, mismatched interest, repetition, unbound deeds and stranger identities', () => {
  const base = {
    transfers: [{ fromPlayerId: 'a', toPlayerId: 'b', cash: 100 }],
    obligations: [{ debtorId: 'b', creditorId: 'a', amount: 110, trigger: { type: 'afterTurns', turns: 1 } }],
    finance: { kind: 'loan', payerId: 'b', payeeId: 'a', principal: 100, interestBps: 1000, obligationIndex: 0 },
  };
  for (const update of [
    { principal: 99 }, { interestBps: 1001 }, { interestBps: -1 }, { interestBps: 10001 },
    { totalOwed: 999 }, { interest: 999 }, { obligationIndex: 1 }, { payerId: 'c' }, { kind: 'deferred' },
  ]) assert.throws(() => signTerms(contractRoom(), { ...base, finance: { ...base.finance, ...update } }));
  assert.throws(() => signTerms(contractRoom(), { ...base, obligations: [{ ...base.obligations[0], repeat: true }] }), /one matching/);
  assert.throws(() => signTerms(contractRoom(), { ...base, transfers: [base.transfers[0], { fromPlayerId: 'b', toPlayerId: 'a', cash: 1 }] }), /net principal/);
});

test('zero-interest loans repay only principal and repeated game events are idempotent for repeating agreements', () => {
  const room = contractRoom();
  const zero = signTerms(room, {
    transfers: [{ fromPlayerId: 'a', toPlayerId: 'b', cash: 100 }],
    obligations: [{ debtorId: 'b', creditorId: 'a', amount: 100, trigger: { type: 'passGo' } }],
    finance: { kind: 'loan', payerId: 'b', payeeId: 'a', principal: 100, interestBps: 0, obligationIndex: 0 },
  });
  assert.equal(zero.terms.finance.interest, 0);
  const repeating = signTerms(room, { obligations: [{ debtorId: 'a', creditorId: 'b', amount: 5, trigger: { type: 'passGo' }, repeat: true, maxOccurrences: 3 }] });
  const event = recordEvent(room.game, 'passGo', { playerId: 'a' });
  processContractEvents(room, [event]);
  processContractEvents(room, [event]);
  assert.equal(repeating.obligations[0].paidCount, 1);
  processContractEvents(room, [recordEvent(room.game, 'passGo', { playerId: 'a' })]);
  assert.equal(repeating.obligations[0].paidCount, 2);
});
