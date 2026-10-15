const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const validDice = dice => Array.isArray(dice) && dice.length === 2 && dice.every(value => Number.isInteger(value) && value >= 1 && value <= 6);

/** Network receipt is distinct from React render time, especially in background tabs. */
export function synchronizeClock(previous, snapshot, observedAt = Date.now()) {
  if (!Number.isFinite(snapshot?.serverNow) || previous?.stamp === snapshot.serverNow) return previous || { stamp: null, offset: 0 };
  const receivedAt = Number.isFinite(snapshot.clientReceivedAt) ? snapshot.clientReceivedAt : observedAt;
  const candidate = snapshot.serverNow - receivedAt;
  const fresh = !previous || previous.stamp === null || previous.roomCode !== snapshot.code || observedAt - previous.measuredAt > 300000;
  // The least delayed sample gives the closest estimate. A slow snapshot must not rewind animation.
  const better = fresh || candidate >= previous.offset;
  return { stamp: snapshot.serverNow, offset: better ? candidate : previous.offset, measuredAt: better ? observedAt : previous.measuredAt, roomCode: snapshot.code };
}

export function rebaseClockAfterJump(clock, previous, wallTime, monotonicTime) {
  const jump = (wallTime - previous.wall) - (monotonicTime - previous.monotonic);
  if (Math.abs(jump) < 1000) return clock;
  // Keep the same server instant now; the next new snapshot starts a fresh calibration.
  return { ...clock, offset: clock.offset - jump, measuredAt: 0 };
}

/** Sample a persisted server timeline. No dice or movement is invented by the client. */
export function samplePresentation(room, serverTime = Date.now(), reducedMotion = false) {
  const timeline = room?.presentation;
  const positions = Object.fromEntries((room?.game?.players || room?.players || []).map(player => [player.id, player.position ?? 0]));
  const active = Boolean(timeline && Number.isFinite(timeline.endsAt) && serverTime < timeline.endsAt);
  const startedAt = timeline?.startedAt || 0;
  const elapsed = timeline ? Math.max(0, serverTime - startedAt) : 0;
  const rollDuration = Math.max(0, (timeline?.rollEndsAt || startedAt) - startedAt);
  const dice = validDice(timeline?.dice) ? timeline.dice : validDice(room?.game?.dice) ? room.game.dice : [1, 1];
  const movements = {};

  if (active && !reducedMotion) {
    const groupedMoves = new Map();
    for (const move of timeline.moves || []) {
      const id = move.playerId || timeline.playerId;
      if (!id) continue;
      const moves = groupedMoves.get(id) || [];
      moves.push(move);
      groupedMoves.set(id, moves);
    }
    for (const [id, unsorted] of groupedMoves) {
      const moves = [...unsorted].sort((a, b) => a.startedAt - b.startedAt);
      positions[id] = moves[0].from;
      for (const move of moves) {
        if (serverTime < move.startedAt) break;
        if (serverTime >= move.endsAt) { positions[id] = move.to; continue; }
        const suppliedPath = (move.path || []).filter(Number.isFinite);
        const path = [move.from, ...suppliedPath];
        if (path.length === 1 || path.at(-1) !== move.to) path.push(move.to);
        const progress = clamp((serverTime - move.startedAt) / Math.max(1, move.endsAt - move.startedAt));
        const steps = path.length - 1;
        const cursor = Math.min(steps - 1, Math.floor(progress * steps));
        const stepProgress = clamp(progress * steps - cursor);
        const from = path[cursor], to = path[cursor + 1];
        positions[id] = from;
        movements[id] = {
          playerId: id, from, to, position: from, progress: stepProgress,
          overallProgress: progress, step: cursor + 1, steps, direct: Boolean(move.direct),
          hop: Math.sin(Math.PI * stepProgress), startedAt: move.startedAt, endsAt: move.endsAt,
        };
        break;
      }
    }
  }

  const rolling = active && !reducedMotion && validDice(timeline.dice) && serverTime < timeline.rollEndsAt;
  const moving = active && !reducedMotion && Object.keys(movements).length > 0;
  return {
    active, rolling, moving, elapsed, positions, movements,
    movement: movements[timeline?.playerId] || Object.values(movements)[0] || null,
    dice, presentation: timeline || null, playerId: timeline?.playerId || null,
    rollProgress: rollDuration ? clamp(elapsed / rollDuration) : 1,
    stage: rolling ? 'rolling' : moving ? 'moving' : active ? 'resolving' : 'idle',
    endAt: timeline?.endsAt || 0, serverTime, reducedMotion,
  };
}

/** Tile centers on the 960-unit board; kept shared by camera and token motion. */
export function boardPoint(index) {
  const size = 960, corner = 125, step = (size - corner * 2) / 9;
  const near = corner / 2, far = size - near;
  if (index < 0) return { x: 480, y: 652 };
  if (index === 0) return { x: far, y: far };
  if (index < 10) return { x: size - corner - (index - 0.5) * step, y: far };
  if (index === 10) return { x: near, y: far };
  if (index < 20) return { x: near, y: size - corner - (index - 10.5) * step };
  if (index === 20) return { x: near, y: near };
  if (index < 30) return { x: corner + (index - 20.5) * step, y: near };
  if (index === 30) return { x: far, y: near };
  return { x: far, y: corner + (index - 30.5) * step };
}

export function animatedBoardPoint(position, movement) {
  const from = boardPoint(movement?.from ?? position);
  if (!movement) return { ...from, lift: 0 };
  const to = boardPoint(movement.to);
  const t = movement.progress;
  // Each step slows briefly as the metal token touches a tile.
  const ease = t * t * (3 - 2 * t);
  return { x: from.x + (to.x - from.x) * ease, y: from.y + (to.y - from.y) * ease, lift: movement.hop * (movement.direct ? 82 : 22) };
}
