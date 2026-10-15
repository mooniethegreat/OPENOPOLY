import test from 'node:test';
import assert from 'node:assert/strict';
import { billboardOffset, boardHeading, DEFAULT_BOARD_YAW, fitBoardWindow, keepBoardFocusVisible, nearestBoardNorth, projectBoardPoint, projectedBoardBounds } from '../src/board-camera.js';
import { boardPoint } from '../src/presentation-state.js';

test('camera yaw turns in the table plane before tilt and completes a full circle', () => {
  const point = { x: 900, y: 700 };
  const initial = projectBoardPoint(point, 48, DEFAULT_BOARD_YAW);
  for (const yaw of [0, 90, 180, 270, 360, -720, 450]) {
    const projected = projectBoardPoint(point, 48, yaw);
    assert.ok(Object.values(projected).every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(projected.x, projected.y, projected.z) - Math.hypot(420, 220)) < 1e-9);
  }
  const wrapped = projectBoardPoint(point, 48, DEFAULT_BOARD_YAW + 360);
  for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(initial[axis] - wrapped[axis]) < 1e-9);
  const east = projectBoardPoint({ x: 900, y: 480 }, 48, 90);
  assert.ok(Math.abs(east.x) < 1e-9);
  assert.ok(east.y > 0 && east.z > 0);
});

test('billboard lifts retain the tile anchor throughout 360 degrees', () => {
  const anchor = { x: 210, y: 800 };
  for (const tilt of [0, 48]) for (let yaw = -360; yaw <= 720; yaw += 15) {
    const before = projectBoardPoint(anchor, tilt, yaw), offset = billboardOffset(tilt, yaw);
    const raised = projectBoardPoint({ x: anchor.x + offset.x, y: anchor.y + offset.y, z: 29 }, tilt, yaw);
    assert.ok(Math.abs(before.x - raised.x) < 1e-9);
    assert.ok(Math.abs(before.y - raised.y) < 1e-9);
    assert.ok(raised.z > before.z);
  }
});

test('overview bounds remain finite and rotate symmetrically for fitting and following', () => {
  for (const tilt of [0, 48]) for (const yaw of [-720, -2, 0, 45, 90, 180, 270, 360, 1080]) {
    const bounds = projectedBoardBounds(.7, tilt, yaw);
    assert.ok(Object.values(bounds).every(Number.isFinite));
    assert.ok(bounds.width > 0 && bounds.height > 0);
    const wrapped = projectedBoardBounds(.7, tilt, yaw + 360);
    for (const value of ['width', 'height', 'x', 'y']) assert.ok(Math.abs(bounds[value] - wrapped[value]) < 1e-9);
  }
});

test('reset chooses the nearest north to avoid spinning back through previous revolutions', () => {
  for (const yaw of [-2100, -360, -2, 0, 90, 270, 358, 4321]) {
    const north = nearestBoardNorth(yaw);
    assert.equal(boardHeading(north), 0);
    assert.ok(Math.abs(yaw - north) <= 180);
  }
});

test('2D CSS camera zoom enlarges projected bounds linearly without scaling their depth', () => {
  for (let yaw = 0; yaw < 360; yaw += 15) {
    const before = projectedBoardBounds(1, 48, yaw), enlarged = projectedBoardBounds(6.4, 48, yaw);
    for (const key of ['width', 'height', 'x', 'y']) assert.ok(Math.abs(enlarged[key] - before[key] * 6.4) < 1e-9);
  }
});

test('all four corners and elevated corner tokens fit the real perspective window at every rotation', () => {
  for(const [width,height,tilt] of [[366,474,30],[296,220,30],[850,560,34],[440,590,34]])for(let yaw=0;yaw<360;yaw+=15){
    const camera=fitBoardWindow(width,height,tilt,yaw);
    for(const z of [0,85])for(const [x,y] of z?[[62,62],[898,62],[898,898],[62,898]]:[[-24,-24],[984,-24],[984,984],[-24,984]]){
      const p=projectBoardPoint({x,y,z},tilt,yaw),factor=2400/(2400-p.z);
      assert(Math.abs((camera.x+p.x*camera.scale)*factor)<=width/2+.001);
      assert(Math.abs((camera.y+p.y*camera.scale)*factor)<=height/2+.001);
    }
  }
});

test('follow clamps an elevated token inside the useful window without changing outcome or zoom', () => {
  for(let position=0;position<40;position++)for(const yaw of [0,90,180,270]){
    const fit=fitBoardWindow(366,474,30,yaw),point={...boardPoint(position),z:48},scale=fit.scale*1.3;
    const camera=keepBoardFocusVisible({x:-800,y:900},point,scale,30,yaw,366,474,40);
    const p=projectBoardPoint(point,30,yaw),factor=2400/(2400-p.z);
    assert(Math.abs((camera.x+p.x*scale)*factor)<=143.001);
    assert(Math.abs((camera.y+p.y*scale)*factor)<=197.001);
  }
});
