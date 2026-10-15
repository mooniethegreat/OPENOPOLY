import { test, expect } from '@playwright/test';
import { getBoard } from '../../shared/board.js';
const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3199';

async function enter(page, name, code) {
  await page.goto(code ? `/?room=${code}` : '/');
  if (!code) await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await page.getByLabel('Display name', { exact: true }).fill(name);
  const result = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(code ? `/api/rooms/${code}/join` : '/api/rooms'));
  await page.getByRole('button', { name: code ? 'Join room' : 'Create room', exact: true }).click();
  const response = await result;
  expect(response.status()).toBe(201);
  await expect(page.locator('.connection')).toHaveText('CONNECTED');
  return { page, ...await response.json() };
}
async function snapshot(user) {
  const response = await user.page.request.get(`/api/rooms/${user.room.code}`, { headers: { Authorization: `Bearer ${user.sessionToken}` } });
  expect(response.ok()).toBeTruthy(); return (await response.json()).room;
}
async function idle(user) {
  await expect.poll(async () => { const room = await snapshot(user); return !room.presentation || room.presentation.endsAt <= room.serverNow; }, { timeout: 15000 }).toBeTruthy();
  await expect(user.page.getByTestId('shared-presentation')).toHaveCount(0);
}
async function setup(browser, names) {
  const contexts = await Promise.all(names.map(() => browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } })));
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const errors = []; pages.forEach(page => page.on('pageerror', error => errors.push(error.message)));
  const users = [await enter(pages[0], names[0])];
  for (let i = 1; i < pages.length; i += 1) users.push(await enter(pages[i], names[i], users[0].room.code));
  await pages[0].getByRole('button', { name: 'Start game', exact: true }).click();
  await expect(pages[0].getByTestId('turn-strip')).toContainText('TURN'); await idle(users[0]);
  return { contexts, pages, users, errors, close: () => Promise.all(contexts.map(context => context.close())) };
}
async function openDrawer(page, name) {
  const tab = page.getByRole('tab', { name: new RegExp(`^${name}`) });
  if (await tab.getAttribute('aria-selected') !== 'true') await tab.click();
  return page.getByTestId('game-drawer');
}
const cash = (room, id) => room.game.players.find(player => player.id === id).cash;
async function gameClick(user, locator) {
  const version = (await snapshot(user)).version;
  await locator.click();
  await expect.poll(async () => (await snapshot(user)).version).toBeGreaterThan(version);
}

test('roll presentation reaches three browsers while chat remains available, then direct money needs review', async ({ browser }, testInfo) => {
  const run = await setup(browser, ['Alex', 'Blair', 'Casey']);
  try {
    const [a, b] = run.users; const room = await snapshot(a);
    const actor = run.users.find(user => user.playerId === room.game.currentPlayerId);
    const watcher = run.users.find(user => user.playerId !== actor.playerId);
    await expect(actor.page.getByTestId('turn-strip')).toContainText('Your turn');
    await expect(actor.page.locator('.action-copy')).not.toContainText('Doubles');
    await expect(actor.page.getByTestId('next-player')).toContainText(room.game.players[(room.game.players.findIndex(player => player.id === actor.playerId) + 1) % room.game.players.length].name);
    await actor.page.getByRole('button', { name: /Roll dice/ }).click();
    for (const user of run.users) await expect(user.page.getByTestId('shared-presentation')).toBeVisible();
    const presentation = (await snapshot(a)).presentation;
    for (const user of run.users) expect((await snapshot(user)).presentation.id).toBe(presentation.id);
    const chat = await openDrawer(watcher.page, 'Chat');
    await chat.getByLabel('Message the table').fill('Watching the same dice');
    await chat.getByRole('button', { name: 'Send', exact: true }).click();
    await watcher.page.getByRole('button', { name: 'Close drawer', exact: true }).click();
    await idle(a);
    const received = await openDrawer(actor.page, 'Chat');
    await expect(received.locator('.chat-message')).toContainText('Watching the same dice');
    await received.getByLabel('Message the table').fill('<b>Rendered as plain text</b>');
    await received.getByLabel('Message the table').press('Enter');
    await expect(received.locator('.chat-message').last()).toContainText('<b>Rendered as plain text</b>');
    await actor.page.getByRole('button', { name: 'Close drawer', exact: true }).click();
    await expect(watcher.page.getByRole('tab', { name: /^Chat/ })).toContainText('1');
    const before = await snapshot(a);
    await a.page.getByLabel('Send money', { exact: true }).click();
    const payment = a.page.getByRole('dialog');
    await payment.getByLabel('Recipient').selectOption(b.playerId);
    await payment.getByLabel('Payment amount', { exact: true }).fill('25');
    await payment.getByLabel('Payment note').fill('Shared table payment');
    await payment.getByRole('button', { name: 'Review payment', exact: true }).click();
    expect(cash(await snapshot(a), a.playerId)).toBe(cash(before, a.playerId));
    await expect(payment).toContainText('Shared table payment');
    await payment.getByRole('button', { name: 'Send $25 to Blair', exact: true }).click();
    await expect.poll(async () => cash(await snapshot(a), b.playerId)).toBe(cash(before, b.playerId) + 25);
    for (const user of run.users) await expect(user.page.locator('.player-card').filter({ hasText: 'Blair' })).toContainText(`$${(cash(before, b.playerId) + 25).toLocaleString('en-US')}`);
    let nextTurn;
    for (let step = 0; step < 12; step += 1) {
      await idle(a); const state = await snapshot(a);
      const active = run.users.find(user => user.playerId === state.game.currentPlayerId);
      if (state.game.phase === 'buy') await gameClick(active, active.page.getByRole('button', { name: /^Buy for/ }));
      else if (state.game.phase === 'roll') await gameClick(active, active.page.getByRole('button', { name: /Roll dice/ }));
      else if (state.game.phase === 'end') {
        nextTurn = state.game.players[(state.game.players.findIndex(player => player.id === active.playerId) + 1) % state.game.players.length];
        await gameClick(active, active.page.getByRole('button', { name: 'End turn', exact: true })); break;
      } else throw new Error(`Unexpected initial phase ${state.game.phase}`);
    }
    expect(nextTurn).toBeTruthy();
    for (const user of run.users) {
      await expect(user.page.locator('.player-card.current')).toContainText(nextTurn.name);
      await expect(user.page.getByTestId('turn-strip')).toContainText(user.playerId === nextTurn.id ? 'Your turn' : `${nextTurn.name}’s turn`);
    }
    await a.page.screenshot({ path: testInfo.outputPath('shared-roll-and-payment.png') });
    expect(run.errors).toEqual([]);
  } finally { await run.close(); }
});

test('fixed-interest loan appears for everyone, stays waiting after dismissal, and schedules an exact date', async ({ browser }, testInfo) => {
  const run = await setup(browser, ['Lender', 'Borrower', 'Observer']);
  try {
    const [lender, borrower] = run.users; const [a, b, c] = run.pages;
    const before = await snapshot(lender);
    await a.getByRole('button', { name: 'Request a contract', exact: true }).click();
    const form = a.getByRole('dialog');
    await form.getByRole('button', { name: 'Loan', exact: true }).click();
    await form.getByLabel('Other player').selectOption(borrower.playerId);
    await form.getByLabel('Loan principal', { exact: true }).fill('200');
    await form.getByLabel('Add fixed interest').check();
    await form.getByLabel('Interest rate (%)', { exact: true }).fill('10');
    await form.getByLabel('Repayment trigger').selectOption('atTime');
    const due = await a.evaluate(() => { const at = new Date(Date.now() + 5 * 60000); return new Date(at.getTime() - at.getTimezoneOffset() * 60000).toISOString().slice(0, 16); });
    await form.getByLabel('Due date and time').fill(due);
    await form.getByLabel('Contract title').fill('Five-minute loan');
    await expect(form.getByTestId('agreement-preview')).toContainText('$220');
    await form.getByRole('button', { name: 'Send proposal', exact: true }).click();
    for (const page of run.pages) {
      await expect(page.getByTestId('contract-announcement')).toContainText('Five-minute loan');
      await expect(page.getByTestId('contract-announcement')).toContainText('$220');
    }
    await expect(c.getByTestId('contract-announcement').getByRole('button', { name: 'Sign this agreement', exact: true })).toHaveCount(0);
    await c.getByRole('button', { name: 'Dismiss contract notice', exact: true }).click();
    await expect(c.getByTestId('pending-agreements')).toContainText('1 waiting agreement');
    await a.getByTestId('contract-announcement').getByRole('button', { name: 'Sign this agreement', exact: true }).click();
    await expect(b.getByTestId('contract-announcement')).toContainText('Waiting for Borrower to sign');
    await c.getByTestId('pending-agreements').getByRole('button', { name: 'Review', exact: true }).click();
    await expect(c.getByTestId('contract-announcement')).toContainText('Waiting for Borrower to sign');
    await c.screenshot({ path: testInfo.outputPath('observer-waiting-for-signature.png') });
    await b.getByTestId('contract-announcement').getByRole('button', { name: 'Sign this agreement', exact: true }).click();
    await expect.poll(async () => (await snapshot(lender)).contracts[0].status).toBe('active');
    const after = await snapshot(lender); const contract = after.contracts[0];
    expect(contract.terms.finance).toMatchObject({ principal: 200, interestBps: 1000, interest: 20, totalOwed: 220 });
    expect(contract.obligations[0]).toMatchObject({ amount: 220, repeat: false, trigger: { type: 'atTime' } });
    expect(cash(after, lender.playerId)).toBe(cash(before, lender.playerId) - 200);
    expect(cash(after, borrower.playerId)).toBe(cash(before, borrower.playerId) + 200);
    await expect(c.getByTestId('pending-agreements')).toHaveCount(0);
    expect(run.errors).toEqual([]);
  } finally { await run.close(); }
});

test('selling a deed can transfer cash now and schedule the unpaid price with fixed interest', async ({ browser }) => {
  const run = await setup(browser, ['Seller', 'Buyer']);
  try {
    let room;
    for (let step = 0; step < 30; step += 1) {
      await idle(run.users[0]); room = await snapshot(run.users[0]);
      if (room.game.phase === 'end' && Object.values(room.game.properties).some(property => property.ownerId)) break;
      const actor = run.users.find(user => user.playerId === room.game.currentPlayerId);
      if (room.game.phase === 'roll') await gameClick(actor, actor.page.getByRole('button', { name: /Roll dice/ }));
      else if (room.game.phase === 'buy') await gameClick(actor, actor.page.getByRole('button', { name: /^Buy for/ }));
      else if (room.game.phase === 'end') await gameClick(actor, actor.page.getByRole('button', { name: 'End turn', exact: true }));
      else throw new Error(`Unexpected early phase ${room.game.phase}`);
    }
    const [propertyId, deed] = Object.entries(room.game.properties).find(([, property]) => property.ownerId);
    const seller = run.users.find(user => user.playerId === deed.ownerId);
    const buyer = run.users.find(user => user.playerId !== seller.playerId);
    const before = await snapshot(seller);
    await seller.page.getByRole('button', { name: 'Request a contract', exact: true }).click();
    const form = seller.page.getByRole('dialog');
    await form.getByRole('button', { name: 'Buy / sell property', exact: true }).click();
    await form.getByLabel('Schedule an unpaid property price for later').check();
    await form.getByLabel('Unpaid property price', { exact: true }).fill('100');
    await form.getByLabel('Add fixed interest').check();
    await form.getByLabel('Interest rate (%)', { exact: true }).fill('5');
    await form.getByLabel(getBoard(room.game)[Number(propertyId)].name, { exact: true }).check();
    const buyerName = before.game.players.find(player => player.id === buyer.playerId).name;
    await form.getByLabel(`${buyerName} gives cash`, { exact: true }).fill('25');
    await expect(form.getByTestId('agreement-preview')).toContainText('$105');
    await form.getByRole('button', { name: 'Send proposal', exact: true }).click();
    for (const user of [seller, buyer]) await user.page.getByTestId('contract-announcement').getByRole('button', { name: 'Sign this agreement', exact: true }).click();
    await expect.poll(async () => (await snapshot(seller)).contracts[0].status).toBe('active');
    const after = await snapshot(seller);
    expect(after.game.properties[propertyId].ownerId).toBe(buyer.playerId);
    expect(cash(after, seller.playerId)).toBe(cash(before, seller.playerId) + 25);
    expect(after.contracts[0].obligations[0]).toMatchObject({ amount: 105, status: 'pending' });
    const contracts = await openDrawer(seller.page, 'Contracts');
    await expect(contracts).toContainText('Due on table turn');
    expect(run.errors).toEqual([]);
  } finally { await run.close(); }
});
