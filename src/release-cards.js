const isInland = game => game?.edition === 'inland' || game === 'inland-empire';
export const releaseCardName = game => isInland(game) ? 'Leave Traffic Jam' : 'Get Out of Jail Free';
export const releaseCardSource = (deck, game) => deck === 'chance' ? isInland(game) ? 'Contingency' : 'Chance' : isInland(game) ? 'Big Fun' : 'Community Chest';

export function releaseCardStatus(game, playerId, { connected = true, pending = false, presenting = false } = {}) {
  const me = game?.players.find(player => player.id === playerId);
  if (!me?.jailCards?.length) return 'Cards you draw stay here until used or traded.';
  if (game.status !== 'playing' || me.bankrupt) return 'This game is complete.';
  if (!me.inJail) return `Keep this card until you are in ${isInland(game) ? 'Traffic Jam' : 'jail'}. Use it at the start of that turn, before rolling.`;
  if (game.currentPlayerId !== playerId) return 'Use this card at the start of your next turn, before rolling.';
  if (game.phase === 'end') return 'Your turn has ended. Use this card at the start of your next turn, before rolling.';
  if (game.phase !== 'roll' || !game.permittedActions?.[playerId]?.includes('useJailCard')) return 'Resolve the current table decision first. A release card is used before rolling on your turn.';
  if (presenting) return 'Wait for the shared dice and movement to finish.';
  if (!connected) return 'Reconnect to use this card. Your card is saved.';
  if (pending) return 'Wait for your pending action to finish before using this card.';
  return `Use this card now, before rolling. You leave ${isInland(game) ? 'Traffic Jam' : 'jail'} and still roll to move.`;
}
