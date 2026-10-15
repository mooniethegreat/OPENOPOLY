import { randomUUID } from 'node:crypto';
import { isPresentationActive } from '../shared/presentation.js';

export const TURN_TIMEOUT_MS = 30000;

export function timedTurnContext(room, { at = Date.now(), connectedActive = false } = {}) {
  const game = room.game;
  if (!connectedActive || room.status !== 'playing' || game?.status !== 'playing' ||
    !['roll', 'end'].includes(game.phase) || isPresentationActive(room.presentation, at) ||
    game.debt || game.auction || game.pendingMortgage || game.pendingPurchase != null) return null;
  const player = game.players.find(player => player.id === game.currentPlayerId);
  return player && !player.bankrupt ? { playerId: player.id, turn: game.turn, phase: game.phase } : null;
}

function matches(timer, context) {
  return Boolean(timer && context && typeof timer.id === 'string' &&
    Number.isFinite(timer.startedAt) && Number.isFinite(timer.endsAt) && timer.endsAt > timer.startedAt &&
    timer.playerId === context.playerId && timer.turn === context.turn && timer.phase === context.phase);
}

/** Change only clock metadata. Financial decisions keep their own version. */
export function reconcileTurnTimer(room, { at = Date.now(), connectedActive = false, durationMs = TURN_TIMEOUT_MS, restartEnd = false, forceRestart = false } = {}) {
  const context = timedTurnContext(room, { at, connectedActive });
  if (!context) {
    if (!room.turnTimer) return false;
    room.turnTimer = null; return true;
  }
  if (!forceRestart && !(restartEnd && context.phase === 'end') && matches(room.turnTimer, context)) {
    if (room.turnTimer.decisionVersion === (room.decisionVersion ?? 0)) return false;
    room.turnTimer = { ...room.turnTimer, decisionVersion: room.decisionVersion ?? 0 }; return true;
  }
  room.turnTimer = { id: randomUUID(), ...context, startedAt: at, endsAt: at + durationMs, decisionVersion: room.decisionVersion ?? 0 };
  return true;
}

export function isTurnTimerDue(room, { at = Date.now(), connectedActive = false } = {}) {
  return matches(room.turnTimer, timedTurnContext(room, { at, connectedActive })) &&
    room.turnTimer.decisionVersion === (room.decisionVersion ?? 0) && room.turnTimer.endsAt <= at;
}
