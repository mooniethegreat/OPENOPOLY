import { availableCash, recordEvent, settleDebt } from '../shared/engine.js';
import { assert, integer, text, gamePlayer, onlyFields } from './validation.js';

export function sendMoney(room, actorId, action) {
  onlyFields(action, ['type', 'toPlayerId', 'amount', 'note']);
  const from = gamePlayer(room, actorId);
  const to = gamePlayer(room, action.toPlayerId);
  assert(from.id !== to.id, 'Choose another player to receive money');
  const amount = integer(action.amount, 'Amount', 1);
  const note = text(action.note ?? '', 'Transfer note', 0, 140);
  assert(room.game.debt?.playerId !== actorId, 'Resolve your mandatory game debt before sending money');
  assert(availableCash(room.game, actorId) >= amount, 'Insufficient available cash; auction bids remain reserved');
  from.cash -= amount;
  to.cash += amount;
  recordEvent(room.game, 'moneyTransfer', {
    playerId: actorId, fromPlayerId: actorId, toPlayerId: to.id, amount, note,
  }, `${from.name} sends ${to.name} $${amount}${note ? `: ${note}` : '.'}`);
  // Rescue is resolved without charging the donor through the debt effect queue.
  // The caller processes any resulting movement/GO/landing contract events once.
  if (room.game.debt?.playerId === to.id) settleDebt(room.game);
}
