import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { createApp } from '../../server/app.js';
import { createGame } from '../../shared/engine.js';
import { sendMoney } from '../../server/money.js';
import { decisionContext } from '../../src/action-gate.js';

let bundle;
test.beforeAll(async () => {
  const result = await build({ entryPoints: ['src/main.jsx'], bundle: true, write: false, outdir: '.runtime/money-flight-browser-bundle', format: 'iife', external: ['/assets/*'], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  bundle = { js: result.outputFiles.find(file => file.path.endsWith('.js')).text, css: result.outputFiles.find(file => file.path.endsWith('.css')).text };
});

function diceSeed(first, second) {
  const next = seed => { let n = seed | 0; n ^= n << 13; n ^= n >>> 17; n ^= n << 5; return n >>> 0; };
  for (let seed = 1; seed < 1000000; seed++) { const a = next(seed), b = next(a); if (1 + Math.floor(a / 4294967296 * 6) === first && 1 + Math.floor(b / 4294967296 * 6) === second) return seed; }
  throw new Error('Missing fixture dice seed');
}

async function fixture(browser, { crossingGo = false, mobile = false } = {}) {
  const prior = process.env.NODE_TEST_CONTEXT;
  process.env.NODE_TEST_CONTEXT = 'money-flight-browser';
  let server;
  try { server = createApp({ storePath: '', distPath: '', presentationTiming: { rollMs: 500, stepMs: 100, settleMs: 100, cardPauseMs: 100, directMs: 200 } }); }
  finally { if (prior === undefined) delete process.env.NODE_TEST_CONTEXT; else process.env.NODE_TEST_CONTEXT = prior; }
  server.app.get('/', (request, response) => response.type('html').send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"><script defer src="/qa.js"></script></head><body><div id="root"></div></body></html>'));
  server.app.get('/qa.js', (request, response) => response.type('js').send(bundle.js));
  server.app.get('/qa.css', (request, response) => response.type('css').send(bundle.css));
  server.app.use(express.static('public'));
  const address = await server.listen(0, '127.0.0.1'), origin = `http://127.0.0.1:${address.port}`;
  const contexts = [], users = [], sockets = [], errors = [], clientCommands = [];
  try {
    const post = async (path, input) => { const response = await fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); expect(response.status).toBe(201); return response.json(); };
    const host = await post('/api/rooms', { name: 'Alex', theme: 'classic', token: 'hat' });
    const guest = await post(`/api/rooms/${host.room.code}/join`, { name: 'Blair', token: 'dog' });
    const observer = await post(`/api/rooms/${host.room.code}/join`, { name: 'Casey', token: 'car' });
    server.store.transaction(data => {
      const room = data.rooms[host.room.code]; room.status = 'playing'; room.game = createGame(room.players, { seed: 42, firstPlayerId: host.playerId });
      sendMoney(room, guest.playerId, { type: 'money:send', toPlayerId: host.playerId, amount: 25, note: 'Saved history' });
      for (const id of [1, 3]) room.game.properties[id].ownerId = host.playerId;
      if (crossingGo) { room.game.players[0].position = 37; room.game._randomState = diceSeed(1, 2); }
      room.version += 1; room.decisionVersion += 1;
    });
    for (const [index, user] of [host, guest, observer].entries()) {
      const context = await browser.newContext({ viewport: mobile && index === 0 ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: mobile && index === 0, hasTouch: mobile && index === 0 }); contexts.push(context);
      await context.addInitScript(seat => { localStorage.setItem('monopoly-table-sessions-v2', JSON.stringify({ [seat.roomCode]: seat })); localStorage.setItem('monopoly-table-active-v2', seat.roomCode); }, { roomCode: host.room.code, playerId: user.playerId, sessionToken: user.sessionToken, name: ['Alex', 'Blair', 'Casey'][index] });
      const page = await context.newPage(); users.push({ ...user, page }); page.on('pageerror', error => errors.push(error.message)); page.on('crash', () => errors.push('Page crashed'));
      page.on('websocket', socket => socket.on('framesent', event => { const match = String(event.payload).match(/^42\d*(\[.*\])$/s); if (match) try { const [name, command] = JSON.parse(match[1]); if (name === 'action') clientCommands.push(command); } catch {} }));
      await page.goto(`${origin}/?room=${host.room.code}`); await expect(page.locator('.connection')).toHaveText('CONNECTED');
      const socket = io(origin, { auth: { roomCode: host.room.code, sessionToken: user.sessionToken }, transports: ['websocket'], reconnection: false, forceNew: true }); sockets.push(socket);
      await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    }
    const read = () => server.publicRoom(server.store.data.rooms[host.room.code]);
    const send = async (index, input) => {
      const command = { ...input, ...decisionContext(read()), commandId: randomUUID() };
      const result = await sockets[index].timeout(5000).emitWithAck('action', command); expect(result.ok, result.error).toBe(true); return { command, result };
    };
    return { server, users, sockets, read, send, errors, clientCommands, close: async () => { sockets.forEach(socket => socket.disconnect()); await Promise.all(contexts.map(context => context.close())); await server.close(); } };
  } catch (error) { sockets.forEach(socket => socket.disconnect()); await Promise.all(contexts.map(context => context.close())); await server.close(); throw error; }
}

async function pose(page, fraction) {
  await page.locator('.money-flight-layer').evaluate((root, progress) => { for (const animation of root.getAnimations({ subtree: true })) { animation.pause(); animation.currentTime = Number(animation.effect.getTiming().duration) * progress; } }, fraction);
}

test('committed money scatters across both tables and an uninvolved observer, without duplicate cash or hydration replay', async ({ browser }, testInfo) => {
  const f = await fixture(browser);
  try {
    for (const { page } of f.users) await expect(page.getByTestId('money-flight')).toHaveCount(0);
    const { command } = await f.send(1, { type: 'money:send', toPlayerId: f.users[0].playerId, amount: 75, note: 'Rent share' });
    const event = f.read().game.log.findLast(item => item.type === 'moneyTransfer');
    for (const { page } of f.users) {
      const flight = page.getByTestId('money-flight'); await expect(flight).toHaveCount(1);
      await expect(flight).toHaveAttribute('data-money-id', event.id); await expect(flight).toHaveAttribute('data-money-amount', '75');
      await expect(flight).toHaveAttribute('data-money-from', f.users[1].playerId); await expect(flight).toHaveAttribute('data-money-to', f.users[0].playerId);
      await expect(flight).toContainText('Blair'); await expect(flight).toContainText('Alex'); await expect(flight).toContainText('Rent share');
      await expect(flight.locator('.money-flight-note')).toHaveCount(3); await expect(page.getByTestId('money-flight-layer')).toHaveCSS('pointer-events', 'none');
      await pose(page, .4);
      const visible = await flight.locator('.money-flight-note').evaluateAll(notes => notes.every(note => { const box = note.getBoundingClientRect(), board = document.querySelector('.board-scene').getBoundingClientRect(); return Number(getComputedStyle(note).opacity) > .9 && box.x + box.width / 2 > board.x && box.x + box.width / 2 < board.right && box.y + box.height / 2 > board.y && box.y + box.height / 2 < board.bottom; }));
      expect(visible).toBe(true);
    }
    await expect(f.users[2].page.getByTestId('payment-feedback')).toHaveCount(0); // The observer still sees shared physical money.
    await f.users[0].page.screenshot({ path: testInfo.outputPath('money-scatter-payer-recipient.png') });
    await f.users[2].page.screenshot({ path: testInfo.outputPath('money-scatter-observer.png') });
    await pose(f.users[2].page, .84); await f.users[2].page.screenshot({ path: testInfo.outputPath('money-to-recipient.png') });
    expect((await f.sockets[1].timeout(5000).emitWithAck('action', command)).duplicate).toBe(true);
    for (const { page } of f.users) await expect(page.getByTestId('money-flight')).toHaveCount(0);
    f.server.io.to(f.read().code).emit('room:state', f.read());
    for (const { page } of f.users) await expect(page.getByTestId('money-flight')).toHaveCount(0);
    expect(f.read().game.players.map(player => player.cash)).toEqual([1600, 1400, 1500]);
    await f.users[0].page.reload(); await expect(f.users[0].page.locator('.connection')).toHaveText('CONNECTED');
    await expect(f.users[0].page.getByTestId('money-flight')).toHaveCount(0);
    expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});

test('GO waits for token landing, and a group build throws one shared expense toward the bank', async ({ browser }, testInfo) => {
  const f = await fixture(browser, { crossingGo: true, mobile: true });
  try {
    await f.send(0, { type: 'roll' });
    for (const { page } of f.users) { await expect(page.getByTestId('shared-presentation')).toBeVisible(); await expect(page.getByTestId('money-flight')).toHaveCount(0); }
    for (const { page } of f.users) { const flight = page.getByTestId('money-flight'); await expect(flight).toHaveCount(1); await expect(flight).toHaveAttribute('data-money-amount', '200'); await expect(flight).toHaveAttribute('data-money-from', 'bank'); await expect(flight).toContainText('Passing GO'); }
    await pose(f.users[0].page, .42); await f.users[0].page.screenshot({ path: testInfo.outputPath('money-go-mobile.png') });
    for (const { page } of f.users) await expect(page.getByTestId('money-flight')).toHaveCount(0);
    await f.send(0, { type: 'buildGroup', propertyId: 1, targetLevel: 1 });
    for (const { page } of f.users) {
      const flight = page.getByTestId('money-flight'); await expect(flight).toHaveCount(1); await expect(flight).toHaveAttribute('data-money-amount', '100'); await expect(flight).toHaveAttribute('data-money-to', 'bank'); await expect(flight).toContainText('Group development'); await expect(flight.locator('.money-flight-bank')).toHaveText('Bank');
    }
    await pose(f.users[0].page, .42); await f.users[0].page.screenshot({ path: testInfo.outputPath('money-bank-mobile.png') });
    await pose(f.users[0].page, .85); await f.users[0].page.screenshot({ path: testInfo.outputPath('money-to-bank-mobile.png') });
    expect(f.read().game.log.filter(event => event.type === 'build' && event.groupBuildId)).toHaveLength(2);
    for (const { page } of f.users) await expect(page.getByTestId('money-flight')).toHaveCount(0);
    expect(f.read().game.players[0].cash).toBe(1625);
    const mobile = f.users[0].page;
    await mobile.setViewportSize({ width: 320, height: 844 });
    await f.send(0, { type: 'money:send', toPlayerId: f.users[1].playerId, amount: 10, note: 'Shared building fund' });
    await expect(mobile.getByTestId('money-flight')).toHaveCount(1);
    await expect(mobile.getByTestId('money-flight')).toContainText('Alex'); await expect(mobile.getByTestId('money-flight')).toContainText('Blair');
    if (await mobile.getByTestId('players-toggle').isVisible()) {
      const anchors = await mobile.getByTestId('money-flight').evaluate(root => {
        const note = root.querySelector('.money-flight-note'), animation = note.getAnimations()[0], frames = animation.effect.getKeyframes();
        const first = new DOMMatrix(frames[0].transform), last = new DOMMatrix(frames.at(-1).transform);
        const wallet = document.querySelector('.player-hud').getBoundingClientRect(), players = document.querySelector('[data-testid="players-toggle"]').getBoundingClientRect();
        return { source: { x: first.m41 + 46, y: first.m42 + 23 }, target: { x: last.m41 + 46, y: last.m42 + 23 }, wallet: { x: (wallet.left + wallet.right) / 2, y: (wallet.top + wallet.bottom) / 2 }, players: { x: (players.left + players.right) / 2, y: (players.top + players.bottom) / 2 } };
      });
      expect(Math.hypot(anchors.source.x - anchors.wallet.x, anchors.source.y - anchors.wallet.y)).toBeLessThan(4);
      expect(Math.hypot(anchors.target.x - anchors.players.x, anchors.target.y - anchors.players.y)).toBeLessThan(4);
    }
    await pose(mobile, .42); await mobile.screenshot({ path: testInfo.outputPath('money-to-other-player-320.png') });
    expect(f.read().game.players[0].cash).toBe(1615);
    expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});

test('camera manipulation and payment bursts stay bounded, drain all handles, and reduced/hidden tabs skip stale motion', async ({ browser }, testInfo) => {
  const f = await fixture(browser, { mobile: true });
  try {
    const desktop = f.users[2].page, mobile = f.users[0].page;
    await desktop.evaluate(() => { window.moneyPeak = { bursts: 0, notes: 0 }; window.moneyMonitor = setInterval(() => { window.moneyPeak.bursts = Math.max(window.moneyPeak.bursts, document.querySelectorAll('.money-flight-burst').length); window.moneyPeak.notes = Math.max(window.moneyPeak.notes, document.querySelectorAll('.money-flight-note').length); }, 30); });
    await desktop.getByRole('button', { name: 'Rotate board', exact: true }).click();
    const bounds = await desktop.locator('.scene-viewport').boundingBox();
    await Promise.all([
      (async () => { for (let i = 0; i < 15; i++) await f.send(1, { type: 'money:send', toPlayerId: f.users[0].playerId, amount: 1, note: `Camera burst ${i}` }); })(),
      (async () => { for (let i = 0; i < 24; i++) { await desktop.mouse.move(bounds.x + bounds.width * .5, bounds.y + bounds.height * .45); await desktop.mouse.down(); await desktop.mouse.move(bounds.x + bounds.width * (.3 + (i % 3) * .2), bounds.y + bounds.height * (.3 + (i % 2) * .25), { steps: 3 }); await desktop.mouse.up(); await desktop.mouse.wheel(0, i % 2 ? 320 : -400); } })(),
    ]);
    await expect(desktop.getByTestId('money-flight')).toHaveCount(0, { timeout: 12000 });
    const drained = await desktop.evaluate(() => { clearInterval(window.moneyMonitor); return { ...window.moneyPeak, handles: document.querySelector('.money-flight-layer').getAnimations({ subtree: true }).length, notesLeft: document.querySelectorAll('.money-flight-note').length, tiles: document.querySelectorAll('.scene-tile').length, zoom: Number(document.querySelector('.board-scene').dataset.cameraZoom), yaw: Number(document.querySelector('.board-scene').dataset.cameraYaw) }; });
    expect(drained.bursts).toBeGreaterThan(0); expect(drained.bursts).toBeLessThanOrEqual(3); expect(drained.notes).toBeLessThanOrEqual(24); expect(drained.handles).toBe(0); expect(drained.notesLeft).toBe(0); expect(drained.tiles).toBe(40); expect(Number.isFinite(drained.yaw)).toBe(true); expect(drained.zoom).toBeLessThanOrEqual(3.2);
    expect(f.clientCommands).toEqual([]); // Camera input and decorative money never send actions.
    expect(f.read().game.players.map(player => player.cash)).toEqual([1540, 1460, 1500]);

    await mobile.setViewportSize({ width: 320, height: 844 }); await mobile.emulateMedia({ reducedMotion: 'reduce' });
    await f.send(1, { type: 'money:send', toPlayerId: f.users[0].playerId, amount: 20, note: 'Reduced motion payment' });
    await expect(mobile.locator('.money-flight-burst.reduced-motion')).toHaveCount(1);
    await pose(mobile, .4); const first = await mobile.locator('.money-flight-note').evaluate(node => getComputedStyle(node).transform);
    await pose(mobile, .7); const second = await mobile.locator('.money-flight-note').evaluate(node => getComputedStyle(node).transform); expect(second).toBe(first);
    await mobile.screenshot({ path: testInfo.outputPath('money-reduced-motion-320.png') });
    await mobile.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect(mobile.getByTestId('money-flight')).toHaveCount(0);
    await f.send(1, { type: 'money:send', toPlayerId: f.users[0].playerId, amount: 5, note: 'Hidden payment' });
    await expect(mobile.getByTestId('money-flight')).toHaveCount(0);
    await mobile.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect(mobile.getByTestId('money-flight')).toHaveCount(0);
    // An unsupported or failing cosmetic compositor must not crash the table.
    // The first note starts successfully; the second throws, requiring cleanup.
    await mobile.evaluate(() => { const original = Element.prototype.animate; let count = 0; Element.prototype.animate = function (...args) { if (this.closest('.money-flight-layer') && ++count === 2) throw new Error('Fixture compositor setup failure'); return original.apply(this, args); }; });
    await f.send(1, { type: 'money:send', toPlayerId: f.users[0].playerId, amount: 75, note: 'Compositor fallback' });
    await expect(mobile.getByTestId('money-flight')).toHaveCount(1);
    expect(await mobile.locator('.money-flight-layer').evaluate(root => root.getAnimations({ subtree: true }).length)).toBe(0);
    await expect(mobile.locator('.scene-tile')).toHaveCount(40);
    await expect(mobile.getByTestId('money-flight')).toHaveCount(0);
    await mobile.evaluate(() => { Element.prototype.animate = undefined; });
    await f.send(1, { type: 'money:send', toPlayerId: f.users[0].playerId, amount: 5, note: 'No animation API' });
    await expect(mobile.getByTestId('money-flight')).toHaveCount(1);
    await expect(mobile.locator('.scene-tile')).toHaveCount(40);
    expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});
