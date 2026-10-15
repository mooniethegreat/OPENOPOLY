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
  const result = await build({ entryPoints: ['src/main.jsx'], bundle: true, write: false, outdir: '.runtime/payment-browser-bundle', format: 'iife', external: ['/assets/*'], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  bundle = { js: result.outputFiles.find(file => file.path.endsWith('.js')).text, css: result.outputFiles.find(file => file.path.endsWith('.css')).text };
});

async function setup(browser, { group = false } = {}) {
  const server = createApp({ storePath: '', distPath: '' });
  server.app.get('/', (request, response) => response.type('html').send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><script defer src="/fixture.js"></script></head><body><div id="root"></div></body></html>'));
  server.app.get('/fixture.js', (request, response) => response.type('js').send(bundle.js));
  server.app.get('/fixture.css', (request, response) => response.type('css').send(bundle.css));
  server.app.use(express.static('public'));
  const address = await server.listen(0, '127.0.0.1');
  const origin = `http://127.0.0.1:${address.port}`;
  const sockets = []; let context;
  try {
    const post = async (pathname, input) => { const response = await fetch(origin + pathname, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); expect(response.status).toBe(201); return response.json(); };
    const owner = await post('/api/rooms', { name: 'Alex', theme: 'classic' });
    const other = await post(`/api/rooms/${owner.room.code}/join`, { name: 'Blair' });
    server.store.transaction(data => {
      const room = data.rooms[owner.room.code]; room.status = 'playing'; room.game = createGame(room.players, { seed: 42, firstPlayerId: owner.playerId });
      sendMoney(room, other.playerId, { type: 'money:send', toPlayerId: owner.playerId, amount: 25, note: 'Earlier transfer' });
      if (group) for (const id of [1, 3]) room.game.properties[id].ownerId = owner.playerId;
      room.version += 1; room.decisionVersion += 1;
    });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(seat => {
      localStorage.setItem('monopoly-table-sessions-v2', JSON.stringify({ [seat.roomCode]: seat })); localStorage.setItem('monopoly-table-active-v2', seat.roomCode);
    }, { roomCode: owner.room.code, playerId: owner.playerId, sessionToken: owner.sessionToken, name: 'Alex', theme: 'classic' });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/?room=${owner.room.code}`);
    await expect(page.locator('.connection')).toHaveText('CONNECTED');
    for (const user of [owner, other]) {
      const socket = io(origin, { auth: { roomCode: owner.room.code, sessionToken: user.sessionToken }, transports: ['websocket'], reconnection: false, forceNew: true });
      sockets.push(socket);
      await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    }
    const read = () => server.publicRoom(server.store.data.rooms[owner.room.code]);
    const send = async (index, input) => {
      const command = { ...input, ...decisionContext(read()), commandId: randomUUID() };
      const result = await sockets[index].timeout(5000).emitWithAck('action', command); expect(result.ok).toBe(true); return { result, command };
    };
    return { server, context, page, owner, other, sockets, read, send, errors, close: async () => { sockets.forEach(socket => socket.disconnect()); await context.close(); await server.close(); } };
  } catch (error) { sockets.forEach(socket => socket.disconnect()); await context?.close(); await server.close(); throw error; }
}

test('actual payments show large signed amounts and reasons, stay visible over dialogs, and never replay after refresh', async ({ browser }) => {
  const run = await setup(browser);
  const { page, owner, other, server } = run;
  const feedback = page.getByTestId('payment-feedback');
  try {
    await expect(feedback).toHaveCount(0); // The saved $25 payment is a hydration baseline.
    const { command } = await run.send(1, { type: 'money:send', toPlayerId: owner.playerId, amount: 75, note: 'Rent share' });
    await expect(feedback).toHaveAttribute('data-payment-direction', 'incoming');
    await expect(feedback.locator('.payment-feedback-amount')).toHaveText('+$75');
    await expect(feedback).toContainText('Paid by Blair'); await expect(feedback).toContainText('Rent share');
    await expect(feedback).toHaveCSS('pointer-events', 'none');
    await expect(feedback.locator('button')).toHaveCSS('pointer-events', 'auto');
    await page.screenshot({ path: '.runtime/inspection/payment-incoming-desktop.png' });
    await page.getByRole('button', { name: 'Dismiss payment notification' }).click();
    expect((await run.sockets[1].timeout(5000).emitWithAck('action', command)).duplicate).toBe(true);
    server.io.to(owner.room.code).emit('room:state', run.read());
    await expect(feedback).toHaveCount(0); // Duplicate current snapshots cannot enqueue it again.

    await page.getByLabel('Send money', { exact: true }).click();
    const dialog = page.getByRole('dialog'); await dialog.getByLabel('Payment amount', { exact: true }).fill('25');
    await dialog.getByLabel('Payment note').fill('Cab fare');
    await dialog.getByRole('button', { name: 'Review payment', exact: true }).click();
    await dialog.getByRole('button', { name: 'Send $25 to Blair', exact: true }).click();
    await expect(feedback).toHaveAttribute('data-payment-direction', 'outgoing');
    await expect(feedback.locator('.payment-feedback-amount')).toHaveText('−$25');
    await expect(feedback).toContainText('Paid to Blair'); await expect(feedback).toContainText('Cab fare');
    await page.screenshot({ path: '.runtime/inspection/payment-outgoing-desktop.png' });
    await page.getByRole('button', { name: 'Dismiss payment notification' }).click();

    await page.getByRole('button', { name: 'Game rules', exact: true }).click();
    await run.send(1, { type: 'money:send', toPlayerId: owner.playerId, amount: 35, note: 'While reading the rules' });
    await expect(page.getByRole('dialog', { name: 'Game rules', exact: true })).toBeVisible();
    await expect(feedback.locator('.payment-feedback-amount')).toHaveText('+$35');
    await expect(feedback).toContainText('While reading the rules');
    const stacking = await page.evaluate(() => ({ payment: Number(getComputedStyle(document.querySelector('.payment-feedback')).zIndex), modal: Number(getComputedStyle(document.querySelector('.modal-backdrop')).zIndex) }));
    expect(stacking.payment).toBeGreaterThan(stacking.modal);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(feedback).toHaveCSS('animation-name', 'none');
    const size = await feedback.boundingBox(); expect(size.x).toBeGreaterThanOrEqual(0); expect(size.x + size.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: '.runtime/inspection/payment-incoming-mobile.png' });
    const cash = run.read().game.players.map(player => player.cash);
    await page.reload();
    await expect(page.locator('.connection')).toHaveText('CONNECTED');
    await expect(feedback).toHaveCount(0);
    expect(run.read().game.players.map(player => player.cash)).toEqual(cash);
    expect(run.read().game.players.find(player => player.id === other.playerId).cash).toBe(1390);
    expect(run.errors).toEqual([]);
  } finally { await run.close(); }
});

test('group development emits one expense and incoming payments remain visible while the property dialog stays open', async ({ browser }) => {
  const run = await setup(browser, { group: true });
  const { page, owner } = run;
  const feedback = page.getByTestId('payment-feedback');
  try {
    await page.getByRole('tab', { name: /^Properties/ }).click();
    await page.locator('.portfolio-property').filter({ hasText: 'Mediterranean Avenue' }).click();
    const group = page.getByTestId('group-development');
    await group.getByRole('button', { name: 'Review group build · $100', exact: true }).click();
    await group.getByRole('button', { name: 'Confirm group build · $100', exact: true }).click();
    await expect(feedback.locator('.payment-feedback-amount')).toHaveText('−$100');
    await expect(feedback).toContainText('Paid to Bank');
    await expect(feedback).toContainText('Group development: Mediterranean Avenue, Baltic Avenue');
    await expect(page.getByRole('dialog', { name: 'Property details', exact: true })).toBeVisible();
    expect(run.read().game.players[0].cash).toBe(1425);
    expect(run.read().game.log.filter(event => event.type === 'build' && event.groupBuildId)).toHaveLength(2);
    await page.screenshot({ path: '.runtime/inspection/payment-group-build.png' });
    await page.getByRole('button', { name: 'Dismiss payment notification' }).click();
    await expect(feedback).toHaveCount(0); // The two child build logs did not create extra expenses.
    await run.send(1, { type: 'money:send', toPlayerId: owner.playerId, amount: 10, note: 'Building contribution' });
    await expect(feedback.locator('.payment-feedback-amount')).toHaveText('+$10');
    await expect(feedback).toContainText('Building contribution');
    await expect(page.getByRole('dialog', { name: 'Property details', exact: true })).toBeVisible();
    await expect(group.getByRole('button', { name: /Review group build/ })).toBeEnabled();
    expect(run.errors).toEqual([]);
  } finally { await run.close(); }
});
