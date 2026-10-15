import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import express from 'express';
import { createApp } from '../../server/app.js';
import { createGame } from '../../shared/engine.js';

test('zoomed desktop board paints beyond both stage edges beneath clickable floating HUD', async ({ browser }, info) => {
  const bundle = await build({ entryPoints: ['src/main.jsx'], bundle: true, write: false, outdir: '.runtime/board-overflow-bundle', format: 'iife', external: ['/assets/*'], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  const server = createApp({ storePath: '', distPath: '' });
  server.app.get('/', (req, res) => res.type('html').send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"><script defer src="/qa.js"></script></head><body><div id="root"></div></body></html>'));
  for (const type of ['js', 'css']) server.app.get(`/qa.${type}`, (req, res) => res.type(type).send(bundle.outputFiles.find(file => file.path.endsWith(`.${type}`)).text));
  server.app.use(express.static('public'));
  const address = await server.listen(0, '127.0.0.1'), origin = `http://127.0.0.1:${address.port}`;
  const post = async (route, body) => { const response = await fetch(origin + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); expect(response.status).toBe(201); return response.json(); };
  let context;
  try {
    const host = await post('/api/rooms', { name: 'Overflow host', theme: 'classic' });
    await post(`/api/rooms/${host.room.code}/join`, { name: 'Overflow guest' });
    server.store.transaction(data => { const room = data.rooms[host.room.code]; room.game = createGame(room.players, { seed: 42, firstPlayerId: host.playerId }); room.status = 'playing'; room.version++; room.decisionVersion++; });
    const fingerprint = () => { const game = server.store.data.rooms[host.room.code].game; return JSON.stringify({ turn: game.turn, phase: game.phase, log: game.log, players: game.players.map(({ id, cash, position }) => ({ id, cash, position })), properties: game.properties }); };
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(seat => { localStorage.setItem('monopoly-table-sessions-v2', JSON.stringify({ [seat.roomCode]: seat })); localStorage.setItem('monopoly-table-active-v2', seat.roomCode); }, { roomCode: host.room.code, playerId: host.playerId, sessionToken: host.sessionToken });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/?room=${host.room.code}`);
    await expect(page.locator('.connection')).toHaveText('CONNECTED');
    const before = fingerprint(), stage = await page.locator('.game-stage').boundingBox();
    for (let click = 0; click < 3; click++) await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect.poll(async () => Number(await page.locator('.board-scene').getAttribute('data-camera-zoom'))).toBeGreaterThan(1.4);
    const viewport = await page.locator('.scene-viewport').boundingBox();
    const pan = async dx => { const x = stage.x + stage.width / 2, y = stage.y + stage.height * .65; await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y, { steps: 12 }); await page.mouse.up(); };
    const paintEvidence = side => page.evaluate(side => {
      const stage = document.querySelector('.game-stage').getBoundingClientRect(), x = side === 'left' ? stage.left - 6 : stage.right + 6;
      const worldAt = (x, y) => document.elementsFromPoint(x, y).some(node => node.closest('.scene-world'));
      const edge = Array.from({ length: 30 }, (_, i) => ({ x, y: stage.top + 35 + (stage.height - 100) * i / 29 })).find(point => worldAt(point.x, point.y));
      const selector = side === 'left' ? '.player-card' : '.context-actions>button:not(:disabled)';
      const underHud = [...document.querySelectorAll(selector)].flatMap(node => { const rect = node.getBoundingClientRect(); return [.25, .5, .75].map(fraction => { const x = rect.left + rect.width * fraction, y = rect.top + rect.height / 2; return { x, y, boardBehind: worldAt(x, y), hudOnTop: node.contains(document.elementFromPoint(x, y)) }; }); }).find(point => point.boardBehind && point.hudOnTop);
      return { edge, underHud };
    }, side);
    await pan(-300);
    await expect.poll(async () => Boolean((await paintEvidence('left')).edge && (await paintEvidence('left')).underHud)).toBe(true);
    const left = await paintEvidence('left');
    await page.screenshot({ path: info.outputPath('board-under-left-rail.png') });
    await pan(600);
    await expect.poll(async () => Boolean((await paintEvidence('right')).edge && (await paintEvidence('right')).underHud)).toBe(true);
    const right = await paintEvidence('right');
    await page.screenshot({ path: info.outputPath('board-under-right-actions.png') });
    expect(await page.locator('.game-stage').boundingBox()).toEqual(stage);
    expect(await page.locator('.scene-viewport').boundingBox()).toEqual(viewport);
    await page.getByRole('button', { name: 'Request a contract', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByLabel('Room and profile settings', { exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(fingerprint()).toBe(before);
    expect(errors).toEqual([]);
    await info.attach('paint-and-hit-evidence', { body: JSON.stringify({ left, right, stage, viewport }), contentType: 'application/json' });
  } finally { await context?.close(); await server.close(); }
});
