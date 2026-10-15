import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import express from 'express';
import { createApp } from '../../server/app.js';
import { createGame } from '../../shared/engine.js';
import { openGameDrawer } from './ui-helpers.js';

async function setup(browser, options = {}) {
  const bundle = await build({ entryPoints: ['src/main.jsx'], bundle: true, write: false, outdir: '.runtime/group-browser-bundle', format: 'iife', external: ['/assets/*'], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  const client = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
  const server = createApp({ storePath: '', distPath: '' });
  server.app.get('/', (request, response) => response.type('html').send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa-style.css"><script defer src="/qa-app.js"></script></head><body><div id="root"></div></body></html>'));
  server.app.get('/qa-app.js', (request, response) => response.type('js').send(client));
  server.app.get('/qa-style.css', (request, response) => response.type('css').send(css));
  server.app.use(express.static('public'));
  const address = await server.listen(0, '127.0.0.1');
  const origin = `http://127.0.0.1:${address.port}`;
  const post = async (pathname, body) => { const response = await fetch(origin + pathname, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); expect(response.status).toBe(201); return response.json(); };
  const host = await post('/api/rooms', { name: 'Builder', theme: 'classic', token: 'hat' });
  const guest = await post(`/api/rooms/${host.room.code}/join`, { name: 'Observer', token: 'dog' });
  server.store.transaction(data => {
    const room = data.rooms[host.room.code];
    room.game = createGame(room.players, { seed: 42, firstPlayerId: host.playerId }); room.status = 'playing'; room.version += 1; room.decisionVersion += 1;
    for (const id of [1, 3]) room.game.properties[id].ownerId = host.playerId;
    if (options.houses !== undefined) room.game.bank.houses = options.houses;
  });
  const contexts = [], users = [], errors = [], commands = [];
  try {
    for (const [index, user] of [host, guest].entries()) {
      const context = await browser.newContext({ baseURL: origin, viewport: index ? { width: 1440, height: 900 } : { width: 390, height: 844 }, isMobile: !index, hasTouch: !index }); contexts.push(context);
      await context.addInitScript(seat => {
        localStorage.setItem('monopoly-table-sessions-v2', JSON.stringify({ [seat.roomCode]: seat })); localStorage.setItem('monopoly-table-active-v2', seat.roomCode);
      }, { roomCode: host.room.code, playerId: user.playerId, sessionToken: user.sessionToken, name: index ? 'Observer' : 'Builder' });
      const page = await context.newPage(); users.push({ ...user, page });
      page.on('pageerror', error => errors.push(error.message));
      const record = payload => { for (const part of String(payload || '').split('\x1e')) { const match = part.match(/^42\d*(\[.*\])$/s); if (!match) continue; try { const [name, command] = JSON.parse(match[1]); if (name === 'action' && command.type === 'buildGroup') commands.push(command); } catch {} } };
      page.on('websocket', socket => socket.on('framesent', event => record(event.payload)));
      page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/socket.io/')) record(request.postData()); });
      await page.goto(`/?room=${host.room.code}`); await expect(page.locator('.connection')).toHaveText('CONNECTED');
    }
    const read = () => server.publicRoom(server.store.data.rooms[host.room.code]);
    const openGroup = async () => {
      const page = users[0].page;
      await openGameDrawer(page, 'Properties');
      await page.locator('.portfolio-property').filter({ hasText: 'Mediterranean Avenue' }).click();
      await expect(page.getByTestId('group-development')).toContainText('Baltic Avenue');
      return page.getByTestId('group-development');
    };
    return { server, users, errors, commands, read, openGroup, close: async () => { await Promise.all(contexts.map(context => context.close())); await server.close(); } };
  } catch (error) { await Promise.all(contexts.map(context => context.close())); await server.close(); throw error; }
}

test('a reviewed color-group action builds every deed atomically and reaches both browsers once', async ({ browser }, testInfo) => {
  const run = await setup(browser);
  try {
    const [host, guest] = run.users; const group = await run.openGroup();
    await expect(group.locator('.group-building-levels')).toContainText('0 houses');
    await group.getByRole('button', { name: 'Review group build · $100', exact: true }).click();
    await expect(group.getByTestId('group-build-review')).toContainText('Mediterranean Avenue + Baltic Avenue');
    expect(run.read().game.players[0].cash).toBe(1500);
    expect(run.commands).toHaveLength(0);
    await host.page.screenshot({ path: testInfo.outputPath('phone-group-build-review.png') });
    await group.getByRole('button', { name: 'Confirm group build · $100', exact: true }).dblclick();
    await expect.poll(() => run.read().game.properties[3].houses).toBe(1);
    await expect(group.getByTestId('group-build-review')).toHaveCount(0);
    expect(run.read().game.properties[1].houses).toBe(1);
    expect(run.read().game.players[0].cash).toBe(1400);
    expect(run.commands).toHaveLength(1);
    expect(run.commands[0]).toMatchObject({ type: 'buildGroup', propertyId: 1, targetLevel: 1 });
    await expect(guest.page.locator('.scene-development')).toHaveCount(2);
    await expect(guest.page.locator('.player-card').filter({ hasText: 'Builder' })).toContainText('$1,400');
    await group.getByLabel('Color group building level', { exact: true }).selectOption('5');
    await group.getByRole('button', { name: 'Review group build · $400', exact: true }).click();
    expect(run.read().game.players[0].cash).toBe(1400);
    await group.getByRole('button', { name: 'Confirm group build · $400', exact: true }).click();
    await expect.poll(() => run.read().game.properties[3].houses).toBe(5);
    await expect(group).toContainText('This group is fully developed.');
    expect(run.read().game.properties[1].houses).toBe(5);
    expect(run.read().game.players[0].cash).toBe(1000);
    expect(run.read().game.bank).toEqual({ houses: 32, hotels: 10 });
    await expect(guest.page.locator('.scene-development .is-hotel')).toHaveCount(2);
    expect(run.commands).toHaveLength(2);
    expect(run.errors).toEqual([]);
    const width = await host.page.evaluate(() => ({ inner: innerWidth, scroll: document.documentElement.scrollWidth })); expect(width.scroll).toBe(width.inner);
  } finally { await run.close(); }
});

test('a reviewed group price cannot confirm after another financial decision changes the table', async ({ browser }) => {
  const run = await setup(browser);
  try {
    const [host, guest] = run.users; const group = await run.openGroup();
    await group.getByRole('button', { name: 'Review group build · $100', exact: true }).click();
    await guest.page.getByLabel('Send money', { exact: true }).click();
    const payment = guest.page.getByRole('dialog');
    await payment.getByLabel('Payment amount', { exact: true }).fill('1');
    await payment.getByRole('button', { name: 'Review payment', exact: true }).click();
    await payment.getByRole('button', { name: 'Send $1 to Builder', exact: true }).click();
    await expect(group).toContainText('The table changed. Go back and review');
    await expect(group.getByRole('button', { name: 'Confirm group build · $100', exact: true })).toBeDisabled();
    expect(run.commands).toHaveLength(0);
    expect(run.read().game.properties[1].houses).toBe(0);
    await group.getByRole('button', { name: 'Back', exact: true }).click();
    await group.getByRole('button', { name: 'Review group build · $100', exact: true }).click();
    await group.getByRole('button', { name: 'Confirm group build · $100', exact: true }).click();
    await expect.poll(() => run.read().game.properties[1].houses).toBe(1);
    expect(run.read().game.players[0].cash).toBe(1401);
    expect(run.commands).toHaveLength(1);
    expect(run.errors).toEqual([]);
  } finally { await run.close(); }
});
