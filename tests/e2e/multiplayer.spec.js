import { test, expect } from '@playwright/test';
import { chooseOpenopoly, openGameDrawer, openGameComposer } from './ui-helpers.js';
const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3199';

async function createRoom(page, name, edition = 'classic') {
  await page.goto('/');
  await chooseOpenopoly(page);
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  if (page.viewportSize()?.width === 390) {
    expect(await page.evaluate(() => ({ layout: innerWidth, document: document.documentElement.scrollWidth }))).toEqual({ layout: 390, document: 390 });
  }
  await page.getByLabel('Display name', { exact: true }).fill(name);
  await page.getByLabel('Choose your edition').selectOption(edition);
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/rooms') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const session = await response.json();
  await expect(page.locator('.connection')).toHaveText('CONNECTED');
  return { page, ...session };
}

async function joinRoom(page, code, name) {
  await page.goto(`/?room=${code}`);
  await page.getByLabel('Display name', { exact: true }).fill(name);
  const responsePromise = page.waitForResponse(response => response.url().endsWith(`/api/rooms/${code}/join`));
  await page.getByRole('button', { name: 'Join room', exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const session = await response.json();
  await expect(page.locator('.connection')).toHaveText('CONNECTED');
  return { page, ...session };
}

async function roomState(user) {
  const response = await user.page.request.get(`/api/rooms/${user.room.code}`, { headers: { Authorization: `Bearer ${user.sessionToken}` } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).room;
}

async function startGame(host, guest) {
  const start = host.page.locator('.action-bar').getByRole('button', { name: 'Start game', exact: true });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(guest.page.getByRole('button', { name: 'Request a contract', exact: true })).toBeEnabled();
  await expect(host.page.getByLabel('Game edition')).toBeDisabled();
}

async function playUntilPurchase(users) {
  let bought = false;
  let ended = false;
  for (let step = 0; step < 30 && (!bought || !ended); step += 1) {
    const room = await roomState(users[0]);
    const user = users.find(candidate => candidate.playerId === room.game.currentPlayerId);
    const page = user.page;
    if (room.game.phase === 'roll') {
      const count = room.game.log.filter(event => event.type === 'roll').length;
      await page.getByRole('button', { name: /Roll dice/ }).click();
      await expect.poll(async () => (await roomState(user)).game.log.filter(event => event.type === 'roll').length).toBeGreaterThan(count);
    } else if (room.game.phase === 'buy') {
      const propertyId = room.game.pendingPurchase;
      await page.getByRole('button', { name: /^Buy for/ }).click();
      await expect.poll(async () => (await roomState(user)).game.properties[propertyId].ownerId).toBe(user.playerId);
      bought = true;
    } else if (room.game.phase === 'end') {
      await page.getByRole('button', { name: 'End turn', exact: true }).click();
      await expect.poll(async () => (await roomState(user)).game.turn).toBeGreaterThan(room.game.turn);
      ended = true;
    } else throw new Error(`Unexpected early-game phase: ${room.game.phase}`);
  }
  expect(bought, 'A visible purchase completed').toBeTruthy();
  expect(ended, 'A visible turn ended').toBeTruthy();
}

test('two browsers play, sign one agreement, vote, and recover their seats on reload', async ({ browser }, testInfo) => {
  const contextA = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1050 } });
  const contextB = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1050 } });
  const errors = [];
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  for (const page of [pageA, pageB]) page.on('pageerror', error => errors.push(error.message));
  try {
    const host = await createRoom(pageA, 'Avery');
    const guest = await joinRoom(pageB, host.room.code, 'Jordan');
    await expect(pageA.locator('.player-card')).toHaveCount(2);
    await startGame(host, guest);
    await pageA.getByLabel('Appearance', { exact: true }).click();
    await pageA.getByRole('dialog').getByRole('button', { name: 'Ocean', exact: true }).click();
    await pageA.getByRole('dialog').getByRole('button', { name: 'Light', exact: true }).click();
    await expect(pageA.locator('.app')).toHaveAttribute('data-palette', 'ocean');
    await expect(pageB.locator('.app')).toHaveAttribute('data-palette', 'ocean');
    await expect(pageB.locator('.app')).toHaveAttribute('data-mode', 'light');
    await pageA.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(pageA.getByLabel('Game edition')).toBeDisabled();
    await pageB.getByLabel('Appearance', { exact: true }).click();
    await expect(pageB.getByRole('dialog').getByRole('button', { name: 'Ocean', exact: true })).toBeDisabled();
    await expect(pageB.getByRole('dialog').getByRole('button', { name: 'Dark', exact: true })).toBeDisabled();
    await pageB.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await playUntilPurchase([host, guest]);
    const before = await roomState(host);
    const hostCash = before.game.players.find(player => player.id === host.playerId).cash;
    const guestCash = before.game.players.find(player => player.id === guest.playerId).cash;
    await pageA.getByRole('button', { name: 'Request a contract', exact: true }).click();
    const composer = pageA.getByRole('dialog');
    await composer.getByLabel('Contract title').fill('Forty-dollar handshake');
    await composer.getByLabel('You give cash', { exact: true }).fill('40');
    await composer.getByRole('button', { name: 'Send proposal', exact: true }).click();
    await expect(pageA.getByRole('dialog')).toHaveCount(0);
    await pageA.getByRole('button', { name: 'Sign this agreement', exact: true }).click();
    await pageB.getByRole('tab', { name: /Contracts/ }).click();
    await expect(pageB.getByRole('heading', { name: 'Forty-dollar handshake' })).toBeVisible();
    await pageB.getByRole('button', { name: 'Revise terms', exact: true }).click();
    const revision = pageB.getByRole('dialog');
    await expect(revision).toBeVisible();
    await revision.getByLabel('Contract title').fill('Forty-five-dollar handshake');
    await revision.getByLabel('Avery gives cash', { exact: true }).fill('45');
    await revision.getByRole('button', { name: 'Send revised terms', exact: true }).click();
    await expect(pageB.getByRole('dialog')).toHaveCount(0);
    await expect.poll(async () => (await roomState(host)).contracts[0].revision).toBe(2);
    const revised = await roomState(host);
    expect(revised.contracts[0].signatures).toHaveLength(0);
    expect(revised.game.players.find(player => player.id === host.playerId).cash).toBe(hostCash);
    await pageA.getByRole('button', { name: 'Sign this agreement', exact: true }).click();
    await pageB.getByRole('button', { name: 'Sign this agreement', exact: true }).click();
    await expect.poll(async () => (await roomState(host)).contracts[0].status).toBe('completed');
    const after = await roomState(host);
    expect(after.game.players.find(player => player.id === host.playerId).cash).toBe(hostCash - 45);
    expect(after.game.players.find(player => player.id === guest.playerId).cash).toBe(guestCash + 45);
    expect(after.contracts[0].signatures).toHaveLength(2);

    await pageB.getByRole('tab', { name: /Votes/ }).click();
    await pageB.getByRole('button', { name: 'New vote', exact: true }).click();
    await pageB.getByLabel('Proposal title').fill('Snack break after this round');
    await pageB.getByRole('button', { name: 'Create vote', exact: true }).click();
    await pageB.getByRole('button', { name: 'Yes', exact: true }).click();
    await pageA.getByRole('tab', { name: /Votes/ }).click();
    await pageA.getByRole('button', { name: 'Yes', exact: true }).click();
    await expect.poll(async () => (await roomState(host)).votes[0].status).toBe('approved');
    await expect(pageB.locator('.vote-card .status-badge')).toHaveText('Passed');

    await pageA.reload();
    await expect(pageA.getByText('CONNECTED', { exact: true })).toBeVisible();
    await expect(pageA.locator('.player-card')).toHaveCount(2);
    expect((await roomState(host)).contracts[0].signatures).toHaveLength(2);
    await expect(pageA.locator('.app')).toHaveAttribute('data-palette', 'ocean');
    await expect(pageA.locator('.app')).toHaveAttribute('data-mode', 'light');
    await pageA.getByLabel('Room and profile settings', { exact: true }).click();
    await pageA.getByRole('button', { name: 'Return home', exact: true }).click();
    await chooseOpenopoly(pageA);
    await expect(pageA.getByText('YOUR SAVED TABLES', { exact: true })).toBeVisible();
    await pageA.locator('.saved-tables').getByRole('link', { name: new RegExp(host.room.code) }).click();
    await expect(pageA.locator('.connection')).toHaveText('CONNECTED');
    await expect(pageA.locator('.player-card')).toHaveCount(2);
    expect((await roomState(host)).contracts[0].signatures).toHaveLength(2);
    await pageA.screenshot({ path: testInfo.outputPath('desktop-table.png'), fullPage: true });
    expect(errors).toEqual([]);
  } finally { await contextA.close(); await contextB.close(); }
});

test('the host selects Inland before play and both browsers receive its edition economics', async ({ browser }) => {
  const a = await browser.newContext({ baseURL });
  const b = await browser.newContext({ baseURL });
  try {
    const host = await createRoom(await a.newPage(), 'Inland host');
    const guest = await joinRoom(await b.newPage(), host.room.code, 'Inland guest');
    await host.page.getByLabel('Game edition').selectOption('inland-empire');
    await expect(guest.page.getByLabel('Game edition')).toHaveValue('inland-empire');
    await expect(guest.page.getByLabel('Game edition')).toBeDisabled();
    await startGame(host, guest);
    const room = await roomState(host);
    expect(room.game.edition).toBe('inland');
    expect(room.game.rules.startingCash).toBe(1630);
    // The winning Inland opening roll also moves that player; its landing can
    // already award a card payment or charge a fee before the first snapshot.
    expect(room.game.players.every(player => player.cash >= 0)).toBeTruthy();
    expect(room.game.rules.jailFee).toBe(100);
  } finally { await a.close(); await b.close(); }
});

test('mobile welcome, board, contract dialog and vote dialog stay within the viewport', async ({ browser }, testInfo) => {
  const mobile = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 });
  const other = await browser.newContext({ baseURL });
  const page = await mobile.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const fits = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && document.documentElement.scrollHeight <= window.innerHeight + 1)).toBeTruthy();
  try {
    const host = await createRoom(page, 'Mobile host');
    await fits();
    const guest = await joinRoom(await other.newPage(), host.room.code, 'Desktop friend');
    await startGame(host, guest);
    await fits();
    await expect(page.getByTestId('player-rail').locator('.player-card')).toHaveCount(2);
    const boardBox = await page.locator('.game-stage').boundingBox();
    expect(boardBox.width).toBeGreaterThan(370);
    expect(boardBox.height).toBeGreaterThanOrEqual(380);
    await page.screenshot({ path: testInfo.outputPath('mobile-board.png') });
    await openGameComposer(page, 'Request a contract');
    await expect(page.getByRole('dialog')).toBeVisible();
    const box = await page.getByRole('dialog').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(391);
    await fits();
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await openGameDrawer(page, 'Votes');
    await page.getByRole('button', { name: 'New vote', exact: true }).click();
    await expect(page.getByLabel('Proposal title')).toBeVisible();
    await fits();
    await page.screenshot({ path: testInfo.outputPath('mobile-vote.png'), fullPage: true });
    expect(errors).toEqual([]);
  } finally { await mobile.close(); await other.close(); }
});


