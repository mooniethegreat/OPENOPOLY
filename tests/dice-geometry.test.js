import test from 'node:test';
import assert from 'node:assert/strict';
import { dicePose } from '../src/dice-geometry.js';

function rotateVertex([x, y, z], pose) {
  const a = pose.x * Math.PI / 180, b = pose.y * Math.PI / 180, c = pose.z * Math.PI / 180;
  const x1 = x * Math.cos(b) + z * Math.sin(b), z1 = -x * Math.sin(b) + z * Math.cos(b);
  const y2 = y * Math.cos(a) - z1 * Math.sin(a), z2 = y * Math.sin(a) + z1 * Math.cos(a);
  return [x1 * Math.cos(c) - y2 * Math.sin(c), x1 * Math.sin(c) + y2 * Math.cos(c), z2];
}

test('every cube vertex stays above the board for all outcomes throughout both tumbles', () => {
  for (const size of [56, 62]) for (let value = 1; value <= 6; value++) for (let index = 0; index < 2; index++) {
    for (let frame = 0; frame <= 360; frame++) {
      const pose = dicePose({ value, index, size, rolling: true, progress: frame / 360 });
      for (const x of [-size / 2, size / 2]) for (const y of [-size / 2, size / 2]) for (const z of [-size / 2, size / 2]) {
        assert.ok(rotateVertex([x, y, z], pose)[2] + pose.height >= 0.999999, `die ${value}, frame ${frame}: cube intersects the board`);
      }
    }
  }
});

test('each final result lies flat with the authoritative face pointing above the table', () => {
  const normals = { 1: [0, 0, 1], 2: [0, -1, 0], 3: [1, 0, 0], 4: [-1, 0, 0], 5: [0, 1, 0], 6: [0, 0, -1] };
  for (let value = 1; value <= 6; value++) for (let index = 0; index < 2; index++) {
    const pose = dicePose({ value, index, size: 62 });
    const normal = rotateVertex(normals[value], pose);
    assert.ok(Math.abs(normal[0]) < 1e-10 && Math.abs(normal[1]) < 1e-10);
    assert.ok(Math.abs(normal[2] - 1) < 1e-10);
    assert.ok(Math.abs(pose.supportHeight - 31) < 1e-10);
  }
});
