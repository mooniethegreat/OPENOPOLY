import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import express from 'express';
import { readFile } from 'node:fs/promises';
import { createApp } from '../../server/app.js';
import { createUnoGame } from '../../shared/uno-engine.js';
import { createUnoDeck } from '../../shared/uno-cards.js';
import { advanceAudioFeed, eventSoundKinds } from '../../src/game-audio-events.js';

// These fixtures create their own in-memory server. They never load saved rooms
// or run the default build/server, even when the public table is already open.
let bundle, html;
test.beforeAll(async () => {
  bundle = await build({ entryPoints: ['src/main.jsx'], bundle: true, write: false, outdir: '.runtime/uno-browser-bundle', format: 'iife', external: ['/assets/*'], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  html = (await readFile('index.html', 'utf8')).replace('<script type="module" src="/src/main.jsx"></script>', '<link rel="stylesheet" href="/uno-qa.css"><script defer src="/uno-qa.js"></script>');
});

async function fixture(browser, { edition = 'classic', scenario = null, playing = true, seats = true, mobile = false, viewport = null } = {}) {
  const server = createApp({ storePath: '', distPath: '' });
  server.app.get('/', (request, response) => response.type('html').send(html));
  server.app.get('/uno-qa.js', (request, response) => response.type('js').send(bundle.outputFiles.find(file => file.path.endsWith('.js')).text));
  server.app.get('/uno-qa.css', (request, response) => response.type('css').send(bundle.outputFiles.find(file => file.path.endsWith('.css')).text));
  server.app.use(express.static('public'));
  const address = await server.listen(0, '127.0.0.1'), origin = `http://127.0.0.1:${address.port}`;
  const contexts = [], users = [], errors = [], requests = [];
  const post = async (pathname, body) => {
    const response = await fetch(origin + pathname, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect(response.status).toBe(201); return response.json();
  };
  let host, guest;
  if (seats) {
    host = await post('/api/rooms', { name: 'Alex', gameType: 'uno', rules: { edition, scoreMode: 'points' } });
    guest = await post(`/api/rooms/${host.room.code}/join`, { name: 'Blair', gameType: 'uno' });
    if (playing) server.store.transaction(data => {
      const room = data.rooms[host.room.code]; room.status = 'playing'; room.version += 1; room.decisionVersion += 1;
      room.game = createUnoGame(room.players, { seed: 42, dealerId: guest.playerId, rules: room.rules });
      if (scenario) arrange(room.game, host.playerId, guest.playerId, scenario);
    });
  }
  const open = async (user = null, options = {}) => {
    const context = await browser.newContext({ baseURL: origin, viewport: options.viewport || viewport || (mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }), isMobile: options.mobile ?? mobile, hasTouch: options.mobile ?? mobile });
    contexts.push(context);
    if (user) await context.addInitScript(seat => {
      if (sessionStorage.getItem('uno-seat-fixture')) return;
      localStorage.setItem('monopoly-table-sessions-v2', JSON.stringify({ [seat.roomCode]: seat }));
      localStorage.setItem('monopoly-table-active-v2', seat.roomCode);
      sessionStorage.setItem('uno-seat-fixture', '1');
    }, { roomCode: host.room.code, playerId: user.playerId, sessionToken: user.sessionToken, gameType: 'uno', name: user.playerId === host.playerId ? 'Alex' : 'Blair' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !message.text().includes('fonts.googleapis.com')) errors.push(`${message.text()} @ ${message.location().url}`); });
    const record = payload => {
      for (const part of String(payload || '').split('\x1e')) { const match = part.match(/^42\d*(\[.*\])$/s); if (match) try { const [name, command] = JSON.parse(match[1]); if (name === 'action') requests.push(command); } catch {} }
    };
    page.on('websocket', socket => socket.on('framesent', event => record(event.payload)));
    page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/socket.io/')) record(request.postData()); });
    await page.goto(user ? `/?room=${host.room.code}&game=uno` : '/');
    if (user) await expect(page.getByTestId(playing ? 'uno-table' : 'uno-lobby')).toBeVisible();
    users.push({ ...user, page, context }); return page;
  };
  try {
    if (seats) { await open(host); await open(guest); }
    const room = () => server.store.data.rooms[host.room.code];
    return { server, host, guest, origin, users, errors, requests, open, post, room, read: id => server.publicRoom(room(), id), close: async () => { await Promise.all(contexts.map(context => context.close())); await server.close(); } };
  } catch (error) { await Promise.all(contexts.map(context => context.close())); await server.close(); throw error; }
}

function arrange(game, hostId, guestId, scenario) {
  const deck = createUnoDeck(game.rules.edition), used = new Set();
  const take = id => { const card = deck.find(card => card.id === id); if (!card || used.has(id)) throw Error(`Invalid fixture card ${id}`); used.add(id); return card; };
  const hands = scenario === 'ohana'
    ? [['ohana-0', 'blue-7-0', 'green-2-0', 'red-5-0', 'yellow-9-0', 'red-reverse-0'], ['red-2-0', 'green-3-0', 'yellow-4-0', 'blue-6-0', 'blue-8-0', 'red-4-0', 'yellow-7-0']]
    : scenario === 'round'
      ? [['blue-7-0'], ['red-2-0', 'green-3-0', 'yellow-draw-two-0']]
      : [['blue-7-0', 'red-7-0', 'green-2-0', 'yellow-3-0', 'wild-0', 'wild-draw-four-0', 'red-skip-0'], ['red-2-0', 'green-3-0', 'yellow-4-0', 'blue-6-0', 'blue-8-0', 'red-4-0', 'yellow-7-0']];
  game._hands = { [hostId]: hands[0].map(take), [guestId]: hands[1].map(take) };
  game._discardPile = [take('blue-5-0')]; game._drawPile = deck.filter(card => !used.has(card.id));
  game.currentPlayerId = hostId; game.direction = 1; game.activeColor = 'blue'; game.phase = 'play'; game.status = 'playing';
  game.pendingColor = null; game._pendingEffect = null; game._pendingDrawFour = null; game._ohana = null; game._drawnCardId = null; game._drawnPlayerId = null;
}

const card = (page, id) => page.locator(`.uno-hand-card[data-card-id="${id}"]`);
async function playCard(page, id) { await card(page, id).click(); await page.getByRole('button', { name: /^Play card$|^Play \+ UNO!$/ }).click(); }
async function noOverflow(page) {
  const sizes = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, height: innerHeight, content: document.documentElement.scrollHeight, table: document.querySelector('.uno-room')?.getBoundingClientRect().bottom }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.width); expect(sizes.content).toBeLessThanOrEqual(sizes.height + 1);
  if (sizes.table) expect(sizes.table).toBeLessThanOrEqual(sizes.height + 1);
  if (await page.getByTestId('uno-table').count()) {
    const bounds = await page.evaluate(() => {
      const header = document.querySelector('.app-header').getBoundingClientRect(), opponents = document.querySelector('.uno-opponents').getBoundingClientRect(), tools = document.querySelector('.uno-tools').getBoundingClientRect();
      return { header: header.bottom, opponents: opponents.top, tools: tools.bottom };
    });
    expect(bounds.opponents).toBeGreaterThanOrEqual(bounds.header); expect(bounds.tools).toBeGreaterThan(sizes.height - 20);
  }
}
async function hit(page, locator) {
  await expect(locator).toBeEnabled();
  expect(await locator.evaluate(element => { const r = element.getBoundingClientRect(); return r.width >= 30 && r.height >= 30 && r.x >= 0 && r.right <= innerWidth && r.y >= 0 && r.bottom <= innerHeight && element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
}
async function capture(page, path) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images, image => image.decode().catch(() => {})));
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
  });
  await page.screenshot({ path });
}

test('chooser preserves Openopoly entry and direct UNO invites resolve the correct join screen', async ({ browser }, testInfo) => {
  const f = await fixture(browser, { playing: false });
  try {
    const page = await f.open(); await expect(page.getByRole('heading', { name: 'Choose your game.' })).toBeVisible();
    await capture(page, testInfo.outputPath('game-chooser-desktop.png'));
    await page.getByRole('button', { name: 'Play Openopoly', exact: true }).click(); await expect(page.getByRole('button', { name: 'Play game', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'All games', exact: true }).click();
    await page.getByRole('button', { name: 'Play OpenUno', exact: true }).click(); await expect(page.getByTestId('uno-welcome')).toBeVisible(); await expect(page).toHaveTitle('OpenUno');
    await page.goto(`/?room=${f.host.room.code}`);
    await expect(page.getByTestId('uno-welcome')).toBeVisible(); await expect(page.getByRole('heading', { name: 'Join a room.' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Room code' })).toHaveValue(f.host.room.code);
    await page.getByRole('textbox', { name: 'Display name' }).fill('Casey'); await page.getByRole('button', { name: 'Join room', exact: true }).last().click();
    await expect(page.getByTestId('uno-lobby')).toBeVisible(); await expect(page.locator('.uno-lobby-player')).toHaveCount(3);
    expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});

test('players create a Stitch room from the chooser, invite a second browser and deal through the lobby', async ({ browser }, testInfo) => {
  const f = await fixture(browser, { seats: false });
  try {
    const host = await f.open(), guest = await f.open(null, { viewport: { width: 390, height: 844 }, mobile: true });
    await host.getByRole('button', { name: 'Play OpenUno', exact: true }).click(); await host.getByRole('button', { name: 'Play OpenUno', exact: true }).click();
    await host.getByRole('textbox', { name: 'Display name' }).fill('Deck host'); await host.getByRole('combobox', { name: 'UNO deck' }).selectOption('stitch');
    const created = host.waitForResponse(response => response.url().endsWith('/api/rooms') && response.request().method() === 'POST');
    await host.getByRole('button', { name: 'Create room', exact: true }).last().click(); const result = await (await created).json();
    await expect(host.getByTestId('uno-lobby')).toBeVisible(); await expect(host.getByRole('button', { name: 'Start game', exact: true })).toBeDisabled();
    await guest.goto(`/?room=${result.room.code}`); await expect(guest.getByTestId('uno-welcome')).toBeVisible(); await guest.getByRole('textbox', { name: 'Display name' }).fill('Deck guest');
    await guest.getByRole('button', { name: 'Join room', exact: true }).last().click(); await expect(guest.getByTestId('uno-lobby')).toBeVisible();
    await expect(guest.getByRole('combobox', { name: 'UNO deck' })).toHaveValue('stitch'); await expect(guest.getByRole('combobox', { name: 'UNO deck' })).toBeDisabled();
    await capture(guest, testInfo.outputPath('uno-stitch-lobby-phone.png')); await capture(host, testInfo.outputPath('uno-stitch-lobby-desktop.png'));
    await host.getByRole('button', { name: 'Start game', exact: true }).click();
    for (const page of [host, guest]) { await expect(page.getByTestId('uno-table')).toBeVisible(); await expect(page.locator('.uno-hand-card')).toHaveCount(7); await expect(page).toHaveTitle('OpenUno'); }
    await guest.getByRole('button', { name: 'Room', exact: true }).click(); await expect(guest.locator('.uno-room-settings select').first()).toBeDisabled();
    expect(f.server.store.data.rooms[result.room.code].rules.edition).toBe('stitch'); expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});

for (const edition of ['classic', 'stitch']) test(`${edition}: private hands, legal selection, draw/pass and reloaded seats stay synchronized`, async ({ browser }, testInfo) => {
  const f = await fixture(browser, { edition, scenario: 'normal' });
  try {
    const [host, guest] = f.users, beforeHost = f.read(host.playerId), beforeGuest = f.read(guest.playerId);
    for (const user of f.users) {
      const own = f.read(user.playerId).game.hand.map(card => card.id), other = f.users.find(player => player.playerId !== user.playerId);
      expect(await user.page.locator('.uno-hand-card').evaluateAll(nodes => nodes.map(node => node.dataset.cardId))).toEqual(own);
      expect(await user.page.locator(`.uno-opponent[data-player-id="${other.playerId}"] .uno-card-face:not(.uno-card-back)`).count()).toBe(0);
      await expect(user.page.locator('.uno-turn-timer')).toBeVisible(); await noOverflow(user.page);
    }
    await expect(card(host.page, 'blue-7-0')).toHaveAccessibleName(/Blue 7, playable/);
    await expect(card(host.page, 'yellow-3-0')).toHaveAccessibleName(new RegExp(`${edition === 'stitch' ? 'Purple' : 'Yellow'} 3`));
    await card(host.page, 'yellow-3-0').click(); await expect(host.page.getByRole('button', { name: 'Play card', exact: true })).toBeDisabled();
    await card(host.page, 'blue-7-0').click(); await hit(host.page, host.page.getByRole('button', { name: 'Play card', exact: true }));
    await capture(host.page, testInfo.outputPath(`${edition}-table-desktop-selected.png`));
    await host.page.getByRole('button', { name: 'Play card', exact: true }).click();
    await expect.poll(() => f.room().game.currentPlayerId).toBe(guest.playerId); await expect(host.page.locator('.uno-hand-card')).toHaveCount(6);
    await expect(guest.page.getByTestId('uno-discard')).toContainText('Blue 7');
    await guest.page.getByRole('button', { name: 'Draw one', exact: true }).click();
    await expect(guest.page.getByTestId('uno-table')).toHaveAttribute('data-uno-stage', 'drawn');
    await expect(guest.page.locator('.uno-hand-card[data-playable="true"]')).toHaveCount(f.read(guest.playerId).game.playableCardIds.length);
    expect(f.read(guest.playerId).game.playableCardIds.every(id => id === f.read(guest.playerId).game.drawnCardId)).toBe(true);
    await guest.page.getByRole('button', { name: 'Pass turn', exact: true }).click(); await expect.poll(() => f.room().game.currentPlayerId).toBe(host.playerId);
    const savedHand = f.read(host.playerId).game.hand.map(card => card.id); await host.page.reload(); await expect(host.page.locator('.uno-hand-card')).toHaveCount(6);
    expect(await host.page.locator('.uno-hand-card').evaluateAll(nodes => nodes.map(node => node.dataset.cardId))).toEqual(savedHand);
    expect(await host.page.evaluate(() => JSON.parse(localStorage.getItem('monopoly-table-sessions-v2'))[new URL(location.href).searchParams.get('room')].playerId)).toBe(host.playerId);
    expect(beforeHost.game.hand).not.toEqual(beforeGuest.game.hand); expect(f.requests.filter(command => command.type === 'uno:play')).toHaveLength(1); expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});

test('wild decisions pause the countdown, challenge reveals evidence only to the challenger, and chat/reactions work', async ({ browser }, testInfo) => {
  const f = await fixture(browser, { scenario: 'normal' });
  try {
    const [host, guest] = f.users;
    await playCard(host.page, 'wild-draw-four-0');
    const choice = host.page.getByRole('dialog', { name: 'Choose the next color' }); await expect(choice).toBeVisible();
    await expect(choice.getByRole('button', { name: 'Close dialog' })).toHaveCount(0); await host.page.keyboard.press('Escape'); await expect(choice).toBeVisible();
    for (const user of f.users) await expect(user.page.locator('.uno-turn-timer')).toHaveCount(0);
    await choice.getByRole('button', { name: 'Red', exact: true }).click();
    await expect(guest.page.getByRole('button', { name: 'Challenge', exact: true })).toBeVisible();
    await guest.page.getByRole('button', { name: 'Challenge', exact: true }).click();
    const evidence = guest.page.getByRole('dialog', { name: 'Your challenge succeeded' }); await expect(evidence).toBeVisible();
    await expect(host.page.locator('.uno-evidence-cards')).toHaveCount(0); await expect(evidence.locator('.uno-card-face')).toHaveCount(6);
    await capture(guest.page, testInfo.outputPath('wild-four-private-challenge.png')); await evidence.getByRole('button', { name: 'Back to the table' }).click();
    await guest.page.getByRole('button', { name: 'Chat', exact: true }).click(); await guest.page.getByRole('textbox', { name: 'Message the table' }).fill('Ready for the next card.'); await guest.page.getByRole('button', { name: 'Send', exact: true }).click();
    await host.page.getByRole('button', { name: /^Chat/ }).click(); await expect(host.page.getByRole('log')).toContainText('Ready for the next card.');
    await host.page.getByRole('button', { name: 'Close table panel', exact: true }).last().click(); await guest.page.getByRole('button', { name: 'Close table panel', exact: true }).last().click();
    await host.page.getByRole('button', { name: 'React', exact: true }).click(); await host.page.getByRole('button', { name: 'To Everyone' }).click();
    await expect(host.page.getByRole('button', { name: 'A property…' })).toHaveCount(0);
    await host.page.getByRole('button', { name: 'Target Blair' }).click(); await host.page.getByTestId('emote-picker').getByRole('button', { name: 'Happy', exact: true }).click();
    await host.page.getByRole('button', { name: 'Send reaction', exact: true }).click();
    for (const user of f.users) await expect(user.page.getByTestId('shared-emote')).toHaveAttribute('data-emote-target', 'player');
    await expect(guest.page.getByTestId('shared-emote')).toHaveAttribute('data-target-fallback', 'false'); expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});

test('Stitch Ohana choices resolve before color selection and all hands finish with four', async ({ browser }, testInfo) => {
  const f = await fixture(browser, { edition: 'stitch', scenario: 'ohana', mobile: true });
  try {
    const [host, guest] = f.users; await playCard(host.page, 'ohana-0');
    for (const user of f.users) { await expect(user.page.getByTestId('uno-table')).toHaveAttribute('data-uno-stage', 'ohana'); await expect(user.page.locator('.uno-turn-timer')).toHaveCount(0); await expect(user.page.getByRole('dialog')).toHaveCount(0); }
    await card(host.page, 'red-5-0').click(); await expect(host.page.getByRole('button', { name: 'Discard selected' })).toBeEnabled(); await host.page.getByRole('button', { name: 'Discard selected' }).click();
    await expect(host.page.getByRole('dialog')).toHaveCount(0); await expect(host.page.locator('.uno-hand-card')).toHaveCount(4);
    for (const id of ['red-2-0', 'green-3-0', 'yellow-4-0']) await card(guest.page, id).click();
    await capture(guest.page, testInfo.outputPath('stitch-ohana-phone-selection.png')); await noOverflow(guest.page);
    await guest.page.getByRole('button', { name: 'Discard selected' }).click();
    const colors = host.page.getByRole('dialog', { name: 'Choose the next color' }); await expect(colors).toBeVisible();
    for (const user of f.users) expect(f.read(user.playerId).game.hand).toHaveLength(4);
    await colors.getByRole('button', { name: 'Purple', exact: true }).click();
    await expect.poll(() => f.room().game.currentPlayerId).toBe(guest.playerId); await expect(guest.page.locator('.uno-active-color')).toHaveText('Purple');
    await capture(guest.page, testInfo.outputPath('stitch-table-phone.png')); expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});

test('phone sizes keep the table, selectable cards and actions inside one viewport', async ({ browser }, testInfo) => {
  const f = await fixture(browser, { scenario: 'normal', mobile: true });
  try {
    const page = f.users[0].page;
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 740 }, { width: 390, height: 667 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport); await card(page, 'blue-7-0').click(); await noOverflow(page);
      const handFit = await card(page, 'blue-7-0').evaluate(element => { const r = element.getBoundingClientRect(), parent = element.closest('.uno-hand-scroll').getBoundingClientRect(); return r.top >= parent.top && r.bottom <= parent.bottom; });
      expect(handFit, `selected card is fully visible at ${viewport.width}×${viewport.height}`).toBe(true);
      await hit(page, page.getByRole('button', { name: 'Play card', exact: true })); await hit(page, page.getByRole('button', { name: 'Draw one', exact: true }));
      const pieces = await page.evaluate(() => ['.uno-opponents','.uno-table-stage','.uno-hand-area','.uno-tools'].map(selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { selector, top: r.top, bottom: r.bottom, left: r.left, right: r.right }; }));
      for (const piece of pieces) { expect(piece.left).toBeGreaterThanOrEqual(0); expect(piece.right).toBeLessThanOrEqual(viewport.width); expect(piece.bottom).toBeLessThanOrEqual(viewport.height + 1); }
      await capture(page, testInfo.outputPath(`classic-table-${viewport.width}x${viewport.height}.png`));
      if (await card(page, 'blue-7-0').getAttribute('data-selected') === 'true') await card(page, 'blue-7-0').click();
    }
    expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});

test('round scoring uses UNO results and host next-round action, with no Monopoly result overlay', async ({ browser }, testInfo) => {
  const f = await fixture(browser, { scenario: 'round' });
  try {
    const [host, guest] = f.users; await playCard(host.page, 'blue-7-0');
    for (const user of f.users) await expect(user.page.getByRole('dialog', { name: 'Alex went out!' })).toBeVisible();
    await expect(host.page.locator('.uno-result-points')).toContainText('25'); await expect(host.page.locator('.match-results')).toHaveCount(0);
    await capture(host.page, testInfo.outputPath('uno-round-results.png'));
    await expect(guest.page.getByRole('button', { name: 'Deal next round' })).toHaveCount(0); await host.page.getByRole('button', { name: 'Deal next round' }).click();
    for (const user of f.users) { await expect(user.page.getByRole('dialog')).toHaveCount(0); await expect(user.page.locator('.uno-hand-card')).toHaveCount(7); }
    expect(f.read(host.playerId).game.round).toBe(2); expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});

test('UNO audio uses canonical events and reconnect hydration does not replay past cards', async () => {
  const room = { code: 'UNO123', gameType: 'uno', version: 1, serverNow: 1000, game: { kind: 'uno', log: [{ seq: 1, id: 'e1', type: 'round-start' }] } };
  const first = advanceAudioFeed(null, room, 'p1'); expect(first.cues).toEqual([]);
  room.version = 2; room.serverNow = 1100; room.game.log.push({ seq: 2, id: 'e2', type: 'play' });
  const next = advanceAudioFeed(first.cursor, room, 'p1'); expect(next.cues.map(cue => cue.kind)).toEqual(['card']); expect(advanceAudioFeed(next.cursor, room, 'p1').cues).toEqual([]);
  expect(advanceAudioFeed(null, room, 'p1').cues).toEqual([]);
  expect(eventSoundKinds(room, 'p1', { type: 'ohana-discard' })).toEqual(['card']);
  expect(eventSoundKinds({ gameType: 'monopoly' }, 'p1', { type: 'play' })).toEqual([]);
});
