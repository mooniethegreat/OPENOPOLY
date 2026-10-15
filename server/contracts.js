import { randomUUID } from 'node:crypto';
import { availableCash, transferProperty, recordEvent, settleDebt } from '../shared/engine.js';
import { assert, integer, text, gamePlayer, onlyFields } from './validation.js';

const now = () => new Date().toISOString();
export const MAX_SCHEDULE_AHEAD_MS = 30 * 24 * 60 * 60 * 1000;
const array = (value, label, max = 20) => {
  assert(Array.isArray(value) && value.length <= max, `${label} must contain at most ${max} items`);
  return value;
};

function scheduledAt(value, currentTime = Date.now()) {
  assert(typeof value === 'string', 'Scheduled payment needs an ISO time with a timezone');
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/i.exec(value);
  assert(parts, 'Scheduled payment needs an ISO time with a timezone');
  const [, year, month, day, hour, minute, second = '0', zone] = parts;
  const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const validCalendar = calendar.getUTCFullYear() === Number(year) && calendar.getUTCMonth() === Number(month) - 1 && calendar.getUTCDate() === Number(day);
  const validZone = zone.toUpperCase() === 'Z' || (Number(zone.slice(1, 3)) <= 23 && Number(zone.slice(4, 6)) <= 59);
  const at = Date.parse(value);
  assert(validCalendar && Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59 && validZone && Number.isFinite(at), 'Choose a valid scheduled payment time');
  assert(at > currentTime, 'Scheduled payment must be in the future');
  assert(at <= currentTime + MAX_SCHEDULE_AHEAD_MS, 'Scheduled payment must be within 30 days');
  return new Date(at).toISOString();
}

function normalizeFinance(parties, input, transfers, obligations) {
  if (input == null) return null;
  onlyFields(input, ['kind', 'payerId', 'payeeId', 'principal', 'interestBps', 'obligationIndex', 'interest', 'totalOwed', 'propertyIds'], 'Financing');
  assert(['loan', 'deferred'].includes(input.kind), 'Choose a supported financing kind');
  const { payerId, payeeId } = input;
  assert(payerId !== payeeId && parties.includes(payerId) && parties.includes(payeeId), 'Financing must be between the contract parties');
  const principal = integer(input.principal, 'Financed principal', 1);
  const interestBps = integer(input.interestBps ?? 0, 'Interest basis points', 0, 10000);
  const interest = Math.ceil(principal * interestBps / 10000);
  const totalOwed = integer(principal + interest, 'Total repayment', 1);
  const obligationIndex = integer(input.obligationIndex, 'Repayment obligation', 0, obligations.length - 1);
  const repayment = obligations[obligationIndex];
  assert(repayment && repayment.debtorId === payerId && repayment.creditorId === payeeId && repayment.amount === totalOwed && !repayment.repeat, 'Financing requires one matching repayment of principal plus fixed interest');
  const toPayer = transfers.find(transfer => transfer.fromPlayerId === payeeId && transfer.toPlayerId === payerId);
  const fromPayer = transfers.find(transfer => transfer.fromPlayerId === payerId && transfer.toPlayerId === payeeId);
  const propertyIds = input.kind === 'deferred' ? [...(toPayer?.propertyIds ?? [])] : [];
  if (input.kind === 'loan') {
    assert((toPayer?.cash ?? 0) - (fromPayer?.cash ?? 0) === principal, 'A cash loan must transfer its full net principal to the borrower');
  } else assert(propertyIds.length, 'Deferred property financing must transfer a deed from seller to buyer');
  assert(input.interest === undefined || input.interest === interest, 'Financing interest does not match the agreed rate');
  assert(input.totalOwed === undefined || input.totalOwed === totalOwed, 'Financing total does not match principal plus interest');
  if (input.propertyIds !== undefined) {
    assert(Array.isArray(input.propertyIds) && input.propertyIds.length === propertyIds.length && propertyIds.every(id => input.propertyIds.includes(id)), 'Financed properties must match the deed transfers');
  }
  return { kind: input.kind, payerId, payeeId, principal, interestBps, interest, totalOwed, obligationIndex, propertyIds };
}

function normalizeTerms(room, parties, input) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 'Contract terms are required');
  const validateParties = (from, to) => {
    assert(from !== to && parties.includes(from) && parties.includes(to), 'Transfers must be between the two contract parties');
  };
  const transfers = array(input.transfers ?? [], 'Transfers', 2).map(transfer => {
    validateParties(transfer.fromPlayerId, transfer.toPlayerId);
    const propertyIds = array(transfer.propertyIds ?? [], 'Properties', 28).map(id => integer(id, 'Property', 0, 39));
    assert(new Set(propertyIds).size === propertyIds.length, 'A property cannot be included twice');
    const liftMortgagePropertyIds = array(transfer.liftMortgagePropertyIds ?? [], 'Mortgage redemptions', 28).map(id => integer(id, 'Mortgage property', 0, 39));
    assert(new Set(liftMortgagePropertyIds).size === liftMortgagePropertyIds.length && liftMortgagePropertyIds.every(id => propertyIds.includes(id)), 'Only transferred properties may have their mortgages redeemed');
    const jailCards = array(transfer.jailCards ?? [], 'Jail cards', 2);
    assert(jailCards.every(deck => deck === 'chance' || deck === 'chest'), 'Unknown jail card');
    assert(new Set(jailCards).size === jailCards.length, 'A jail card cannot be included twice');
    return {
      fromPlayerId: transfer.fromPlayerId, toPlayerId: transfer.toPlayerId,
      cash: integer(transfer.cash ?? 0, 'Cash transfer'), propertyIds, liftMortgagePropertyIds, jailCards,
    };
  });
  assert(new Set(transfers.map(t => t.fromPlayerId)).size === transfers.length, 'Use one transfer per party');
  assert(new Set(transfers.flatMap(t => t.propertyIds)).size === transfers.flatMap(t => t.propertyIds).length, 'Each property can appear once');
  const obligations = array(input.obligations ?? [], 'Future obligations', 10).map(obligation => {
    validateParties(obligation.debtorId, obligation.creditorId);
    const trigger = obligation.trigger;
    assert(trigger && ['afterTurns', 'passGo', 'landOn', 'manual', 'atTime'].includes(trigger.type), 'Choose a supported payment condition');
    const normalizedTrigger = { type: trigger.type };
    if (trigger.type === 'afterTurns') normalizedTrigger.turns = integer(trigger.turns, 'Turns until payment', 1, 200);
    if (trigger.type === 'landOn') {
      normalizedTrigger.propertyId = integer(trigger.propertyId, 'Landing space', 0, 39);
    }
    if (trigger.type === 'manual') normalizedTrigger.condition = text(trigger.condition, 'Custom payment condition', 1, 1000);
    const repeat = obligation.repeat === true;
    if (trigger.type === 'atTime') {
      assert(!repeat, 'A scheduled clock payment can happen only once');
      normalizedTrigger.at = scheduledAt(trigger.at);
    }
    return {
      debtorId: obligation.debtorId, creditorId: obligation.creditorId,
      amount: integer(obligation.amount, 'Future payment', 1), trigger: normalizedTrigger,
      repeat, maxOccurrences: repeat ? integer(obligation.maxOccurrences ?? 10, 'Maximum payments', 1, 100) : 1,
    };
  });
  const customTerms = text(input.customTerms ?? '', 'Additional terms', 0, 4000);
  assert(transfers.some(t => t.cash || t.propertyIds.length || t.jailCards.length) || obligations.length || customTerms, 'Add a transfer, payment condition, or written term');
  // A proposal may be opened at any time, but only active game players can sign.
  for (const id of parties) gamePlayer(room, id);
  const finance = normalizeFinance(parties, input.finance, transfers, obligations);
  return { transfers, obligations, customTerms, ...(finance ? { finance } : {}) };
}

function contractParty(room, actorId, contractId) {
  const contract = room.contracts.find(c => c.id === contractId);
  assert(contract, 'Contract not found');
  assert(contract.partyIds.includes(actorId), 'Only the contract parties may change it');
  return contract;
}

function log(contract, type, data = {}) {
  contract.events.push({ id: randomUUID(), type, at: now(), ...data });
}

function executeImmediate(room, contract) {
  const game = room.game;
  // Waiting to sign cannot turn a past deadline into an immediate surprise debit.
  for (const obligation of contract.terms.obligations) {
    if (obligation.trigger.type === 'atTime') scheduledAt(obligation.trigger.at);
  }
  const indebtedPlayer = game.debt ? gamePlayer(room, game.debt.playerId) : null;
  const cashBefore = indebtedPlayer?.cash;
  for (const partyId of contract.partyIds) gamePlayer(room, partyId);
  // Cash exchanges are netted atomically, allowing mutually dependent exchanges.
  const deltas = Object.fromEntries(contract.partyIds.map(id => [id, 0]));
  for (const transfer of contract.terms.transfers) {
    deltas[transfer.fromPlayerId] -= transfer.cash;
    deltas[transfer.toPlayerId] += transfer.cash;
    for (const deck of transfer.jailCards) {
      assert(gamePlayer(room, transfer.fromPlayerId).jailCards.includes(deck), 'A promised jail card is no longer owned');
    }
  }
  for (const [id, delta] of Object.entries(deltas)) {
    assert(availableCash(game, id) + delta >= 0, 'A party has insufficient available cash for this contract');
  }
  for (const [id, delta] of Object.entries(deltas)) gamePlayer(room, id).cash += delta;
  for (const transfer of contract.terms.transfers) {
    for (const id of transfer.propertyIds) transferProperty(game, transfer.fromPlayerId, transfer.toPlayerId, id, { liftMortgage: (transfer.liftMortgagePropertyIds ?? []).includes(id) });
    for (const deck of transfer.jailCards) {
      const from = gamePlayer(room, transfer.fromPlayerId);
      const to = gamePlayer(room, transfer.toPlayerId);
      from.jailCards.splice(from.jailCards.indexOf(deck), 1);
      to.jailCards.push(deck);
    }
  }
  if (indebtedPlayer) {
    assert(indebtedPlayer.cash >= cashBefore, 'A player resolving game debt cannot reduce their cash through a contract');
    settleDebt(game);
  }
  const activation = recordEvent(game, 'contract', { contractId: contract.id, partyIds: contract.partyIds }, `Contract signed: ${contract.title}`);
  contract.activationSeq = activation.seq;
  contract.executedAt = now();
  contract.signedTurn = game.turn;
  contract.obligations = contract.terms.obligations.map(obligation => ({
    ...structuredClone(obligation), id: randomUUID(), status: 'pending', paidCount: 0,
    nextDueTurn: obligation.trigger.type === 'afterTurns' ? game.turn + obligation.trigger.turns : null,
    confirmations: [], events: [], lastEventSeq: activation.seq,
  }));
  contract.status = contract.obligations.length ? 'active' : 'completed';
  log(contract, 'executed');
}

function settle(room, contract, obligation, reason, triggerTurn = room.game.turn, currentTime = Date.now()) {
  const at = new Date(currentTime).toISOString();
  const debtor = room.game.players.find(p => p.id === obligation.debtorId);
  const creditor = room.game.players.find(p => p.id === obligation.creditorId);
  if (!debtor || !creditor || debtor.bankrupt || creditor.bankrupt) {
    obligation.status = 'terminated';
    obligation.events.push({ type: 'terminated', reason: 'A contract party is bankrupt', at });
    return;
  }
  // Contract defaults do not replace the core rules engine's mandatory debt flow.
  if (room.game.debt || availableCash(room.game, debtor.id) < obligation.amount) {
    obligation.status = 'defaulted';
    obligation.defaultReason = room.game.debt ? 'Game debt must be resolved first' : 'Insufficient available cash';
    obligation.dueAt = obligation.trigger.type === 'atTime' ? obligation.trigger.at : at;
    obligation.events.push({ type: 'defaulted', reason: obligation.defaultReason, at });
    log(contract, 'defaulted', { obligationId: obligation.id, amount: obligation.amount });
    return;
  }
  debtor.cash -= obligation.amount;
  creditor.cash += obligation.amount;
  obligation.paidCount += 1;
  obligation.lastPaidAt = at;
  obligation.defaultReason = null;
  obligation.confirmations = [];
  obligation.events.push({ type: 'paid', amount: obligation.amount, at, reason });
  recordEvent(room.game, 'contractPayment', {
    playerId: debtor.id, fromPlayerId: debtor.id, toPlayerId: creditor.id,
    amount: obligation.amount, contractId: contract.id, obligationId: obligation.id,
  }, `${debtor.name} paid $${obligation.amount} under “${contract.title}”`);
  obligation.status = obligation.paidCount >= obligation.maxOccurrences ? 'completed' : 'pending';
  if (obligation.status === 'pending' && obligation.trigger.type === 'afterTurns') {
    obligation.nextDueTurn = triggerTurn + obligation.trigger.turns;
  }
  log(contract, 'payment', { obligationId: obligation.id, amount: obligation.amount });
}

function updateCompletion(contract) {
  if (contract.obligations.every(o => o.status === 'completed' || o.status === 'terminated')) {
    contract.status = 'completed';
    contract.completedAt = now();
  }
}

export function handleContract(room, actorId, action) {
  if (action.type === 'contract:propose') {
    assert(room.contracts.filter(c => c.status === 'proposed' || c.status === 'active').length < 100, 'There are already 100 open contracts');
    assert(actorId !== action.counterpartyId, 'Choose another player');
    const partyIds = [actorId, action.counterpartyId];
    const terms = normalizeTerms(room, partyIds, action.terms);
    room.contracts.unshift({
      id: randomUUID(), proposerId: actorId, partyIds, title: text(action.title ?? 'Player agreement', 'Contract title', 1, 100),
      terms, revision: 1, signatures: [], obligations: [], events: [], status: 'proposed', createdAt: now(),
    });
    return;
  }
  const contract = contractParty(room, actorId, action.contractId);
  if (action.type === 'contract:confirm' || action.type === 'contract:pay') {
    assert(contract.status === 'active', 'This contract has no active obligations');
    gamePlayer(room, actorId);
    const obligation = contract.obligations.find(o => o.id === action.obligationId);
    assert(obligation, 'Obligation not found');
    if (action.type === 'contract:pay') {
      assert(obligation.debtorId === actorId, 'Only the debtor can settle this payment');
      assert(obligation.status === 'defaulted', 'This payment has not defaulted');
      assert(!room.game.debt && availableCash(room.game, actorId) >= obligation.amount, 'Insufficient available cash or unresolved game debt');
      settle(room, contract, obligation, 'Manual settlement of overdue payment');
    } else {
      assert(obligation.trigger.type === 'manual' && obligation.status === 'pending', 'This condition cannot be confirmed');
      assert(!obligation.confirmations.includes(actorId), 'You already confirmed this condition');
      obligation.confirmations.push(actorId);
      obligation.events.push({ type: 'confirmed', playerId: actorId, at: now() });
      if (contract.partyIds.every(id => obligation.confirmations.includes(id))) settle(room, contract, obligation, 'Both parties confirmed the custom condition');
    }
    updateCompletion(contract);
    return;
  }
  assert(contract.status === 'proposed', 'A signed or closed contract cannot be edited');
  if (action.type === 'contract:cancel' || action.type === 'contract:reject') {
    assert(action.type !== 'contract:cancel' || contract.proposerId === actorId, 'Only the proposer can cancel this contract');
    contract.status = action.type === 'contract:cancel' ? 'cancelled' : 'rejected';
    log(contract, contract.status, { playerId: actorId });
    return;
  }
  assert(action.revision === contract.revision, 'Contract changed. Review the current terms before signing');
  if (action.type === 'contract:revise') {
    contract.terms = normalizeTerms(room, contract.partyIds, action.terms);
    contract.title = text(action.title ?? contract.title, 'Contract title', 1, 100);
    contract.revision += 1;
    contract.signatures = [];
    log(contract, 'revised', { playerId: actorId, revision: contract.revision });
    return;
  }
  assert(action.type === 'contract:sign', 'Unknown contract action');
  gamePlayer(room, actorId);
  assert(!contract.signatures.some(s => s.playerId === actorId), 'You already signed these terms');
  contract.signatures.push({ playerId: actorId, signedAt: now(), revision: contract.revision });
  log(contract, 'signed', { playerId: actorId, revision: contract.revision });
  if (contract.signatures.length === 2) executeImmediate(room, contract);
}

export function processContractEvents(room, events) {
  if (!room.game) return;
  for (const contract of room.contracts.filter(c => c.status === 'active')) {
    for (const obligation of contract.obligations) {
      const partyBankrupt = contract.partyIds.some(id => room.game.players.find(p => p.id === id)?.bankrupt);
      if (partyBankrupt && ['pending', 'defaulted'].includes(obligation.status)) {
        obligation.status = 'terminated';
        obligation.events.push({ type: 'terminated', reason: 'A contract party is bankrupt', at: now() });
        continue;
      }
      // A default suspends additional occurrences until the amount is settled.
      if (obligation.status !== 'pending') continue;
      for (const event of events) {
        if (obligation.status !== 'pending') break;
        if (event.seq <= Math.max(contract.activationSeq ?? 0, obligation.lastEventSeq ?? 0)) continue;
        obligation.lastEventSeq = event.seq;
        const trigger = obligation.trigger;
        const matched =
          (trigger.type === 'afterTurns' && ['turn', 'skipTurn'].includes(event.type) && event.turn >= obligation.nextDueTurn) ||
          (trigger.type === 'passGo' && event.type === 'passGo' && event.playerId === obligation.debtorId) ||
          (trigger.type === 'landOn' && event.type === 'land' && event.playerId === obligation.debtorId && event.propertyId === trigger.propertyId);
        if (matched) settle(room, contract, obligation, `${trigger.type} condition occurred`, event.turn);
      }
      obligation.lastEventSeq = Math.max(obligation.lastEventSeq ?? contract.activationSeq ?? 0, ...events.map(event => event.seq ?? 0));
    }
    updateCompletion(contract);
  }
}

export function nextScheduledPaymentAt(room) {
  let next = Infinity;
  if (room.status !== 'playing' || !room.game) return next;
  for (const contract of room.contracts) {
    if (contract.status !== 'active') continue;
    for (const obligation of contract.obligations) {
      if (obligation.status !== 'pending' || obligation.trigger.type !== 'atTime') continue;
      const at = Date.parse(obligation.trigger.at);
      if (Number.isFinite(at)) next = Math.min(next, at);
    }
  }
  return next;
}

export function processScheduledPayments(room, currentTime = Date.now()) {
  if (room.status !== 'playing' || !room.game) return false;
  let changed = false;
  for (const contract of room.contracts) {
    if (contract.status !== 'active') continue;
    let contractChanged = false;
    for (const obligation of contract.obligations) {
      const deadline = Date.parse(obligation.trigger.at);
      if (obligation.status !== 'pending' || obligation.trigger.type !== 'atTime' || !Number.isFinite(deadline) || deadline > currentTime) continue;
      settle(room, contract, obligation, 'Scheduled clock time reached', room.game.turn, currentTime);
      contractChanged = true;
    }
    if (contractChanged) { updateCompletion(contract); changed = true; }
  }
  return changed;
}
