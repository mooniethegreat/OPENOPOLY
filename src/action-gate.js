const ENGINE_ACTIONS = new Set(['roll', 'endTurn', 'buy', 'declinePurchase', 'auction', 'bid', 'passAuction', 'payJail', 'useJailCard', 'build', 'buildGroup', 'sellBuilding', 'sellGroupBuildings', 'mortgage', 'unmortgage', 'bankrupt', 'auctionBuilding', 'retainMortgage', 'redeemMortgage']);
const SENSITIVE_CONTRACTS = new Set(['contract:propose', 'contract:revise', 'contract:sign', 'contract:confirm', 'contract:pay']);

export const isDecisionAction = type => ENGINE_ACTIONS.has(type) || type?.startsWith('uno:') || type === 'money:send' || type === 'room:start' || SENSITIVE_CONTRACTS.has(type);
export const mayActDuringPresentation = type => type === 'chat:send' || type?.startsWith('vote:') || ['room:appearance', 'contract:cancel', 'contract:reject'].includes(type);
export const decisionContext = room => ({
  expectedDecisionVersion: room?.decisionVersion ?? 0,
  expectedTurn: room?.game?.turn ?? null,
  expectedCurrentPlayerId: room?.game?.currentPlayerId ?? null,
  expectedPhase: room?.game?.phase ?? null,
});
export function createCommandId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Bind a deliberate UI action to the decision the player actually saw. */
export function prepareCommand(payload, renderedRoom, currentRoom, playerId, { commandId, serverTime } = {}) {
  if (!currentRoom || currentRoom.code !== renderedRoom?.code) throw new Error('This room changed. Review the current table before acting.');
  if (currentRoom.actionProtocol !== 2) throw new Error('The game controls were updated. Refresh this page before acting.');
  const context = decisionContext(renderedRoom);
  if (isDecisionAction(payload.type)) {
    const latest = decisionContext(currentRoom);
    if (Object.keys(context).some(key => context[key] !== latest[key])) throw new Error('The table changed. Review the current decision and try again.');
  }
  if (!mayActDuringPresentation(payload.type) && currentRoom.presentation?.endsAt > serverTime) throw new Error('Wait for the shared dice and movement to finish.');
  if (ENGINE_ACTIONS.has(payload.type) && !currentRoom.game?.permittedActions?.[playerId]?.includes(payload.type)) throw new Error('That action is not available to you in the current game state.');
  if (payload.type?.startsWith('uno:') && !currentRoom.game?.permittedActions?.[playerId]?.includes(payload.type)) throw new Error('That card action is not available in the current game state.');
  if (['buy', 'auction', 'declinePurchase'].includes(payload.type) && payload.propertyId !== currentRoom.game?.pendingPurchase) throw new Error('That property decision has already changed. Review the current landing.');
  if (payload.type === 'room:start' && (currentRoom.status !== 'lobby' || currentRoom.hostId !== playerId || currentRoom.players.length < 2)) throw new Error('Only the host can start a lobby with at least two players.');
  return { ...structuredClone(payload), ...context, commandId };
}

/** One key press or double click cannot advance through two different controls. */
export function preventRepeatedActivation(event) {
  const button = event.target?.closest?.('button');
  if ((event.type === 'click' && button && event.detail > 1) || (event.type === 'keydown' && button && event.repeat && ['Enter', ' '].includes(event.key))) {
    event.preventDefault();
    event.stopPropagation();
  }
}
