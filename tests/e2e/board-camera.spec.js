import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import { applyAction, createGame, publicGame } from '../../shared/engine.js';
import { createPresentation } from '../../shared/presentation.js';

let boardBundle;
async function mountBoard(page, { mobile = false, eightTokens = false } = {}) {
  boardBundle ||= build({
    stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { Board } from './src/Board.jsx';
      import { GameContext } from './src/game-context.jsx';
      import { usePresentation } from './src/presentation.jsx';
      import { tokenMeshCacheSize } from './src/token-geometry.js';
      function Fixture() {
        window.tokenMeshCacheSize = tokenMeshCacheSize;
        const [room, setRoom] = useState(window.fixtureRoom);
        const [selected, setSelected] = useState(null);
        window.deliverBoardSnapshot = setRoom;
        const presentation = usePresentation(room);
        return <GameContext.Provider value={{ room, presentation, selected, setSelected: id => { window.tileInspections.push(id); setSelected(id); }, action: action => { window.boardActions.push(action); } }}><Board /></GameContext.Provider>;
      }
      createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture /></React.StrictMode>);
    ` },
    bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"development"' },
  });
  await page.setViewportSize(mobile ? { width: 390, height: 680 } : { width: 1200, height: 780 });
  const roster = eightTokens ? ['hat','car','dog','ship','cat','penguin','thimble','duck'].map((token,index)=>({id:String.fromCharCode(97+index),name:`Player ${index+1}`,token})) : [{ id: 'a', name: 'Avery', token: 'hat' }, { id: 'b', name: 'Jordan', token: 'dog' }];
  const game = createGame(roster, { seed: 42, firstPlayerId: 'a' });
  if(eightTokens) game.players.forEach((player,index)=>{player.position=index*5;});
  game.players[0].position = 7;
  await page.setContent('<html><head></head><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: await fs.readFile('src/board-scene.css', 'utf8') + `body{margin:0;font-family:Arial,sans-serif;background:#142822}#root{height:100vh;width:100vw}button{border:0;cursor:pointer}*{box-sizing:border-box}.token-photo{display:inline-flex;align-items:center;justify-content:center}.token-photo>span{display:block;background-image:url('/assets/reference/classic-set.png')}` });
  await page.evaluate(room => { window.fixtureRoom = room; window.tileInspections = []; window.boardActions = []; }, { code: 'CAMERA', theme: 'classic', players: game.players, game: publicGame(game), serverNow: Date.now(), presentation: null });
  await page.addScriptTag({ content: (await boardBundle).outputFiles[0].text });
  await expect(page.locator('.board-scene')).toHaveAttribute('data-camera-zoom', '1');
  return page.locator('.board-scene');
}

const camera = page => page.locator('.board-scene').evaluate(e => ({ yaw: +e.dataset.cameraYaw, heading: +e.dataset.cameraHeading, zoom: +e.dataset.cameraZoom, x: +e.dataset.cameraX, y: +e.dataset.cameraY, mode: e.dataset.cameraMode }));
const settle = page => page.waitForTimeout(60);
async function drag(page, dx, dy = 0) {
  const area = await page.locator('.scene-viewport').boundingBox();
  const start = { x: area.x + 120, y: area.y + area.height * .55 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 10 });
  await page.mouse.up();
  await settle(page);
}

test('Rotate mode makes a full revolution, keeps follow and zoom, and resets north', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const scene = await mountBoard(page);
  await page.getByRole('button', { name: 'Follow turn', exact: true }).click();
  await page.getByRole('button', { name: 'Rotate board', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Rotate board', exact: true })).toHaveAttribute('aria-pressed', 'true');
  for (const heading of [90, 180, 270, 0]) {
    await drag(page, 200);
    await expect(scene).toHaveAttribute('data-camera-heading', String(heading));
    const state = await camera(page);
    expect(state.zoom).toBe(1.3); expect(state.mode).toBe('follow');
    const normals = await page.locator('.scene-tile-name').evaluateAll(labels => labels.map(label => {
      const world = new DOMMatrix(getComputedStyle(document.querySelector('.scene-world')).transform);
      const face = new DOMMatrix(getComputedStyle(label).transform);
      const normal = new DOMPoint(0, 0, 1, 0).matrixTransform(world.multiply(face));
      return { x: normal.x, y: normal.y, z: normal.z };
    }));
    // Wait for any non-input scene transition to settle before evaluating its inverse.
    await page.waitForTimeout(650);
    for (const normal of normals) { expect(Math.abs(normal.x)).toBeLessThan(.00002); expect(Math.abs(normal.y)).toBeLessThan(.00002); expect(normal.z).toBeCloseTo(1, 4); }
    if (heading) await page.screenshot({ path: info.outputPath('yaw-' + heading + '.png') });
  }
  expect((await camera(page)).yaw).toBeCloseTo(358, 5);
  await page.getByRole('button', { name: 'Reset camera', exact: true }).click();
  await expect(scene).toHaveAttribute('data-camera-heading', '0');
  expect(await page.evaluate(() => window.boardActions)).toEqual([]);
  expect(await page.evaluate(() => window.tileInspections)).toEqual([]);
  expect(errors).toEqual([]);
});

test('eight procedural mesh tokens stay bounded while the camera rotates and zooms', async ({page},info)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await mountBoard(page,{eightTokens:true});
  await expect(page.locator('.scene-token')).toHaveCount(8);
  expect(await page.locator('.scene-token .token-mesh').evaluateAll(tokens=>new Set(tokens.map(token=>token.dataset.tokenModel)).size)).toBe(8);
  await page.getByRole('button',{name:'Rotate board',exact:true}).click();
  for(let repeat=0;repeat<24;repeat++){
    await drag(page,repeat%2?260:-170);
    await page.mouse.move(600,400);await page.mouse.wheel(0,repeat%2?160:-190);
    expect(await page.locator('.scene-token polygon').count()).toBeLessThan(1200);
  }
  await page.getByRole('button',{name:'Reset camera',exact:true}).click();await page.waitForTimeout(700);
  expect(await page.evaluate(()=>window.tokenMeshCacheSize())).toBeLessThanOrEqual(96);
  await expect(page.locator('.scene-token')).toHaveCount(8);await expect(page.locator('.scene-tile')).toHaveCount(40);
  await page.screenshot({path:info.outputPath('eight-mesh-tokens-overview.png')});
  expect(await page.evaluate(()=>window.boardActions)).toEqual([]);expect(errors).toEqual([]);
});

test('both mouse-button orders rotate and releasing either button ends the gesture', async ({ page }) => {
  const scene = await mountBoard(page);
  await page.getByRole('button', { name: 'Follow turn', exact: true }).click();
  for (const order of [['left', 'right'], ['right', 'left']]) {
    const before = await camera(page);
    await page.mouse.move(400, 400);
    await page.mouse.down({ button: order[0] });
    await page.mouse.down({ button: order[1] });
    await page.mouse.move(400, 400); // Pointermove reports the changed buttons bitmask.
    await page.mouse.move(600, 400, { steps: 10 });
    await settle(page);
    expect((await camera(page)).yaw - before.yaw).toBeCloseTo(90, 5);
    await expect(scene).toHaveAttribute('data-camera-mode', 'follow');
    await page.mouse.up({ button: order[1] });
    const stopped = await camera(page);
    await page.mouse.move(700, 450, { steps: 5 });
    await settle(page);
    expect(await camera(page)).toEqual(stopped);
    await page.mouse.up({ button: order[0] });
  }
  expect(await page.evaluate(() => window.boardActions)).toEqual([]);
});

test('cancel, lost capture and window blur release the camera; subsequent pan still works', async ({ page }) => {
  await mountBoard(page);
  for (const end of ['cancel', 'lost', 'blur']) {
    await page.mouse.move(400, 400); await page.mouse.down(); await page.mouse.move(440, 430, { steps: 3 });
    await settle(page);
    await page.evaluate(end => {
      const viewport = document.querySelector('.scene-viewport');
      if (end === 'cancel') viewport.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }));
      if (end === 'lost') viewport.releasePointerCapture(1);
      if (end === 'blur') window.dispatchEvent(new Event('blur'));
    }, end);
    await settle(page);
    const stopped = await camera(page);
    await page.mouse.move(570, 480, { steps: 4 }); await settle(page);
    expect(await camera(page)).toEqual(stopped);
    await expect(page.locator('.board-scene')).not.toHaveClass(/scene-manipulating/);
    await page.mouse.up();
  }
  const before = await camera(page);
  await drag(page, 90, 40);
  expect((await camera(page)).x - before.x).toBeCloseTo(90, 4);
  expect((await camera(page)).y - before.y).toBeCloseTo(40, 4);
  await expect(page.locator('.board-scene')).toHaveAttribute('data-camera-mode', 'free');
});

test('mobile Rotate is visible, one touch rotates, two touches zoom, and tile keyboard inspection remains available', async ({ page, context }) => {
  await mountBoard(page, { mobile: true });
  const rotate = page.getByRole('button', { name: 'Rotate board', exact: true });
  const bounds = await rotate.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await rotate.click();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 80, y: 350 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 280, y: 350 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.board-scene')).toHaveAttribute('data-camera-heading', '90');
  const before = await camera(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: 140, y: 350 }, { id: 2, x: 240, y: 350 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: 100, y: 350 }, { id: 2, x: 280, y: 350 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await settle(page);
  const after = await camera(page);
  expect(after.zoom).toBeGreaterThan(before.zoom); expect(after.yaw).toBe(before.yaw); expect(after.mode).toBe('free');
  await page.locator('[data-space-id="1"]').focus();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.tileInspections)).toEqual([1]);
  expect(await page.evaluate(() => window.boardActions)).toEqual([]);
});

test('the full board fits at each quarter turn with upright labels', async ({ page }, info) => {
  await mountBoard(page);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Rotate board', exact: true }).click();
  for (const heading of [90, 180, 270]) {
    await drag(page, 200);
    await page.waitForTimeout(650);
    const geometry = await page.evaluate(() => {
      const viewport = document.querySelector('.scene-viewport').getBoundingClientRect();
      const board = document.querySelector('.scene-board').getBoundingClientRect();
      return { viewport: viewport.toJSON(), board: board.toJSON() };
    });
    expect(geometry.board.x).toBeGreaterThan(geometry.viewport.x);
    expect(geometry.board.y).toBeGreaterThan(geometry.viewport.y);
    expect(geometry.board.right).toBeLessThan(geometry.viewport.right);
    expect(geometry.board.bottom).toBeLessThan(geometry.viewport.bottom);
    await page.screenshot({ path: info.outputPath('overview-yaw-' + heading + '.png') });
  }
});

test('sustained pan and zoom across valid card and jail timelines keeps bounded camera and an intact view', async ({ page }) => {
  const errors = [], crashes = [];
  page.on('pageerror', error => errors.push(error.message)); page.on('crash', () => crashes.push(true));
  await mountBoard(page);
  for (let turn = 0; turn < 8; turn++) {
    const game = createGame([{ id: 'a', name: 'Avery' }, { id: 'b', name: 'Jordan' }], { seed: 42, firstPlayerId: turn % 2 ? 'b' : 'a' });
    const actor = game.players.find(player => player.id === game.currentPlayerId);
    actor.position = turn % 2 ? 27 : 1;
    if (!(turn % 2)) game._decks.chance = ['chance-boardwalk', ...game._decks.chance.filter(id => id !== 'chance-boardwalk')];
    const count = game.log.length;
    applyAction(game, actor.id, { type: 'roll' }, { dice: turn % 2 ? [1, 2] : [2, 4] });
    const timeline = createPresentation(game.log.slice(count), { id: 'stress-' + turn, startedAt: Date.now() });
    await page.evaluate(({ game, timeline }) => window.deliverBoardSnapshot({ ...window.fixtureRoom, serverNow: Date.now(), game, presentation: timeline }), { game: publicGame(game), timeline });
    for (let repeat = 0; repeat < 3; repeat++) {
      await page.mouse.move(350, 400); await page.mouse.down();
      await page.mouse.move(400, 450, { steps: 2 }); // Acquire real native pointer capture.
      await page.mouse.move(repeat % 2 ? -100000 : 100000, repeat % 2 ? -100000 : 100000);
      await page.mouse.up();
      await page.mouse.move(500, 400); await page.mouse.wheel(0, repeat % 2 ? 1100 : -1100);
    }
    await settle(page);
    const state = await camera(page);
    expect(Object.values(state).filter(value => typeof value === 'number').every(Number.isFinite)).toBe(true);
    expect(Math.abs(state.x)).toBeLessThan(5000); expect(Math.abs(state.y)).toBeLessThan(5000);
    expect(state.zoom).toBeGreaterThanOrEqual(.8); expect(state.zoom).toBeLessThanOrEqual(3.2);
    await expect(page.locator('.scene-tile')).toHaveCount(40);
  }
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.waitForTimeout(700);
  const intact = await page.evaluate(() => ({ root: document.querySelector('#root').childElementCount, scrollX: document.querySelector('.scene-viewport').scrollLeft, scrollY: document.querySelector('.scene-viewport').scrollTop }));
  expect(intact).toEqual({ root: 1, scrollX: 0, scrollY: 0 });
  expect(errors).toEqual([]); expect(crashes).toEqual([]);
  expect(await page.evaluate(() => window.boardActions)).toEqual([]);
});

test('4K maximum zoom keeps the actual CSS depth and projection finite', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await mountBoard(page);
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Rotate board', exact: true }).click();
  await drag(page, 100);
  await page.mouse.move(1900, 1100); await page.mouse.wheel(0, -10000);
  await page.waitForTimeout(700);
  const geometry = await page.evaluate(() => {
    const camera = new DOMMatrix(getComputedStyle(document.querySelector('.scene-camera')).transform);
    const world = new DOMMatrix(getComputedStyle(document.querySelector('.scene-world')).transform);
    const composed = camera.multiply(world);
    const points = [];
    for (const x of [-502, 502]) for (const y of [-502, 502]) for (const z of [0, 150]) {
      const a = new DOMPoint(x, y, z).matrixTransform(world), b = new DOMPoint(x, y, z).matrixTransform(composed);
      points.push({ before: a.z, after: b.z });
    }
    const rect = document.querySelector('.scene-world').getBoundingClientRect();
    return { zScale: camera.m33, zTranslate: camera.m43, perspective: getComputedStyle(document.querySelector('.scene-viewport')).perspective, points, rect: rect.toJSON() };
  });
  expect(geometry.zScale).toBe(1); expect(geometry.zTranslate).toBe(0); expect(geometry.perspective).toBe('2400px');
  for (const point of geometry.points) { expect(point.after).toBeCloseTo(point.before, 5); expect(2400 - point.after).toBeGreaterThan(1700); }
  expect(Object.values(geometry.rect).every(Number.isFinite)).toBe(true);
  await page.getByRole('button', { name: 'Rotate board', exact: true }).click();
  await page.mouse.move(1800, 1000); await page.mouse.down(); await page.mouse.move(1850, 1050);
  await page.mouse.move(100000, 100000); await page.mouse.up();
  await page.setViewportSize({ width: 390, height: 680 });
  await page.waitForTimeout(100);
  await page.mouse.move(200, 350); await page.mouse.wheel(0, 80); await settle(page);
  const resized = await camera(page);
  // The long-lived native wheel listener must clamp against the resized scene, not its mount size.
  expect(Math.abs(resized.x)).toBeLessThan(1200); expect(Math.abs(resized.y)).toBeLessThan(1200);
  expect(errors).toEqual([]);
});
