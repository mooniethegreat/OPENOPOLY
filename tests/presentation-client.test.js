import test from 'node:test';
import assert from 'node:assert/strict';
import { samplePresentation, boardPoint, animatedBoardPoint, synchronizeClock, rebaseClockAfterJump } from '../src/presentation-state.js';

function roomWith(moves, extra = {}) {
  return {
    game: { players: [{ id: 'a', position: moves.at(-1)?.to ?? 0 }, { id: 'b', position: 15 }], dice: [2, 3] },
    presentation: { id: 'roll-1', playerId: 'a', startedAt: 1000, rollEndsAt: 2500, endsAt: moves.at(-1)?.endsAt + 300 || 2800, dice: [2, 3], moves, ...extra },
  };
}
const move = (from, to, path, startedAt = 2500, endsAt = 2500 + path.length * 140, extra = {}) => ({ playerId: 'a', from, to, path, startedAt, endsAt, ...extra });

test('the resolved server position stays at the origin until the physical dice finish', () => {
  const room = roomWith([move(38, 3, [39, 0, 1, 2, 3])]);
  const frame = samplePresentation(room, 1800);
  assert.equal(room.game.players[0].position, 3);
  assert.equal(frame.positions.a, 38);
  assert.equal(frame.stage, 'rolling');
  assert.deepEqual(frame.dice, [2, 3]);
  assert.equal(frame.positions.b, 15);
});

test('a joining client samples the current step across GO without replaying earlier steps', () => {
  const room = roomWith([move(38, 3, [39, 0, 1, 2, 3])]);
  const frame = samplePresentation(room, 2850);
  assert.equal(frame.stage, 'moving');
  assert.equal(frame.positions.a, 0);
  assert.equal(frame.movement.from, 0);
  assert.equal(frame.movement.to, 1);
  assert.ok(Math.abs(frame.movement.progress - 0.5) < 1e-10);
  assert.equal(frame.movement.step, 3);
});

test('card pauses hold the first destination before an explicit backwards path begins', () => {
  const room = roomWith([
    move(4, 7, [5, 6, 7]),
    move(7, 4, [6, 5, 4], 3200, 3620),
  ]);
  const pause = samplePresentation(room, 3050);
  assert.equal(pause.positions.a, 7);
  assert.equal(pause.stage, 'resolving');
  assert.equal(pause.active, true);
  assert.equal(pause.movement, null);
  const backward = samplePresentation(room, 3410);
  assert.equal(backward.movement.from, 6);
  assert.equal(backward.movement.to, 5);
});

test('direct jail transfer crosses the center rather than visiting unrelated board spaces', () => {
  const room = roomWith([move(30, 10, [10], 2500, 3060, { direct: true })]);
  const frame = samplePresentation(room, 2780);
  assert.equal(frame.movement.from, 30);
  assert.equal(frame.movement.to, 10);
  assert.equal(frame.movement.steps, 1);
  assert.equal(frame.movement.direct, true);
  const point = animatedBoardPoint(frame.positions.a, frame.movement);
  assert.ok(Math.abs(point.x - 480) < 1e-9);
  assert.ok(Math.abs(point.y - 480) < 1e-9);
  assert.ok(point.lift > 0);
});

test('Inland Empire opening movement visibly leaves the center through GO', () => {
  const room = roomWith([move(-1, 3, [0, 1, 2, 3])]);
  const frame = samplePresentation(room, 2570);
  assert.equal(frame.positions.a, -1);
  assert.equal(frame.movement.to, 0);
  assert.deepEqual(boardPoint(-1), { x: 480, y: 652 });
});

test('elapsed or absent presentations immediately use the current authoritative state', () => {
  const room = roomWith([move(0, 3, [1, 2, 3])]);
  for (const now of [room.presentation.endsAt, room.presentation.endsAt + 900000]) {
    const frame = samplePresentation(room, now);
    assert.equal(frame.active, false);
    assert.equal(frame.stage, 'idle');
    assert.equal(frame.positions.a, 3);
    assert.equal(frame.movement, null);
  }
  room.presentation = null;
  assert.equal(samplePresentation(room, 1000).positions.a, 3);
});

test('reduced motion shows the result while preserving the server action lock', () => {
  const room = roomWith([move(0, 3, [1, 2, 3])]);
  const frame = samplePresentation(room, 1600, true);
  assert.equal(frame.active, true);
  assert.equal(frame.rolling, false);
  assert.equal(frame.moving, false);
  assert.equal(frame.positions.a, 3);
  assert.deepEqual(frame.dice, [2, 3]);
  assert.equal(frame.endAt, room.presentation.endsAt);
});

test('two clients on the same server clock sample an identical frame independent of receipt state', () => {
  const room = roomWith([move(19, 24, [20, 21, 22, 23, 24])]);
  const clientA = { ...room, serverNow: 1000 };
  const clientB = { ...structuredClone(room), serverNow: 2710 };
  assert.deepEqual(samplePresentation(clientA, 2777), samplePresentation(clientB, 2777));
});

test('movement-only debt resolution does not invent another dice roll', () => {
  const room = roomWith([move(7, 24, [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24], 1000, 3380)], { dice: null, rollEndsAt: 1000 });
  const frame = samplePresentation(room, 1070);
  assert.equal(frame.rolling, false);
  assert.equal(frame.moving, true);
  assert.deepEqual(frame.dice, room.game.dice);
});

test('all 40 tile centers are distinct, within the board, and wrap from Boardwalk to GO', () => {
  const points = Array.from({ length: 40 }, (_, index) => boardPoint(index));
  assert.equal(new Set(points.map(point => `${point.x},${point.y}`)).size, 40);
  assert.ok(points.every(point => point.x > 0 && point.x < 960 && point.y > 0 && point.y < 960));
  assert.equal(points[39].x, points[0].x);
  assert.ok(points[39].y < points[0].y);
});

test('clock synchronization uses network receipt and never rewinds for a delayed render or snapshot', () => {
  const initial = { stamp: null, offset: 0 };
  const a = synchronizeClock(initial, { code: 'ROOM', serverNow: 1000, clientReceivedAt: 6003 }, 6300);
  const b = synchronizeClock(initial, { code: 'ROOM', serverNow: 1000, clientReceivedAt: 11003 }, 11700);
  assert.equal(a.offset, -5003);
  assert.equal(b.offset, -10003);
  assert.equal(6500 + a.offset, 11500 + b.offset);
  const delayed = synchronizeClock(a, { code: 'ROOM', serverNow: 2000, clientReceivedAt: 7250 }, 7300);
  assert.equal(delayed.offset, a.offset);
  const faster = synchronizeClock(delayed, { code: 'ROOM', serverNow: 3000, clientReceivedAt: 8001 }, 8100);
  assert.equal(faster.offset, -5001);
});

test('an OS clock adjustment cannot skip or replay the active movement', () => {
  const clock = { stamp: 1000, offset: -5000, measuredAt: 6000, roomCode: 'ROOM' };
  for (const adjustment of [-60000, 60000]) {
    const rebased = rebaseClockAfterJump(clock, { wall: 6000, monotonic: 200 }, 6200 + adjustment, 400);
    assert.equal(6200 + adjustment + rebased.offset, 1200);
    assert.equal(rebased.measuredAt, 0);
    const refreshed = synchronizeClock(rebased, { code: 'ROOM', serverNow: 1300, clientReceivedAt: 6300 + adjustment }, 6305 + adjustment);
    assert.equal(6300 + adjustment + refreshed.offset, 1300);
  }
});

test('a six-space roll followed by the reported 32-space card advance plays each path once', () => {
  const cardPath = Array.from({ length: 32 }, (_, index) => index + 8);
  const room = roomWith([
    move(1, 7, [2, 3, 4, 5, 6, 7], 2500, 3340),
    move(7, 39, cardPath, 4240, 8720),
  ]);
  const steps = [];
  for (let time = 4240; time < 8720; time += 35) {
    const frame = samplePresentation(room, time);
    const step = frame.movement.step;
    if (steps.at(-1) !== step) steps.push(step);
    assert.ok(frame.movement.to >= 8 && frame.movement.to <= 39);
  }
  assert.deepEqual(steps, Array.from({ length: 32 }, (_, index) => index + 1));
  const resumed = samplePresentation(room, 6000);
  assert.equal(resumed.movement.from, 19);
  assert.equal(resumed.movement.to, 20);
  assert.deepEqual(samplePresentation(structuredClone(room), 6000), resumed);
  const complete = samplePresentation(room, 30000);
  assert.equal(complete.active, false);
  assert.equal(complete.positions.a, 39);
  const clock = synchronizeClock({ stamp: 20000, offset: 0, measuredAt: 20000 }, { serverNow: 1000, clientReceivedAt: 30000 }, 30000);
  assert.equal(samplePresentation(room, 30000 + clock.offset).active, false);
});
