import { test, expect } from '@playwright/test';
import { showCameraControls } from './ui-helpers.js';

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3199';
const ruleName = 'Allow passing on unowned properties';
async function state(user) {
  const response = await user.page.request.get(`/api/rooms/${user.room.code}`, { headers: { Authorization: `Bearer ${user.sessionToken}` } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).room;
}

test('a host configures passing before play and two clients see a bank-held deed after a deliberate pass', async ({ browser }, info) => {
  const a = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true });
  const b = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true });
  const pageA = await a.newPage(), pageB = await b.newPage(), errors = [];
  for (const page of [pageA, pageB]) page.on('pageerror', error => errors.push(error.message));
  try {
    await pageA.goto('/');
    await pageA.getByRole('button', { name: 'Create room', exact: true }).click();
    const initialRule = pageA.getByRole('checkbox', { name: ruleName, exact: true });
    await expect(initialRule).not.toBeChecked(); await initialRule.check();
    await pageA.getByLabel('Display name', { exact: true }).fill('Passing host');
    let response = pageA.waitForResponse(r => r.url().endsWith('/api/rooms') && r.request().method() === 'POST');
    await pageA.getByRole('button', { name: 'Create room', exact: true }).click();
    const created = await response; expect(created.status()).toBe(201);
    const host = { page: pageA, ...await created.json() };
    expect(host.room.rules.allowPassingUnowned).toBe(true);
    await expect(pageA.locator('.connection')).toHaveText('CONNECTED');
    await pageA.getByRole('checkbox', { name: ruleName, exact: true }).click();
    await expect.poll(async () => (await state(host)).rules.allowPassingUnowned).toBe(false);

    await pageB.goto(`/?room=${host.room.code}`);
    await expect(pageB.getByRole('checkbox', { name: ruleName, exact: true })).toHaveCount(0);
    await pageB.getByLabel('Display name', { exact: true }).fill('Passing guest');
    response = pageB.waitForResponse(r => r.url().endsWith(`/api/rooms/${host.room.code}/join`));
    await pageB.getByRole('button', { name: 'Join room', exact: true }).click();
    const joined = await response; expect(joined.status()).toBe(201);
    const guest = { page: pageB, ...await joined.json() };
    await expect(pageB.locator('.connection')).toHaveText('CONNECTED');
    await expect(pageB.getByRole('checkbox', { name: ruleName, exact: true })).toBeDisabled();
    await expect(pageB.getByRole('checkbox', { name: ruleName, exact: true })).not.toBeChecked();
    await pageA.getByRole('checkbox', { name: ruleName, exact: true }).click();
    await expect(pageB.getByRole('checkbox', { name: ruleName, exact: true })).toBeChecked();
    await pageA.reload();
    await expect(pageA.locator('.connection')).toHaveText('CONNECTED');
    await expect(pageA.getByRole('checkbox', { name: ruleName, exact: true })).toBeChecked();
    await pageA.getByRole('button', { name: 'Start game', exact: true }).click();
    await expect.poll(async () => (await state(host)).status).toBe('playing');
    expect((await state(host)).game.rules.allowPassingUnowned).toBe(true);
    await pageB.getByLabel('Room and profile settings', { exact: true }).click();
    const locked = pageB.getByRole('dialog').getByRole('checkbox', { name: ruleName, exact: true });
    await expect(locked).toBeChecked(); await expect(locked).toBeDisabled();
    await pageB.getByRole('button', { name: 'Close dialog', exact: true }).click();

    const users = [host, guest]; let passed = false;
    for (let attempt = 0; attempt < 12 && !passed; attempt++) {
      const room = await state(host), actor = users.find(user => user.playerId === room.game.currentPlayerId);
      if (room.game.phase === 'roll') {
        await actor.page.getByRole('button', { name: /Roll dice/ }).click();
        await expect.poll(async () => (await state(host)).game.log.filter(e => e.type === 'roll').length).toBeGreaterThan(room.game.log.filter(e => e.type === 'roll').length);
      } else if (room.game.phase === 'end') {
        await actor.page.getByRole('button', { name: 'End turn', exact: true }).click();
        await expect.poll(async () => (await state(host)).game.turn).toBeGreaterThan(room.game.turn);
      } else if (room.game.phase === 'buy') {
        const passButton = actor.page.getByRole('button', { name: 'Pass — leave with bank', exact: true });
        await expect(passButton).toBeEnabled();
        const propertyId = room.game.pendingPurchase, beforeCash = room.game.players.map(p => p.cash), beforeCount = room.game.log.filter(e => e.type === 'declinePurchase').length;
        for (const width of [390, 320]) {
          await actor.page.setViewportSize({ width, height: 844 }); await showCameraControls(actor.page); await actor.page.waitForTimeout(100);
          const layout = await actor.page.evaluate(() => {
            const rotate = document.querySelector('[aria-label="Rotate board"]').getBoundingClientRect(), views = document.querySelector('.scene-view-controls').getBoundingClientRect();
            return { document: document.documentElement.scrollWidth, width: innerWidth, rotate: rotate.toJSON(), views: views.toJSON(), decision: document.querySelector('.shared-game-decision').getBoundingClientRect().toJSON(), location: document.querySelector('.scene-location').getBoundingClientRect().toJSON() };
          });
          expect(layout.document).toBe(layout.width);
          const overlap = layout.rotate.x < layout.views.right && layout.rotate.right > layout.views.x && layout.rotate.y < layout.views.bottom && layout.rotate.bottom > layout.views.y;
          expect(overlap).toBe(false);
          const intersects = (a, b) => a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
          expect(intersects(layout.rotate, layout.decision)).toBe(false);
          expect(intersects(layout.views, layout.decision)).toBe(false);
          expect(intersects(layout.views, layout.location)).toBe(false);
          const rotation = actor.page.getByRole('button', { name: 'Rotate board', exact: true });
          await rotation.click(); await expect(rotation).toHaveAttribute('aria-pressed', 'true');
          await rotation.click(); await expect(rotation).toHaveAttribute('aria-pressed', 'false');
          await actor.page.screenshot({ path: info.outputPath('pass-decision-' + width + '.png') });
        }
        await passButton.click();
        await expect.poll(async () => (await state(host)).game.log.filter(e => e.type === 'declinePurchase').length).toBe(beforeCount + 1);
        for (const user of users) {
          const after = await state(user);
          expect(after.game.properties[propertyId].ownerId).toBe(null); expect(after.game.auction).toBe(null); expect(after.game.pendingPurchase).toBe(null);
          expect(after.game.players.map(p => p.cash)).toEqual(beforeCash);
          expect(after.game.phase).toBe(room.game.doubles > 0 ? 'roll' : 'end');
          expect(after.game.currentPlayerId).toBe(room.game.currentPlayerId);
        }
        await actor.page.reload(); await expect(actor.page.locator('.connection')).toHaveText('CONNECTED');
        expect((await state(actor)).game.properties[propertyId].ownerId).toBe(null);
        passed = true;
      } else throw new Error('Unexpected opening phase: ' + room.game.phase);
    }
    expect(passed).toBe(true); expect(errors).toEqual([]);
  } finally { await a.close(); await b.close(); }
});
