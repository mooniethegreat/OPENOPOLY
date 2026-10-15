// Absolute server times let every viewer (including reconnects) seek the same roll.
export const PRESENTATION_TIMING = Object.freeze({
  rollMs: 1500, stepMs: 140, directMs: 450, cardPauseMs: 450,
  settleMs: 220, maxMoveMs: 4000, maxTotalMs: 10000,
});

export function isPresentationActive(presentation, at = Date.now()) {
  return Boolean(presentation && Number.isFinite(presentation.endsAt) && presentation.endsAt > at);
}

export function movementPath(from, to, { back = false, steps, direct = false } = {}) {
  if (!Number.isInteger(from) || from < -1 || from > 39 || !Number.isInteger(to) || to < 0 || to > 39) return [];
  if (direct) return [to];
  const direction = back || steps < 0 ? -1 : 1;
  const count = Number.isInteger(steps)
    ? Math.min(80, Math.abs(steps))
    : from === -1 ? to + 1 : direction > 0 ? (to - from + 40) % 40 : (from - to + 40) % 40;
  return Array.from({ length: count }, (_, index) => ((from + direction * (index + 1)) % 40 + 40) % 40);
}

export function createPresentation(events, { id, startedAt = Date.now(), timing = PRESENTATION_TIMING } = {}) {
  const roll = events.find(event => event.type === 'roll');
  const movement = events.filter(event => event.type === 'move' || event.type === 'jail');
  if (!roll && !movement.length) return null;
  const config = { ...PRESENTATION_TIMING, ...timing };
  const rollDuration = roll ? config.rollMs : 0;
  const planned = movement.map((event, index) => {
    const direct = event.type === 'jail' || event.direct === true;
    const path = Array.isArray(event.path) ? [...event.path] : movementPath(event.from, event.to ?? 10, { back: event.back, steps: event.steps, direct });
    return {
      playerId: event.playerId, from: event.from, to: event.to ?? 10, path, direct,
      pause: index > 0 && !direct ? config.cardPauseMs : 0,
      duration: direct ? config.directMs : Math.min(config.maxMoveMs, path.length * config.stepMs),
    };
  });
  const requested = planned.reduce((sum, move) => sum + move.pause + move.duration, 0);
  const budget = Math.max(0, config.maxTotalMs - rollDuration - config.settleMs);
  const scale = requested > budget && requested ? budget / requested : 1;
  const rollEndsAt = startedAt + rollDuration;
  let cursor = rollEndsAt;
  const moves = planned.map(({ pause, duration, ...move }) => {
    cursor += Math.floor(pause * scale);
    const moveStart = cursor;
    cursor += Math.floor(duration * scale);
    return { ...move, startedAt: moveStart, endsAt: cursor };
  });
  return {
    id: id ?? `presentation-${startedAt}-${events[0]?.seq ?? 0}`,
    playerId: roll?.playerId ?? moves[0].playerId,
    startedAt, rollEndsAt, endsAt: cursor + config.settleMs,
    dice: roll ? [...roll.dice] : null, moves,
    // Only public rule events are accepted here. Never pass a private game object.
    events: structuredClone(events),
  };
}
