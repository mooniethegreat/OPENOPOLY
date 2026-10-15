import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import express from 'express';
import { createApp } from '../../server/app.js';
import { createGame, applyAction } from '../../shared/engine.js';
import { getCardDecks } from '../../shared/board.js';
import { openGameDrawer, showCameraControls } from './ui-helpers.js';

let bundle;
test.beforeAll(async () => { bundle = await build({ entryPoints: ['src/main.jsx'], bundle: true, write: false, outdir: '.runtime/mobile-browser-bundle', format: 'iife', external: ['/assets/*'], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' }); });

async function fixture(browser, viewport, decision = null) {
  const server = createApp({ storePath: '', distPath: '' });
  server.app.get('/', (request, response) => response.type('html').send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/qa.css"><script defer src="/qa.js"></script></head><body><div id="root"></div></body></html>'));
  server.app.get('/qa.js', (request, response) => response.type('js').send(bundle.outputFiles.find(file => file.path.endsWith('.js')).text));
  server.app.get('/qa.css', (request, response) => response.type('css').send(bundle.outputFiles.find(file => file.path.endsWith('.css')).text));
  server.app.use(express.static('public'));
  const address = await server.listen(0, '127.0.0.1'), origin = `http://127.0.0.1:${address.port}`;
  const post = async (path, body) => { const response = await fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); expect(response.status).toBe(201); return response.json(); };
  const host = await post('/api/rooms', { name: 'Alex', theme: 'classic', token: 'hat' });
  await post(`/api/rooms/${host.room.code}/join`, { name: 'Blair', token: 'dog' });
  await post(`/api/rooms/${host.room.code}/join`, { name: 'Chloe', token: 'car' });
  server.store.transaction(data => {
    const room = data.rooms[host.room.code]; room.game = createGame(room.players, { seed: 42, firstPlayerId: host.playerId }); room.status = 'playing'; room.version += 1; room.decisionVersion += 1;
    for (const id of [1, 3]) room.game.properties[id].ownerId = host.playerId;
    const cardId = getCardDecks(room.game).chance.find(card => card.effect === 'jailCard').id;
    room.game.players[0].jailCards = ['chance']; room.game._decks.chance = room.game._decks.chance.filter(id => id !== cardId);
    if (decision === 'buy') { room.game.rules.allowPassingUnowned = true; applyAction(room.game, host.playerId, { type: 'roll' }, { dice: [1, 5] }); }
    else if (decision === 'jail-end') { room.game._doubleCount = 2; applyAction(room.game, host.playerId, { type: 'roll' }, { dice: [1, 1] }); }
    else if (decision === 'jail-roll') { room.game.players[0].inJail = true; room.game.players[0].position = 10; }
  });
  const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
  const errors = [], page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(seat => { localStorage.setItem('monopoly-table-sessions-v2', JSON.stringify({ [seat.roomCode]: seat })); localStorage.setItem('monopoly-table-active-v2', seat.roomCode); }, { roomCode: host.room.code, playerId: host.playerId, sessionToken: host.sessionToken, name: 'Alex' });
  try { await page.goto(`${origin}/?room=${host.room.code}`); await expect(page.locator('.connection')).toHaveText('CONNECTED'); }
  catch (error) { await context.close(); await server.close(); throw error; }
  return { page, errors, read: () => server.publicRoom(server.store.data.rooms[host.room.code]), close: async () => { await context.close(); await server.close(); } };
}

async function reachable(locator) {
  await locator.scrollIntoViewIfNeeded(); await expect(locator).toBeVisible();
  expect(await locator.evaluate(el => { const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return r.width >= 28 && r.height >= 28 && r.x >= 0 && r.right <= innerWidth && r.y >= 0 && r.bottom <= innerHeight && el.contains(hit); })).toBe(true);
}
async function coversViewport(locator, viewport) {
  const r = await locator.boundingBox(); expect(r.x).toBe(0); expect(r.y).toBe(0); expect(r.width).toBe(viewport.width); expect(r.height).toBe(viewport.height);
}

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
  test(`full-screen table and independent sheets remain usable at ${viewport.width}x${viewport.height}`, async ({ browser }, testInfo) => {
    const f = await fixture(browser, viewport);
    try {
      const { page } = f;
      await coversViewport(page.locator('.game-stage'), viewport);
      await expect(page.locator('main>.player-rail')).toBeHidden();
      await expect(page.getByTestId('turn-strip')).toContainText('Your turn');
      await expect(page.getByTestId('next-player')).toContainText('Blair');
      await reachable(page.getByRole('button', { name: 'Roll dice', exact: false }));
      await showCameraControls(page);
      for (const name of ['Overview', 'Follow turn', 'Rotate board', 'Top view', 'Reset camera']) await reachable(page.getByRole('button', { name, exact: true }));
      await page.getByRole('button', { name: 'Board camera controls', exact: true }).click();
      await page.screenshot({ path: testInfo.outputPath('full-screen-table.png') });
      const roster = await openGameDrawer(page, 'Players'); await coversViewport(roster, viewport);
      for (const name of ['Alex', 'Blair', 'Chloe']) await expect(roster.locator('.player-card').filter({ hasText: name })).toContainText('$1,500');
      await roster.locator('.player-card').last().scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath('players-sheet.png') });
      await reachable(roster.getByRole('button', { name: 'Close drawer', exact: true })); await roster.getByRole('button', { name: 'Close drawer', exact: true }).click();
      await page.getByRole('button', { name: 'Open game tools', exact: true }).click();
      await page.screenshot({ path: testInfo.outputPath('tools-sheet.png') });
      await page.getByRole('button', { name: 'Properties & cards', exact: true }).click();
      await expect(page.getByTestId('card-inventory')).toContainText('Get Out of Jail Free');
      await page.locator('.portfolio-property').filter({ hasText: 'Mediterranean Avenue' }).click();
      await coversViewport(page.getByRole('dialog'), viewport);
      await page.getByTestId('group-development').getByRole('button', { name: /^Review group build/ }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath('property-sheet.png') });
      await reachable(page.getByRole('button', { name: 'Close dialog', exact: true })); await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await page.getByRole('button', { name: 'Close drawer', exact: true }).click();
      const chat = await openGameDrawer(page, 'Chat'); await coversViewport(chat, viewport);
      await page.getByLabel('Message the table', { exact: true }).fill('Full-screen chat');
      await reachable(chat.getByRole('button', { name: 'Send', exact: true })); await chat.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(chat.locator('.chat-message').last()).toContainText('Full-screen chat');
      expect(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth && document.documentElement.scrollHeight === innerHeight)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('chat-sheet.png') });
      expect(f.errors).toEqual([]);
    } finally { await f.close(); }
  });

  test(`purchase and jail decisions preserve camera access at ${viewport.width}x${viewport.height}`, async ({ browser }, testInfo) => {
    for (const decision of ['buy', 'jail-roll', 'jail-end']) {
      const f = await fixture(browser, viewport, decision);
      try {
        const { page } = f, window = page.locator('.shared-game-decision');
        await coversViewport(page.locator('.game-stage'), viewport);
        await showCameraControls(page);
        for (const name of ['Overview', 'Follow turn', 'Rotate board', 'Top view', 'Reset camera']) await reachable(page.getByRole('button', { name, exact: true }));
        await page.getByRole('button', { name: 'Board camera controls', exact: true }).click();
        if (viewport.width > viewport.height) await expect.poll(() => page.evaluate(() => {
          const board = document.querySelector('.scene-board').getBoundingClientRect();
          const decision = document.querySelector('.shared-game-decision').getBoundingClientRect();
          const wallet = document.querySelector('.player-hud').getBoundingClientRect();
          return board.right <= decision.left - 8 && board.bottom <= wallet.top - 10;
        })).toBe(true);
        if (decision === 'buy') for (const name of ['Auction', 'Pass — leave with bank', 'Buy for $100']) await reachable(window.getByRole('button', { name, exact: false }));
        else if (decision === 'jail-roll') for (const name of ['Pay $50', 'Use Get Out of Jail Free', 'Roll dice']) await reachable(window.getByRole('button', { name, exact: name !== 'Roll dice' }));
        else { await expect(window).toContainText('at the start of your next turn, before rolling.'); await reachable(window.getByRole('button', { name: 'End turn', exact: true })); }
        await window.evaluate(el => { el.scrollTop = 0; });
        await page.screenshot({ path: testInfo.outputPath(`${decision}.png`) });
        expect(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth)).toBe(true);
        expect(f.errors).toEqual([]);
      } finally { await f.close(); }
    }
  });
}
