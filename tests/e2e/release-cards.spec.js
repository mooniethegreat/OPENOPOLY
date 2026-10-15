import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { io } from 'socket.io-client';
import { createApp } from '../../server/app.js';
import { createGame, applyAction } from '../../shared/engine.js';
import { getCardDecks } from '../../shared/board.js';
import { decisionContext } from '../../src/action-gate.js';

let appBundle, appStyles;
test.beforeAll(async () => {
  const bundle = await build({
    entryPoints: ['src/main.jsx'], bundle: true, write: false, outdir: '.runtime/release-card-test-bundle',
    format: 'iife', external: ['/assets/*'], define: { 'process.env.NODE_ENV': '"production"' },
  });
  appBundle = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  appStyles = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
});

function seedFor(dice) {
  const next = seed => { let value = seed | 0; value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return value >>> 0; };
  for (let seed = 1; seed < 1000000; seed++) {
    const first = next(seed), second = next(first);
    if (1 + Math.floor(first / 0x100000000 * 6) === dice[0] && 1 + Math.floor(second / 0x100000000 * 6) === dice[1]) return seed;
  }
  throw new Error('Missing deterministic fixture dice');
}

for (const variant of [
  { theme: 'classic', edition: 'classic', width: 390, cardName: 'Get Out of Jail Free', sourceName: 'Chance' },
  { theme: 'inland-empire', edition: 'inland', width: 320, cardName: 'Leave Traffic Jam', sourceName: 'Contingency' },
]) test(`${variant.theme}: owned release cards are visible on mobile and become usable before the next jailed turn's roll`, async ({ page }) => {
  const server = createApp({ storePath: '', distPath: '' });
  server.app.get('/', (request, response) => response.type('html').send('<!doctype html><html><body><div id="root"></div></body></html>'));
  server.app.use(express.static('public'));
  const address = await server.listen(0, '127.0.0.1');
  const origin = `http://127.0.0.1:${address.port}`;
  let peer;
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    const post = async (pathname, input) => {
      const response = await fetch(origin + pathname, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      expect(response.status).toBe(201); return response.json();
    };
    const owner = await post('/api/rooms', { name: 'Card holder', theme: variant.theme });
    const other = await post(`/api/rooms/${owner.room.code}/join`, { name: 'Other player' });
    const cardId = getCardDecks(variant.edition).chance.find(card => card.effect === 'jailCard').id;
    // Only this fixture's in-memory room is seeded. Its card is obtained through
    // the real draw effect, then its third doubles roll goes through the UI.
    server.store.transaction(data => {
      const room = data.rooms[owner.room.code];
      room.status = 'playing';
      room.game = createGame(room.players, { edition: variant.edition, seed: 42, firstPlayerId: owner.playerId });
      const game = room.game;
      game._decks.chance = [cardId, ...game._decks.chance.filter(id => id !== cardId)];
      game.players[0].position = 4;
      applyAction(game, owner.playerId, { type: 'roll' }, { dice: [1, 2] });
      game.phase = 'roll'; game._resumePhase = 'roll'; game._doubleCount = 2;
      game._randomState = seedFor([1, 1]);
      game.players[1].position = 0;
    });
    await page.setViewportSize({ width: variant.width, height: 844 });
    await page.goto(`${origin}/?room=${owner.room.code}`);
    await page.evaluate(value => {
      localStorage.setItem('monopoly-table-sessions-v2', JSON.stringify({ [value.roomCode]: value }));
      localStorage.setItem('monopoly-table-active-v2', value.roomCode);
    }, { roomCode: owner.room.code, playerId: owner.playerId, sessionToken: owner.sessionToken, name: 'Card holder', theme: variant.theme });
    await page.addStyleTag({ content: appStyles });
    await page.addScriptTag({ content: appBundle });
    await expect(page.locator('.connection')).toHaveText('CONNECTED');
    const inventoryButton = page.getByTestId('card-inventory-button');
    await expect(inventoryButton).toHaveAccessibleName(`Your cards: 1 ${variant.cardName} card`);
    await page.getByRole('button', { name: /Roll dice/ }).click();
    await expect(page.getByTestId('shared-presentation')).toBeVisible();
    await expect(page.getByTestId('shared-presentation')).toHaveCount(0, { timeout: 15000 });
    await expect(page.locator('.jailed-turn-ended')).toContainText('Your turn has ended');
    await expect(page.locator('.jailed-turn-ended')).toContainText('Going to jail ends this turn.');
    await expect(page.locator('.jailed-turn-ended')).toContainText('at the start of your next turn, before rolling.');
    await inventoryButton.click();
    const inventory = page.getByTestId('card-inventory');
    await expect(inventory.getByRole('heading', { name: variant.cardName, exact: true })).toBeVisible();
    await expect(inventory).toContainText(variant.sourceName);
    await expect(inventory).toContainText('Your turn has ended.');
    const useCard = inventory.getByRole('button', { name: `Use ${variant.cardName} from ${variant.sourceName}`, exact: true });
    await expect(useCard).toBeDisabled();
    await expect(page.getByTestId('game-drawer')).toHaveCSS('opacity', '1');
    const overflow = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, hud: document.querySelector('.player-hud').getBoundingClientRect().right, card: document.querySelector('.hud-card-button').getBoundingClientRect().right }));
    expect(overflow.document).toBe(overflow.width);
    expect(overflow.hud).toBeLessThanOrEqual(overflow.width);
    expect(overflow.card).toBeLessThanOrEqual(overflow.width);
    await page.screenshot({ path: `.runtime/inspection/release-card-${variant.theme}-${variant.width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Close drawer', exact: true }).click();
    await page.getByRole('button', { name: 'End turn', exact: true }).click();
    await expect.poll(() => server.store.data.rooms[owner.room.code].game.currentPlayerId).toBe(other.playerId);
    await inventoryButton.click();
    await expect(inventory).toContainText('Use this card at the start of your next turn, before rolling.');
    await expect(useCard).toBeDisabled();

    peer = io(origin, { auth: { roomCode: owner.room.code, sessionToken: other.sessionToken }, transports: ['websocket'], reconnection: false, forceNew: true });
    await new Promise((resolve, reject) => { peer.once('connect', resolve); peer.once('connect_error', reject); });
    const sendPeer = async input => {
      const room = server.publicRoom(server.store.data.rooms[owner.room.code]);
      const result = await peer.timeout(5000).emitWithAck('action', { ...input, ...decisionContext(room), commandId: randomUUID() });
      expect(result.ok).toBe(true); return result.room;
    };
    server.store.transaction(data => { data.rooms[owner.room.code].game._randomState = seedFor([1, 2]); });
    let peerRoom = await sendPeer({ type: 'roll' });
    await expect.poll(() => server.publicRoom(server.store.data.rooms[owner.room.code]).presentation, { timeout: 15000 }).toBeNull();
    if (peerRoom.game.phase === 'buy') await sendPeer({ type: 'buy', propertyId: peerRoom.game.pendingPurchase });
    await sendPeer({ type: 'endTurn' });
    await expect(useCard).toBeEnabled();
    await expect(inventory).toContainText('Use this card now, before rolling.');
    const cashBefore = server.store.data.rooms[owner.room.code].game.players[0].cash;
    await useCard.click();
    await expect(inventoryButton).toHaveAccessibleName(`Your cards: 0 ${variant.cardName} cards`);
    await expect(inventory).toContainText(`No ${variant.cardName} cards held.`);
    const final = server.store.data.rooms[owner.room.code].game;
    expect(final.players[0].inJail).toBe(false);
    expect(final.players[0].cash).toBe(cashBefore);
    expect(final.players[0].jailCards).toEqual([]);
    expect(final._decks.chance.filter(id => id === cardId)).toHaveLength(1);
    expect(final._decks.chance.at(-1)).toBe(cardId);
    expect(final.phase).toBe('roll');
    await page.getByRole('button', { name: 'Close drawer', exact: true }).click();
    await expect(page.getByRole('button', { name: /Roll dice/ })).toBeEnabled();
    expect(errors).toEqual([]);
  } finally {
    peer?.disconnect(); await page.close(); await server.close();
  }
});
