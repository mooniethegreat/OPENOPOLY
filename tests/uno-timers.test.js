import test from 'node:test';
import assert from 'node:assert/strict';
import { createUnoGame } from '../shared/uno-engine.js';
import { TURN_TIMEOUT_MS, timedTurnContext, reconcileTurnTimer, isTurnTimerDue } from '../server/turn-timers.js';

function room() {
  const game = createUnoGame([{ id: 'a' }, { id: 'b' }], { seed: 99, dealerId: 'b' });
  game.phase = 'play'; game.currentPlayerId = 'a';
  return { gameType: 'uno', status: 'playing', decisionVersion: 1, game, turnTimer: null };
}

test('normal UNO turns default to 30 seconds, preserve running deadlines across calls and pause for mandatory choices', () => {
  const value = room();
  assert.equal(TURN_TIMEOUT_MS, 30000);
  assert.equal(reconcileTurnTimer(value, { at: 1000, connectedActive: true }), true);
  assert.equal(value.turnTimer.endsAt, 31000);
  assert.equal(isTurnTimerDue(value, { at: 30999, connectedActive: true }), false);
  assert.equal(isTurnTimerDue(value, { at: 31000, connectedActive: true }), true);
  const id = value.turnTimer.id;
  value.decisionVersion += 1;
  reconcileTurnTimer(value, { at: 2000, connectedActive: true });
  assert.equal(value.turnTimer.id, id, 'Calling or catching UNO does not restart an unchanged turn');
  assert.equal(value.turnTimer.endsAt, 31000);
  assert.equal(value.turnTimer.decisionVersion, 2);
  value.game.phase = 'drawn';
  reconcileTurnTimer(value, { at: 5000, connectedActive: true });
  assert.notEqual(value.turnTimer.id, id);
  assert.equal(value.turnTimer.endsAt, 35000);
  for (const phase of ['choose-color', 'draw-four', 'ohana', 'round-over', 'game-over']) {
    value.game.phase = phase;
    assert.equal(timedTurnContext(value, { connectedActive: true }), null);
    reconcileTurnTimer(value, { connectedActive: true });
    assert.equal(value.turnTimer, null);
  }
});

test('UNO absence pauses timers and resuming always gives a fresh full clock without replaying saved deadlines', () => {
  const value = room();
  reconcileTurnTimer(value, { at: 1000, connectedActive: true });
  assert.equal(isTurnTimerDue(value, { at: 50000, connectedActive: false }), false);
  reconcileTurnTimer(value, { at: 50000, connectedActive: false });
  assert.equal(value.turnTimer, null);
  reconcileTurnTimer(value, { at: 50000, connectedActive: true });
  assert.equal(value.turnTimer.startedAt, 50000);
  assert.equal(value.turnTimer.endsAt, 80000);
  value.status = 'finished';
  assert.equal(timedTurnContext(value, { connectedActive: true }), null);
  value.status = 'playing'; value.game.status = 'round-over';
  assert.equal(timedTurnContext(value, { connectedActive: true }), null);
});
