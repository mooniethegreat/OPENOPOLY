import { test, expect } from '@playwright/test';
import { io } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import { decisionContext, prepareCommand } from '../../src/action-gate.js';
import { chooseOpenopoly } from './ui-helpers.js';

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3199';
const rollCount = room => room.game.log.filter(event => event.type === 'roll').length;
const purchaseCount = room => room.game.log.filter(event => event.type === 'purchase').length;
async function read(user) {
  const response = await user.page.request.get(`/api/rooms/${user.room.code}`, { headers: { Authorization: `Bearer ${user.sessionToken}` } });
  expect(response.ok()).toBeTruthy(); return (await response.json()).room;
}
async function idle(user) {
  await expect.poll(async () => { const state = await read(user); return !state.presentation || state.presentation.endsAt <= state.serverNow; }, { timeout: 15000 }).toBeTruthy();
  await expect(user.page.getByTestId('shared-presentation')).toHaveCount(0);
}
function recordCommands(page) {
  const commands = [];
  const record = payload => {
    for (const packet of String(payload || '').split('\x1e')) {
      const match = packet.match(/^42\d*(\[.*\])$/s);
      if (!match) continue;
      try { const [name, command] = JSON.parse(match[1]); if (name === 'action') commands.push(command); } catch { /* Other transport packets are irrelevant. */ }
    }
  };
  page.on('websocket', socket => socket.on('framesent', event => record(event.payload)));
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/socket.io/')) record(request.postData()); });
  return commands;
}
async function join(page, name, code) {
  await page.goto(code ? `/?room=${code}` : '/');
  if (!code) { await chooseOpenopoly(page); await page.getByRole('button', { name: 'Create room', exact: true }).click(); }
  await page.getByLabel('Display name', { exact: true }).fill(name);
  const response = page.waitForResponse(item => item.request().method() === 'POST' && item.url().endsWith(code ? `/api/rooms/${code}/join` : '/api/rooms'));
  await page.getByRole('button', { name: code ? 'Join room' : 'Create room', exact: true }).click();
  const result = await response; expect(result.status()).toBe(201);
  await expect(page.locator('.connection')).toHaveText('CONNECTED');
  return { page, ...await result.json() };
}
async function connectRaw(user) {
  const socket = io(baseURL, { auth: { sessionToken: user.sessionToken, roomCode: user.room.code }, transports: ['websocket'], forceNew: true, reconnection: false });
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  return socket;
}
const send = (socket, payload) => socket.timeout(8000).emitWithAck('action', payload);
const intent = (room, payload) => ({ ...payload, ...decisionContext(room), commandId: randomUUID() });
async function clickAndApply(user, locator) {
  const before = (await read(user)).decisionVersion; await locator.click();
  await expect.poll(async () => (await read(user)).decisionVersion).toBeGreaterThan(before);
}

test('an old rendered control cannot adopt the newer state received before React commits', () => {
  const shown = { code: 'FRESH1', actionProtocol: 2, decisionVersion: 3, serverNow: 1000, game: { turn: 4, phase: 'roll', currentPlayerId: 'a', permittedActions: { a: ['roll'] } } };
  const command = prepareCommand({ type: 'roll' }, shown, shown, 'a', { commandId: randomUUID(), serverTime: 1000 });
  expect(command).toMatchObject({ expectedDecisionVersion: 3, expectedTurn: 4, expectedPhase: 'roll' });
  const acked = { ...shown, decisionVersion: 4, game: { ...shown.game, phase: 'buy', pendingPurchase: 8, permittedActions: { a: ['buy', 'auction'] } } };
  expect(() => prepareCommand({ type: 'roll' }, shown, acked, 'a', { commandId: randomUUID(), serverTime: 1000 })).toThrow('The table changed');
  expect(() => prepareCommand({ type: 'buy', propertyId: 9 }, acked, acked, 'a', { commandId: randomUUID(), serverTime: 1000 })).toThrow('property decision');
  const chatOnly = { ...shown, version: 99 };
  expect(prepareCommand({ type: 'roll' }, shown, chatOnly, 'a', { commandId: randomUUID(), serverTime: 1000 }).expectedDecisionVersion).toBe(3);
});

test('two browsers reject duplicate, stale and out-of-turn commands; buy and review double clicks cannot cascade', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext({ baseURL }), browser.newContext({ baseURL })]);
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const records = pages.map(recordCommands); const errors = [];
  pages.forEach(page => page.on('pageerror', error => errors.push(error.message)));
  const raw = [];
  try {
    const users = [await join(pages[0], 'Guard A')]; users.push(await join(pages[1], 'Guard B', users[0].room.code));
    await users[0].page.getByRole('button', { name: 'Start game', exact: true }).click();
    await expect.poll(async () => (await read(users[0])).status).toBe('playing'); await idle(users[0]);
    const initial = await read(users[0]); expect(initial.actionProtocol).toBe(2);
    const actor = users.find(user => user.playerId === initial.game.currentPlayerId);
    const peer = users.find(user => user.playerId !== actor.playerId);
    const actorCommands = records[users.indexOf(actor)];
    const actorSocket = await connectRaw(actor); raw.push(actorSocket);
    const peerSocket = await connectRaw(peer); raw.push(peerSocket);
    await actor.page.getByRole('button', { name: /Roll dice/ }).dblclick();
    await expect.poll(() => actorCommands.filter(command => command.type === 'roll').length).toBe(1);
    for (const user of users) await expect(user.page.getByTestId('shared-presentation')).toBeVisible();
    const firstRoll = actorCommands.find(command => command.type === 'roll');
    const duplicate = await send(actorSocket, firstRoll); expect(duplicate).toMatchObject({ ok: true, duplicate: true, commandId: firstRoll.commandId });
    expect(rollCount(await read(actor))).toBe(1);
    await idle(actor);
    const stale = await send(actorSocket, { ...firstRoll, commandId: randomUUID() });
    expect(stale).toMatchObject({ ok: false, errorCode: 'STALE_DECISION' });
    const conflict = await send(actorSocket, { ...firstRoll, type: 'endTurn' });
    expect(conflict).toMatchObject({ ok: false, errorCode: 'COMMAND_ID_CONFLICT' });
    const current = await read(actor);
    const outOfTurn = await send(peerSocket, intent(current, { type: 'roll' })); expect(outOfTurn.ok).toBe(false);
    expect(rollCount(await read(actor))).toBe(1);

    let landing;
    for (let step = 0; step < 20; step += 1) {
      await idle(users[0]); landing = await read(users[0]);
      if (landing.game.phase === 'buy') break;
      const turn = users.find(user => user.playerId === landing.game.currentPlayerId);
      if (landing.game.phase === 'roll') await clickAndApply(turn, turn.page.getByRole('button', { name: /Roll dice/ }));
      else if (landing.game.phase === 'end') await clickAndApply(turn, turn.page.getByRole('button', { name: 'End turn', exact: true }));
      else throw new Error(`Unexpected early phase ${landing.game.phase}`);
    }
    expect(landing.game.phase).toBe('buy');
    const buyer = users.find(user => user.playerId === landing.game.currentPlayerId);
    const buyerCommands = records[users.indexOf(buyer)];
    const buyerSocket = buyer.playerId === actor.playerId ? actorSocket : peerSocket;
    const propertyId = landing.game.pendingPurchase; const cashBefore = landing.game.players.find(player => player.id === buyer.playerId).cash;
    const wrongTarget = await send(buyerSocket, intent(landing, { type: 'buy', propertyId: propertyId === 1 ? 3 : 1 })); expect(wrongTarget.ok).toBe(false);
    await buyer.page.getByRole('button', { name: /^Buy for/ }).dblclick();
    await expect.poll(async () => (await read(buyer)).game.properties[propertyId].ownerId).toBe(buyer.playerId);
    const buy = buyerCommands.findLast(command => command.type === 'buy'); expect(buy.propertyId).toBe(propertyId);
    expect((await send(buyerSocket, buy)).duplicate).toBe(true);
    const afterBuy = await read(buyer); expect(purchaseCount(afterBuy)).toBe(purchaseCount(landing) + 1);
    expect(afterBuy.game.players.find(player => player.id === buyer.playerId).cash).toBeLessThan(cashBefore);
    const eventCount = rollCount(afterBuy);
    await buyer.page.waitForTimeout(800); // Observe an enabled doubles roll without issuing another intent.
    expect(rollCount(await read(buyer))).toBe(eventCount);
    expect(purchaseCount(await read(buyer))).toBe(purchaseCount(afterBuy));

    await buyer.page.getByLabel('Send money', { exact: true }).click();
    const dialog = buyer.page.getByRole('dialog'); await dialog.getByLabel('Payment amount', { exact: true }).fill('5');
    const beforeReview = await read(buyer);
    await dialog.getByRole('button', { name: 'Review payment', exact: true }).dblclick();
    await expect(dialog).toHaveAccessibleName('Review payment');
    expect((await read(buyer)).game.players.map(player => player.cash)).toEqual(beforeReview.game.players.map(player => player.cash));
    const moneyCount = buyerCommands.filter(command => command.type === 'money:send').length;
    const confirm = dialog.getByRole('button', { name: /^Send \$5 to/ }); await confirm.focus();
    await buyer.page.keyboard.down('Enter'); await buyer.page.keyboard.down('Enter'); await buyer.page.keyboard.up('Enter');
    await expect.poll(() => buyerCommands.filter(command => command.type === 'money:send').length).toBe(moneyCount + 1);
    await expect(buyer.page.getByRole('dialog')).toHaveCount(0);
    const beforeDisconnect = await read(buyer);
    await contexts[users.indexOf(buyer)].setOffline(true);
    await expect(buyer.page.locator('.connection')).toHaveText('RECONNECTING');
    await contexts[users.indexOf(buyer)].setOffline(false);
    await expect(buyer.page.locator('.connection')).toHaveText('CONNECTED');
    const reconnected = await read(buyer);
    expect(reconnected.decisionVersion).toBe(beforeDisconnect.decisionVersion);
    expect(reconnected.game.players.map(player => player.cash)).toEqual(beforeDisconnect.game.players.map(player => player.cash));
    expect(rollCount(reconnected)).toBe(rollCount(beforeDisconnect));
    expect(errors).toEqual([]);
  } finally { raw.forEach(socket => socket.disconnect()); await Promise.all(contexts.map(context => context.close())); }
});

test('lost payment acknowledgements recover receipts; unknown reloads retry only the frozen original request', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext({ baseURL }), browser.newContext({ baseURL })]);
  const [page, other] = await Promise.all(contexts.map(context => context.newPage()));
  let mode = 'pass'; let upgradeCount = 0; let failReceipt = false; let failedReceipts = 0;
  const commands = []; const ackModes = new Map(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/commands/**', async route => {
    if (failReceipt) { failedReceipts += 1; await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Temporary receipt connection failure"}' }); }
    else await route.continue();
  });
  await page.routeWebSocket(/\/socket\.io\//, route => {
    const server = route.connectToServer();
    route.onMessage(message => {
      if (message === '5') upgradeCount += 1;
      const match = String(message).match(/^42(\d+)(\[.*\])$/s);
      if (match) {
        const [name, command] = JSON.parse(match[2]);
        if (name === 'action' && command.type === 'money:send') {
          commands.push(command); const behavior = mode; mode = 'pass';
          if (behavior === 'drop-command') { void route.close(); return; }
          ackModes.set(match[1], behavior);
        }
      }
      server.send(message);
    });
    server.onMessage(message => {
      const ack = String(message).match(/^43(\d+)\[/);
      const behavior = ack && ackModes.get(ack[1]);
      if (ack) ackModes.delete(ack[1]);
      if (behavior === 'drop-ack') return;
      if (behavior === 'drop-ack-disconnect') { void route.close(); return; }
      route.send(message);
    });
  });
  const pendingPacket = () => page.evaluate(() => Object.entries(sessionStorage).find(([key]) => key.startsWith('monopoly-pending-command-v2:'))?.[1] || null);
  try {
    const sender = await join(page, 'Receipt sender'); const recipient = await join(other, 'Receipt recipient', sender.room.code);
    await page.getByRole('button', { name: 'Start game', exact: true }).click();
    await expect.poll(async () => (await read(sender)).status).toBe('playing'); await idle(sender);
    await expect.poll(() => upgradeCount).toBeGreaterThan(0);
    const pay = async (amount, behavior) => {
      await page.getByLabel('Send money', { exact: true }).click();
      const dialog = page.getByRole('dialog'); await dialog.getByLabel('Payment amount', { exact: true }).fill(String(amount));
      await dialog.getByRole('button', { name: 'Review payment', exact: true }).click();
      mode = behavior; await dialog.getByRole('button', { name: new RegExp(`^Send \\$${amount} to`) }).click();
      return dialog;
    };
    const initial = await read(sender);
    const first = await pay(15, 'drop-ack');
    await expect.poll(() => commands.length).toBe(1);
    await expect.poll(async () => (await read(sender)).decisionVersion).toBeGreaterThan(initial.decisionVersion);
    expect(await pendingPacket()).not.toBeNull();
    // The real 12-second acknowledgement deadline triggers a read-only receipt lookup.
    await expect(first).toHaveCount(0, { timeout: 22000 });
    expect(await pendingPacket()).toBeNull();
    expect((await read(sender)).game.players.find(player => player.id === sender.playerId).cash).toBe(initial.game.players.find(player => player.id === sender.playerId).cash - 15);
    expect(commands).toHaveLength(1);

    const beforeUnknown = await read(sender); const beforeReconnect = upgradeCount;
    await pay(20, 'drop-command');
    await expect(page.getByTestId('uncertain-command').getByRole('button', { name: 'Retry same action', exact: true })).toBeEnabled({ timeout: 15000 });
    await expect.poll(() => upgradeCount).toBeGreaterThan(beforeReconnect);
    const frozen = await pendingPacket(); expect(frozen).not.toBeNull();
    expect((await read(sender)).decisionVersion).toBe(beforeUnknown.decisionVersion);
    expect(commands).toHaveLength(2);
    const beforeReload = upgradeCount; await page.reload();
    await expect(page.locator('.connection')).toHaveText('CONNECTED');
    await expect.poll(() => upgradeCount).toBeGreaterThan(beforeReload);
    await expect(page.getByTestId('uncertain-command').getByRole('button', { name: 'Retry same action', exact: true })).toBeEnabled();
    expect(await pendingPacket()).toBe(frozen);
    expect(commands).toHaveLength(2); // Reload and reconnect never resend an action.
    await expect(page.getByLabel('Send money', { exact: true })).toBeDisabled();
    await page.getByTestId('uncertain-command').getByRole('button', { name: 'Retry same action', exact: true }).click();
    await expect(page.getByTestId('uncertain-command')).toHaveCount(0);
    await expect.poll(() => commands.length).toBe(3);
    expect(commands[2]).toEqual(commands[1]);
    await expect.poll(pendingPacket).toBeNull();
    const afterUnknown = await read(sender);
    expect(afterUnknown.game.players.find(player => player.id === sender.playerId).cash).toBe(beforeUnknown.game.players.find(player => player.id === sender.playerId).cash - 20);

    // A committed payment with both a lost ACK and a failed receipt check remains locked.
    failReceipt = true; const beforeFailedReceipt = await read(sender); const beforeLastReconnect = upgradeCount;
    const last = await pay(5, 'drop-ack-disconnect');
    await expect.poll(() => upgradeCount).toBeGreaterThan(beforeLastReconnect);
    await expect(page.getByTestId('uncertain-command').getByRole('button', { name: 'Retry same action', exact: true })).toBeEnabled({ timeout: 15000 });
    await expect(last).toBeVisible();
    expect(failedReceipts).toBeGreaterThan(0);
    await expect(last.getByRole('button', { name: 'Sending…', exact: true })).toBeDisabled();
    await page.getByTestId('uncertain-command').getByRole('button', { name: 'Retry same action', exact: true }).click();
    await expect(last).toHaveCount(0);
    expect(commands).toHaveLength(5);
    expect(commands[4]).toEqual(commands[3]);
    const final = await read(sender);
    expect(final.game.players.find(player => player.id === sender.playerId).cash).toBe(beforeFailedReceipt.game.players.find(player => player.id === sender.playerId).cash - 5);
    expect(final.game.players.find(player => player.id === recipient.playerId).cash).toBe(initial.game.players.find(player => player.id === recipient.playerId).cash + 40);
    expect(await pendingPacket()).toBeNull(); expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
