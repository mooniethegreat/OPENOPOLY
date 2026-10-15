import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import express from 'express';
import { createApp } from '../../server/app.js';
import { createGame } from '../../shared/engine.js';
import { handleContract } from '../../server/contracts.js';
import { openGameDrawer } from './ui-helpers.js';

async function fixture(browser, viewport) {
  const bundle = await build({ entryPoints: ['src/main.jsx'], bundle: true, write: false, outdir: '.runtime/drawer-browser-bundle', format: 'iife', external: ['/assets/*'], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  const server = createApp({ storePath: '', distPath: '' });
  server.app.get('/', (request, response) => response.type('html').send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"><script defer src="/qa.js"></script></head><body><div id="root"></div></body></html>'));
  server.app.get('/qa.js', (request, response) => response.type('js').send(bundle.outputFiles.find(file => file.path.endsWith('.js')).text));
  server.app.get('/qa.css', (request, response) => response.type('css').send(bundle.outputFiles.find(file => file.path.endsWith('.css')).text));
  server.app.use(express.static('public'));
  const address = await server.listen(0, '127.0.0.1'); const origin = `http://127.0.0.1:${address.port}`;
  const post = async (pathname, body) => { const response = await fetch(origin + pathname, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); expect(response.status).toBe(201); return response.json(); };
  const host = await post('/api/rooms', { name: 'Drawer viewer', theme: 'classic' });
  const other = await post(`/api/rooms/${host.room.code}/join`, { name: 'Other signer' });
  const ids = {};
  server.store.transaction(data => {
    const room = data.rooms[host.room.code]; room.game = createGame(room.players, { seed: 42, firstPlayerId: host.playerId }); room.status = 'playing'; room.version += 1; room.decisionVersion += 1;
    const terms = (amount = 2) => ({ transfers: [], customTerms: Array.from({ length: 22 }, (_, i) => `Term ${i + 1}: This agreed game payment covers the equipment and property arrangement described by the two players.`).join('\n'), obligations: Array.from({ length: 5 }, (_, i) => ({ debtorId: host.playerId, creditorId: other.playerId, amount, trigger: { type: 'manual', condition: `Both confirm the agreed game milestone number ${i + 1}. The agreement records this milestone for review by both players before payment.` }, repeat: false, maxOccurrences: 1 })) });
    const propose = title => { handleContract(room, host.playerId, { type: 'contract:propose', counterpartyId: other.playerId, title, terms: terms() }); return room.contracts[0]; };
    const first = propose('Older long proposal'); first.createdAt = '2026-10-01T00:00:00Z'; ids.first = first.id;
    const active = propose('Last overdue agreement'); active.createdAt = '2026-10-02T00:00:00Z'; ids.overdue = active.id;
    handleContract(room, host.playerId, { type: 'contract:sign', contractId: active.id, revision: active.revision });
    handleContract(room, other.playerId, { type: 'contract:sign', contractId: active.id, revision: active.revision });
    active.obligations[0].status = 'defaulted'; active.obligations[0].defaultReason = 'Fixture milestone payment due';
    const latest = propose('Newest long proposal'); latest.createdAt = '2026-10-03T00:00:00Z'; ids.latest = latest.id;
  });
  const context = await browser.newContext({ baseURL: origin, viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 600 });
  const errors = []; const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(seat => { localStorage.setItem('monopoly-table-sessions-v2', JSON.stringify({ [seat.roomCode]: seat })); localStorage.setItem('monopoly-table-active-v2', seat.roomCode); }, { roomCode: host.room.code, playerId: host.playerId, sessionToken: host.sessionToken, name: 'Drawer viewer' });
  await page.goto(`/?room=${host.room.code}`); await expect(page.locator('.connection')).toHaveText('CONNECTED');
  await openGameDrawer(page, 'Contracts');
  await expect(page.getByTestId('game-drawer')).toBeVisible();
  return { page, ids, errors, host, server, read: () => server.publicRoom(server.store.data.rooms[host.room.code]), close: async () => { await context.close(); await server.close(); } };
}

async function wheelToEnd(page) {
  const body = page.locator('.drawer-body'); await body.hover(); await page.mouse.wheel(0, 20000);
  await expect.poll(() => body.evaluate(el => Math.ceil(el.scrollTop + el.clientHeight) >= el.scrollHeight - 2)).toBeTruthy();
}
async function insideDrawer(page, locator) {
  const element = await locator.boundingBox(); const body = await page.locator('.drawer-body').boundingBox();
  expect(element.y).toBeGreaterThanOrEqual(body.y - 1);
  expect(element.y + element.height).toBeLessThanOrEqual(body.y + body.height + 1);
  const clipped = await locator.evaluate(el => { const card = el.closest('.contract-card'); const r = el.getBoundingClientRect(), c = card.getBoundingClientRect(); return r.bottom > c.bottom + 1 || r.top < c.top - 1; });
  expect(clipped).toBe(false);
  const reachable = await locator.evaluate(el => { const rect = el.getBoundingClientRect(); const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2); return el.contains(hit); });
  expect(reachable).toBe(true);
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`long contracts remain fully scrollable to the last actions at ${viewport.width}px`, async ({ browser }, testInfo) => {
    const f = await fixture(browser, viewport);
    try {
      const drawer = f.page.getByTestId('game-drawer');
      await expect(drawer.locator('.contract-card')).toHaveCount(3);
      await wheelToEnd(f.page);
      const last = drawer.locator(`[data-contract-id="${f.ids.overdue}"]`);
      // The overdue control is near the top of its long card. Move naturally
      // up within the drawer, rather than letting locator.click scroll a clipped card.
      const end = last.locator('.signature-list');
      await insideDrawer(f.page, end);
      await f.page.screenshot({ path: testInfo.outputPath('last-contract-bottom.png') });
      const old = drawer.locator(`[data-contract-id="${f.ids.first}"]`);
      const revise = old.getByRole('button', { name: 'Revise terms', exact: true });
      await f.page.locator('.drawer-body').hover(); await f.page.mouse.wheel(0, -Math.max(0, await last.evaluate(el => el.getBoundingClientRect().height)));
      await expect(revise).toBeInViewport(); await insideDrawer(f.page, revise);
      await revise.click(); await expect(f.page.getByRole('dialog', { name: 'Revise contract' })).toBeVisible();
      const modal = f.page.getByRole('dialog', { name: 'Revise contract' });
      const close = modal.getByRole('button', { name: 'Close dialog', exact: true });
      const submit = modal.getByRole('button', { name: 'Send revised terms', exact: true });
      await close.focus(); await f.page.keyboard.press('Shift+Tab'); await expect(submit).toBeFocused();
      await f.page.keyboard.press('Tab'); await expect(close).toBeFocused();
      await modal.locator('.modal-body').hover(); await f.page.mouse.wheel(0, 20000);
      await expect(submit).toBeInViewport();
      expect(await submit.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
      await f.page.keyboard.press('Escape');
      await expect(modal).toHaveCount(0); await expect(drawer).toBeVisible(); await expect(revise).toBeFocused();
      const sign = old.getByRole('button', { name: 'Sign this agreement', exact: true });
      await expect(sign).toBeInViewport(); await sign.click();
      await expect.poll(() => f.read().contracts.find(contract => contract.id === f.ids.first).signatures.length).toBe(1);
      const pay = last.getByRole('button', { name: 'Pay $2', exact: true });
      await pay.scrollIntoViewIfNeeded(); await insideDrawer(f.page, pay); await pay.click();
      await expect.poll(() => f.read().contracts.find(contract => contract.id === f.ids.overdue).obligations[0].status).toBe('completed');
      expect(f.read().game.players[0].cash).toBe(1498);
      await f.page.setViewportSize({ width: viewport.width === 390 ? 320 : 1366, height: viewport.width === 390 ? 568 : 768 });
      await wheelToEnd(f.page); await insideDrawer(f.page, last.locator('.signature-list'));
      await f.page.locator('.drawer-body').hover(); await f.page.mouse.wheel(0, -Math.max(0, await last.evaluate(el => el.getBoundingClientRect().height)));
      await expect(revise).toBeInViewport(); await insideDrawer(f.page, revise); await revise.click();
      await expect(f.page.getByRole('dialog', { name: 'Revise contract' })).toBeVisible();
      await f.page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(drawer.getByRole('button', { name: 'Close drawer', exact: true })).toBeInViewport();
      expect(f.errors).toEqual([]);
    } finally { await f.close(); }
  });
}
