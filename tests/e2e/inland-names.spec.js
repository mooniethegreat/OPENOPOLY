import { test, expect } from '@playwright/test';
import path from 'node:path';
import { createApp } from '../../server/app.js';
import { createGame } from '../../shared/engine.js';

test('an existing Inland seat shows the four renamed tiles and deeds without changing its saved finances', async ({ browser }, info) => {
  const server = createApp({ storePath: '', distPath: path.resolve(process.env.E2E_INLAND_DIST || 'dist') });
  const address = await server.listen(0, '127.0.0.1'), origin = `http://127.0.0.1:${address.port}`;
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1366, height: 900 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const post = async (route, body) => { const response = await page.request.post(route, { data: body }); expect(response.status()).toBe(201); return response.json(); };
    const host = await post('/api/rooms', { name: 'Saved Inland host', theme: 'inland-empire' });
    await post(`/api/rooms/${host.room.code}/join`, { name: 'Saved Inland guest' });
    server.store.transaction(data => {
      const room = data.rooms[host.room.code];
      room.game = structuredClone(createGame(room.players, { edition: 'inland', seed: 42, firstPlayerId: host.playerId }));
      room.game.editionInfo.customizations = room.game.editionInfo.customizations.slice(0, 1);
      room.game.players[0].cash = 1234;
      room.game.phase = 'buy'; room.game.pendingPurchase = 14;
      room.game.players[0].position = 14;
      room.game.properties[9].ownerId = host.playerId;
      room.status = 'playing'; room.version++; room.decisionVersion++;
    });
    const before = structuredClone(server.store.data.rooms[host.room.code].game);
    await context.addInitScript(seat => localStorage.setItem('monopoly-table-session-v1', JSON.stringify(seat)), { roomCode: host.room.code, playerId: host.playerId, sessionToken: host.sessionToken, theme: 'inland-empire', name: 'Saved Inland host' });
    await page.goto(`${origin}/?room=${host.room.code}`);
    await expect(page.locator('.connection')).toHaveText('CONNECTED');
    for (const [id, name, original, price] of [[9, 'Ontario Mills', 'Ontario Town Square', 100], [14, 'Iron and Kin Coffee Shop', 'The Green Shack Market', 150], [18, 'Bullwinkles', 'Boomers! Upland', 170], [19, 'Scandia', 'Santa Ana River Trail', 190]]) {
      const tile = page.locator(`.scene-tile[data-space-id="${id}"]`);
      await expect(tile).toHaveAttribute('aria-label', new RegExp(`^${name}, \\$${price}`));
      await tile.focus(); await page.keyboard.press('Enter');
      const deed = page.getByRole('dialog', { name, exact: true });
      await expect(deed).toBeVisible();
      await expect(deed.locator('.custom-property-note')).toContainText(`replaces ${original}`);
      await expect(deed.locator('.property-price strong')).toHaveText(`$${price}`);
      await expect(deed.locator('.research-note')).toContainText(`${name} is your custom name for ${original}.`);
      if (id === 14) await page.screenshot({ path: info.outputPath('iron-and-kin-deed-desktop.png') });
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    }
    await page.screenshot({ path: info.outputPath('inland-four-names-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    const coffeeTile = page.locator('.scene-tile[data-space-id="14"]');
    await coffeeTile.focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Iron and Kin Coffee Shop', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('iron-and-kin-deed-phone.png') });
    expect(server.store.data.rooms[host.room.code].game).toEqual(before);
    expect(errors).toEqual([]);
  } finally { await context.close(); await server.close(); }
});
