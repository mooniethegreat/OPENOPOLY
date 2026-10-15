import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import express from 'express';
import { createApp } from '../../server/app.js';
import { createGame, applyAction } from '../../shared/engine.js';
import { getCardDecks } from '../../shared/board.js';
import { showCameraControls } from './ui-helpers.js';

let bundle;
test.beforeAll(async () => { bundle = await build({ entryPoints: ['src/main.jsx'], bundle: true, write: false, outdir: '.runtime/countdown-browser-bundle', format: 'iife', external: ['/assets/*'], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' }); });
function seedFor(first, second) {
  const next = seed => { let n = seed | 0; n ^= n << 13; n ^= n >>> 17; n ^= n << 5; return n >>> 0; };
  for (let seed = 1; seed < 1000000; seed++) { const a = next(seed), b = next(a); if (1 + Math.floor(a / 4294967296 * 6) === first && 1 + Math.floor(b / 4294967296 * 6) === second) return seed; }
  throw new Error('Missing fixture dice seed');
}
async function fixture(browser, { durationMs = 30000, jailPhase = null, doubles = false } = {}) {
  const prior = process.env.NODE_TEST_CONTEXT; let server;
  process.env.NODE_TEST_CONTEXT = 'playwright-countdown-fixture';
  try { server = createApp({ storePath: '', distPath: '', turnTimeoutMs: durationMs, presentationTiming: { rollMs: 450, stepMs: 70, settleMs: 60, cardPauseMs: 40, directMs: 100 } }); }
  finally { if (prior === undefined) delete process.env.NODE_TEST_CONTEXT; else process.env.NODE_TEST_CONTEXT = prior; }
  server.app.get('/', (request, response) => response.type('html').send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"><script defer src="/qa.js"></script></head><body><div id="root"></div></body></html>'));
  server.app.get('/qa.js', (request, response) => response.type('js').send(bundle.outputFiles.find(file => file.path.endsWith('.js')).text));
  server.app.get('/qa.css', (request, response) => response.type('css').send(bundle.outputFiles.find(file => file.path.endsWith('.css')).text));
  server.app.use(express.static('public'));
  const address = await server.listen(0, '127.0.0.1'); const origin = `http://127.0.0.1:${address.port}`;
  const post = async (pathname, body) => { const response = await fetch(origin + pathname, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); expect(response.status).toBe(201); return response.json(); };
  const host = await post('/api/rooms', { name: 'Alex', theme: 'classic', token: 'hat' });
  const guest = await post(`/api/rooms/${host.room.code}/join`, { name: 'Blair', token: 'dog' });
  server.store.transaction(data => {
    const room = data.rooms[host.room.code]; room.status = 'playing'; room.version += 1; room.decisionVersion += 1; room.game = createGame(room.players, { seed: 42, firstPlayerId: host.playerId });
    room.game._randomState = seedFor(1, 2);
    if (jailPhase) {
      const cardId = getCardDecks(room.game).chance.find(card => card.effect === 'jailCard').id;
      room.game.players[0].jailCards = ['chance']; room.game._decks.chance = room.game._decks.chance.filter(id => id !== cardId);
      if (jailPhase === 'end') { room.game._doubleCount = 2; applyAction(room.game, host.playerId, { type: 'roll' }, { dice: [1, 1] }); }
      else { room.game.players[0].inJail = true; room.game.players[0].position = 10; }
    }
    if (doubles) {
      room.game.players[0].position = 10;
      applyAction(room.game, host.playerId, { type: 'roll' }, { dice: [2, 2] });
      applyAction(room.game, host.playerId, { type: 'buy', propertyId: 14 });
    }
  });
  const contexts = [], users = [], commands = [], errors = [];
  try {
    for (const [index, user] of [host, guest].entries()) {
      const context = await browser.newContext({ baseURL: origin, viewport: index ? { width: 1440, height: 900 } : { width: 390, height: 844 }, isMobile: !index, hasTouch: !index }); contexts.push(context);
      await context.addInitScript(seat => { localStorage.setItem('monopoly-table-sessions-v2', JSON.stringify({ [seat.roomCode]: seat })); localStorage.setItem('monopoly-table-active-v2', seat.roomCode); }, { roomCode: host.room.code, playerId: user.playerId, sessionToken: user.sessionToken, name: index ? 'Blair' : 'Alex' });
      const page = await context.newPage(); users.push({ ...user, page }); page.on('pageerror', error => errors.push(error.message));
      const record = payload => { for (const part of String(payload || '').split('\x1e')) { const match = part.match(/^42\d*(\[.*\])$/s); if (!match) continue; try { const [name, command] = JSON.parse(match[1]); if (name === 'action') commands.push(command); } catch {} } };
      page.on('websocket', socket => socket.on('framesent', event => record(event.payload)));
      page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/socket.io/')) record(request.postData()); });
      await page.goto(`/?room=${host.room.code}`); await expect(page.locator('.connection')).toHaveText('CONNECTED');
    }
    return { server, users, commands, errors, read: () => server.publicRoom(server.store.data.rooms[host.room.code]), close: async () => { await Promise.all(contexts.map(context => context.close())); await server.close(); } };
  } catch (error) { await Promise.all(contexts.map(context => context.close())); await server.close(); throw error; }
}

async function hitTest(page, button) {
  await button.scrollIntoViewIfNeeded(); await expect(button).toBeEnabled();
  expect(await button.evaluate(el => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return el.contains(hit) && r.x >= 0 && r.right <= innerWidth && r.y >= 0 && r.bottom <= innerHeight; })).toBe(true);
}

test('both browsers show the shared deadline while only the server rolls and ends an idle turn', async ({ browser }, testInfo) => {
  const f = await fixture(browser, { durationMs: 4000 });
  try {
    const [host, observer] = f.users;
    const timerId = f.read().turnTimer.id;
    for (const user of f.users) { await expect(user.page.getByTestId('turn-countdown')).toContainText(/Auto-roll in 0:0[1-4]/); await expect(user.page.getByTestId('turn-countdown')).toHaveAttribute('data-turn-timer-id', timerId); await expect(user.page.getByTestId('turn-countdown')).toHaveAttribute('aria-live', 'off'); }
    const before = Number(await host.page.getByTestId('turn-countdown').getAttribute('data-remaining'));
    await expect.poll(async () => Number(await host.page.getByTestId('turn-countdown').getAttribute('data-remaining'))).toBeLessThan(before);
    await host.page.screenshot({ path: testInfo.outputPath('phone-shared-roll-countdown.png') });
    await expect(host.page.getByTestId('shared-presentation')).toBeVisible();
    for (const user of f.users) await expect(user.page.getByTestId('turn-countdown')).toHaveCount(0);
    await expect(host.page.getByTestId('shared-presentation')).toHaveCount(0, { timeout: 10000 });
    await expect(host.page.getByTestId('shared-decision')).toContainText('Property available');
    expect(f.read().turnTimer).toBeNull();
    await host.page.getByRole('button', { name: 'Buy for $60', exact: true }).click();
    for (const user of f.users) await expect(user.page.getByTestId('turn-countdown')).toContainText(/Turn ends in 0:0[1-4]/);
    await expect.poll(() => f.read().game.currentPlayerId, { timeout: 10000 }).toBe(observer.playerId);
    for (const user of f.users) await expect(user.page.getByTestId('turn-countdown')).toContainText('Auto-roll in');
    expect(f.read().game.log.filter(event => event.type === 'roll')).toHaveLength(1);
    expect(f.commands.filter(command => ['roll', 'endTurn'].includes(command.type))).toEqual([]);
    expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});

test('jail choices and the next-turn card explanation stay readable with countdowns at 390 and 320px', async ({ browser }, testInfo) => {
  for (const jailPhase of ['roll', 'end']) {
    const f = await fixture(browser, { jailPhase });
    try {
      const host = f.users[0];
      for (const width of [390, 320]) {
        await host.page.setViewportSize({ width, height: 844 });
        const decision = host.page.locator('.shared-game-decision');
        await expect(decision.getByTestId('turn-countdown')).toContainText(jailPhase === 'roll' ? 'Auto-roll in' : 'Turn ends in');
        await expect(decision.locator('.action-copy > span')).toBeVisible();
        await expect(decision.locator('.action-player-token')).toBeHidden();
        await showCameraControls(host.page);
        expect(await decision.locator('.action-copy').evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(200);
        expect(await decision.locator('.action-copy > span').evaluate(el => { const r = el.getBoundingClientRect(), panel = el.closest('.shared-game-decision').getBoundingClientRect(); return r.height <= 135 && r.top >= panel.top && r.bottom <= panel.bottom; })).toBe(true);
        const bounds = await host.page.evaluate(() => {
          const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
          return { decision: rect('.shared-game-decision'), camera: rect('.scene-camera-bar'), views: rect('.scene-view-controls'), caption: rect('.scene-location') };
        });
        const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        expect(overlaps(bounds.decision, bounds.camera)).toBe(false);
        expect(overlaps(bounds.decision, bounds.views)).toBe(false);
        expect(overlaps(bounds.caption, bounds.views)).toBe(false);
        for (const name of ['Overview', 'Follow turn', 'Rotate board', 'Top view', 'Reset camera']) await hitTest(host.page, host.page.getByRole('button', { name, exact: true }));
        if (jailPhase === 'roll') {
          await expect(decision).toContainText('Use a card before rolling');
          expect(await decision.getByRole('button', { name: 'Use Get Out of Jail Free', exact: true }).evaluate(el => { const r = el.getBoundingClientRect(); return r.width > 100 && r.height <= 70; })).toBe(true);
          for (const name of ['Pay $50', 'Use Get Out of Jail Free', 'Roll dice']) await hitTest(host.page, decision.getByRole('button', { name, exact: name !== 'Roll dice' }));
        } else {
          await expect(decision).toContainText('Going to jail ends this turn.');
          await expect(decision).toContainText('at the start of your next turn, before rolling.');
          await hitTest(host.page, decision.getByRole('button', { name: 'End turn', exact: true }));
          const observerDecision = f.users[1].page.locator('.shared-game-decision');
          await expect(observerDecision).toContainText('Alex’s turn has ended');
          await expect(observerDecision).toContainText('at the start of their next turn.');
          await expect(observerDecision.getByTestId('turn-countdown')).toContainText('Turn ends in');
        }
        await host.page.screenshot({ path: testInfo.outputPath(`jail-${jailPhase}-${width}-countdown.png`) });
        const sizes = await host.page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth })); expect(sizes.scroll).toBe(sizes.width);
      }
      if (jailPhase === 'end') {
        await host.page.getByRole('button', { name: 'End turn', exact: true }).click();
        await expect.poll(() => f.read().game.currentPlayerId).toBe(f.users[1].playerId);
      }
      expect(f.errors).toEqual([]);
    } finally { await f.close(); }
  }
});

test('the doubles instruction and roll button remain visible beside the timer on narrow screens', async ({ browser }, testInfo) => {
  const f = await fixture(browser, { doubles: true });
  try {
    const host = f.users[0];
    for (const width of [390, 320]) {
      await host.page.setViewportSize({ width, height: 844 });
      const dock = host.page.locator('.turn-action-dock');
      await expect(dock.locator('.action-copy > span')).toHaveText('Doubles. Roll again.');
      await expect(dock.locator('.action-copy > span')).toBeVisible();
      await expect(dock.getByTestId('turn-countdown')).toContainText('Auto-roll in');
      await hitTest(host.page, dock.getByRole('button', { name: 'Roll dice', exact: false }));
      const layout = await dock.evaluate(el => { const dock = el.getBoundingClientRect(); return [...el.querySelectorAll('.action-copy, .roll-button')].every(child => { const r = child.getBoundingClientRect(); return r.top >= dock.top && r.bottom <= dock.bottom && r.left >= dock.left && r.right <= dock.right; }); });
      expect(layout).toBe(true);
      expect(await host.page.evaluate(() => document.documentElement.scrollWidth === innerWidth)).toBe(true);
      await host.page.screenshot({ path: testInfo.outputPath(`doubles-${width}-countdown.png`) });
    }
    expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});
