import { getBoard } from '../shared/board.js';
import { spaceName } from './themes.js';

const amountIsValid = amount => Number.isSafeInteger(amount) && amount > 0;
const playerName = (room, id) => room.game?.players.find(player => player.id === id)?.name || room.players?.find(player => player.id === id)?.name || 'Player';
const propertyName = (room, id) => {
  const square = getBoard(room.game || room.theme).find(space => space.id === id);
  return square ? spaceName(square, room.theme) : 'property';
};

function contractCash(room, event) {
  const contract = room.contracts?.find(item => item.id === event.contractId);
  if (!contract || contract.activationSeq !== event.seq || !['active', 'completed'].includes(contract.status) || contract.partyIds?.length !== 2) return null;
  const [first, second] = contract.partyIds;
  let amount = 0;
  for (const transfer of contract.terms?.transfers || []) {
    if (!Number.isSafeInteger(transfer.cash) || transfer.cash < 0) return null;
    if (transfer.fromPlayerId === first && transfer.toPlayerId === second) amount += transfer.cash;
    else if (transfer.fromPlayerId === second && transfer.toPlayerId === first) amount -= transfer.cash;
    else return null;
  }
  if (!amount) return null;
  return { amount: Math.abs(amount), from: amount > 0 ? first : second, to: amount > 0 ? second : first, reason: `Contract: ${contract.title}` };
}

// Map only records of completed cash movement. Informational companions such as
// passGo, auction purchase/build, mortgage transfers and debt/default are omitted.
export function committedPayment(room, event) {
  if (!room || !event) return null;
  let payment;
  const pot = room.game?.rules?.freeParkingPot ? 'Center pot' : 'Bank';
  if (event.type === 'payment') payment = { amount: event.amount, from: event.fromPlayerId, to: event.toPlayerId, fromLabel: 'Bank', toLabel: event.intoCenterPot ? 'Center pot' : 'Bank', reason: event.reason || 'Payment' };
  else if (event.type === 'moneyTransfer') payment = { amount: event.amount, from: event.fromPlayerId, to: event.toPlayerId, reason: event.note || 'Direct payment' };
  else if (event.type === 'contractPayment') {
    const contract = room.contracts?.find(item => item.id === event.contractId);
    payment = { amount: event.amount, from: event.fromPlayerId, to: event.toPlayerId, reason: `Contract payment: ${contract?.title || 'Signed agreement'}` };
  } else if (event.type === 'contract') payment = contractCash(room, event);
  else if (event.type === 'purchase' && !event.auction) payment = { amount: event.amount, from: event.playerId, to: null, reason: `Purchase: ${propertyName(room, event.propertyId)}` };
  else if (event.type === 'build' && !event.auction && !event.groupBuildId) payment = { amount: event.amount, from: event.playerId, to: null, reason: `${event.houses === 5 ? 'Hotel' : 'Building'}: ${propertyName(room, event.propertyId)}` };
  else if (event.type === 'buildGroup') payment = { amount: event.amount, from: event.playerId, to: null, reason: `Group development: ${(event.propertyIds || []).map(id => propertyName(room, id)).join(', ') || 'color group'}` };
  else if (event.type === 'sellBuilding') payment = { amount: event.amount, from: null, to: event.playerId, reason: `Sold buildings: ${event.propertyId !== undefined ? propertyName(room, event.propertyId) : `${event.group || 'color'} group`}` };
  else if (event.type === 'mortgage') payment = { amount: event.amount, from: null, to: event.playerId, reason: `Mortgage: ${propertyName(room, event.propertyId)}` };
  else if (event.type === 'unmortgage') payment = { amount: event.amount, from: event.playerId, to: null, toLabel: pot, reason: `Lift mortgage: ${propertyName(room, event.propertyId)}` };
  else if (event.type === 'jackpot') payment = { amount: event.amount, from: null, to: event.playerId, fromLabel: 'Center pot', reason: 'Center pot collection' };
  if (!payment || !amountIsValid(payment.amount) || payment.from === payment.to) return null;
  return {
    ...payment, id: event.id, seq: event.seq,
    fromLabel: payment.from ? playerName(room, payment.from) : payment.fromLabel || 'Bank',
    toLabel: payment.to ? playerName(room, payment.to) : payment.toLabel || 'Bank',
  };
}

export function personalPayment(room, playerId, event) {
  const payment = committedPayment(room, event);
  if (!payment || payment.from !== playerId && payment.to !== playerId) return null;
  return { ...payment, direction: payment.to === playerId ? 'incoming' : 'outgoing' };
}

export function advancePaymentFeed(cursor, room, playerId) {
  if (!room?.code || !playerId) return { cursor: null, payments: [] };
  const scope = `${room.code}:${playerId}`;
  const events = (room.game?.log || []).filter(event => Number.isSafeInteger(event.seq) && event.seq > 0);
  const high = Math.max(0, ...events.map(event => event.seq));
  // First hydration establishes a baseline. It never celebrates saved history.
  if (cursor?.scope !== scope) return { cursor: { scope, seq: high }, payments: [] };
  if (high <= cursor.seq) return { cursor, payments: [] };
  const payments = events.filter(event => event.seq > cursor.seq).sort((a, b) => a.seq - b.seq).map(event => personalPayment(room, playerId, event)).filter(Boolean);
  return { cursor: { scope, seq: high }, payments };
}

function mergeGroup(first, second) {
  return {
    ...first, amount: first.amount + second.amount, count: first.count + second.count,
    items: [...first.items, ...second.items].slice(0, 3),
    parties: [...new Set([...first.parties, ...second.parties])],
  };
}

export function enqueuePayments(queue, payments, now = Date.now()) {
  const next = queue.slice();
  for (const payment of payments) {
    const group = { id: payment.id, direction: payment.direction, amount: payment.amount, count: 1, items: [payment], parties: [payment.direction === 'incoming' ? payment.fromLabel : payment.toLabel], createdAt: now };
    const tail = next.at(-1);
    // Batch an immediate burst without resetting the animation for each payment.
    if (tail?.direction === group.direction && (next.length > 1 || now - tail.createdAt < 600)) next[next.length - 1] = mergeGroup(tail, group);
    else next.push(group);
  }
  if (next.length <= 6) return next;
  // Keep the current notification, then condense waiting entries by direction.
  // Totals/counts remain exact while only three detail lines are retained.
  const waiting = [];
  for (const group of next.slice(1)) {
    const index = waiting.findIndex(item => item.direction === group.direction);
    if (index >= 0) waiting[index] = mergeGroup(waiting[index], group);
    else waiting.push(group);
  }
  return [next[0], ...waiting];
}
