import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import express from 'express';
import { createApp } from '../../server/app.js';
import { decisionContext } from '../../src/action-gate.js';

async function recoveryFixture(page) {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(), loader: 'jsx',
      contents: `
        import React, { useEffect, useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import RecoveryBoundary, { installViewDiagnostics } from './src/RecoveryBoundary.jsx';
        installViewDiagnostics();
        window.mountCount = 0;
        window.unmountCount = 0;
        window.allowRecovery = () => { window.failRendering = false; };
        function Table() {
          const [, update] = useState(0);
          useEffect(() => {
            window.mountCount += 1;
            return () => { window.unmountCount += 1; };
          }, []);
          if (window.failRendering) throw new Error('Injected board render failure');
          return <button onClick={() => { window.failRendering = true; update(value => value + 1); }}>Trigger render failure</button>;
        }
        createRoot(document.getElementById('root')).render(<RecoveryBoundary><Table /></RecoveryBoundary>);
      `,
    },
    bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"production"' },
  });
  await page.route('http://recovery.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="root"></div></body></html>' }));
  await page.goto('http://recovery.test/?room=SAFE01');
  await page.addStyleTag({ content: await readFile('src/recovery.css', 'utf8') });
  await page.evaluate(() => {
    localStorage.setItem('monopoly-table-sessions-v2', JSON.stringify({ SAFE01: { roomCode: 'SAFE01', playerId: 'seat-a', sessionToken: 'fixture-seat-token' } }));
    localStorage.setItem('monopoly-table-active-v2', 'SAFE01');
    sessionStorage.setItem('monopoly-pending-command-v2:SAFE01:seat-a', JSON.stringify({ commandId: 'fixture-pending-command-id', type: 'money:send', amount: 25, toPlayerId: 'seat-b' }));
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await expect(page.getByRole('button', { name: 'Trigger render failure' })).toBeVisible();
}

test('a render crash shows explicit recovery and preserves the seat and pending command', async ({ page }) => {
  await recoveryFixture(page);
  const before = await page.evaluate(() => ({
    seat: localStorage.getItem('monopoly-table-sessions-v2'),
    active: localStorage.getItem('monopoly-table-active-v2'),
    pending: sessionStorage.getItem('monopoly-pending-command-v2:SAFE01:seat-a'),
  }));
  await page.getByRole('button', { name: 'Trigger render failure' }).click();
  await expect(page.getByRole('heading', { name: 'The table view stopped.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reconnect to table' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload page' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.unmountCount)).toBe(1);
  const diagnostic = await page.evaluate(() => JSON.parse(localStorage.getItem('monopoly-view-error-v1')));
  expect(diagnostic.kind).toBe('render');
  expect(diagnostic.message).toBe('Injected board render failure');
  expect(diagnostic.componentStack).toContain('Table');
  expect(JSON.stringify(diagnostic)).not.toContain('fixture-seat-token');
  expect(JSON.stringify(diagnostic)).not.toContain('fixture-pending-command-id');

  // Allowing a healthy render does not itself retry: only the explicit control
  // mounts the table again. No storage is cleared during either transition.
  await page.evaluate(() => window.allowRecovery());
  await expect(page.getByRole('heading', { name: 'The table view stopped.' })).toBeVisible();
  expect(await page.evaluate(() => window.mountCount)).toBe(1);
  await page.getByRole('button', { name: 'Reconnect to table' }).click();
  await expect(page.getByRole('button', { name: 'Trigger render failure' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.mountCount)).toBe(2);
  expect(await page.evaluate(() => ({
    seat: localStorage.getItem('monopoly-table-sessions-v2'),
    active: localStorage.getItem('monopoly-table-active-v2'),
    pending: sessionStorage.getItem('monopoly-pending-command-v2:SAFE01:seat-a'),
  }))).toEqual(before);
});

test('repeated failures stay recoverable without automatic remounts or navigation on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await recoveryFixture(page);
  await page.getByRole('button', { name: 'Trigger render failure' }).click();
  await page.getByRole('button', { name: 'Reconnect to table' }).click();
  await expect(page.getByRole('heading', { name: 'The table view stopped.' })).toBeVisible();
  expect(await page.evaluate(() => window.mountCount)).toBe(1);
  expect(page.url()).toBe('http://recovery.test/?room=SAFE01');
  await page.getByText('Error details', { exact: true }).click();
  await expect(page.locator('.view-recovery-details pre')).toContainText('Injected board render failure');
  const sizes = await page.evaluate(() => ({ viewport: innerWidth, card: document.querySelector('.view-recovery-card').getBoundingClientRect().width, overflow: document.documentElement.scrollWidth }));
  expect(sizes.card).toBeLessThanOrEqual(358);
  expect(sizes.overflow).toBe(sizes.viewport);
  await page.screenshot({ path: '.runtime/inspection/recovery-mobile.png' });
});

test('async diagnostics stay local and do not replace a healthy table', async ({ page }) => {
  await recoveryFixture(page);
  await page.evaluate(() => {
    window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason: new Error('Request failed: Bearer fixture-secret https://example.test/api?sessionToken=fixture-secret') }));
  });
  await expect(page.getByRole('button', { name: 'Trigger render failure' })).toBeVisible();
  const diagnostic = await page.evaluate(() => JSON.parse(localStorage.getItem('monopoly-view-error-v1')));
  expect(diagnostic.kind).toBe('promise');
  expect(diagnostic.message).toContain('Bearer [redacted]');
  expect(JSON.stringify(diagnostic)).not.toContain('fixture-secret');
  expect(await page.evaluate(() => window.mountCount)).toBe(1);
});

test('the recovery screen still renders when browser storage is unavailable', async ({ page }) => {
  await recoveryFixture(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Storage blocked', 'SecurityError'); };
  });
  await page.getByRole('button', { name: 'Trigger render failure' }).click();
  await expect(page.getByRole('heading', { name: 'The table view stopped.' })).toBeVisible();
  await page.getByText('Error details', { exact: true }).click();
  await expect(page.locator('.view-recovery-details pre')).toContainText('Injected board render failure');
  await page.evaluate(() => window.allowRecovery());
  await page.getByRole('button', { name: 'Reconnect to table' }).click();
  await expect(page.getByRole('button', { name: 'Trigger render failure' })).toBeVisible();
});

test('the real App restores a dropped-ACK payment receipt after boundary teardown without paying twice', async ({ page }) => {
  // The backend is entirely isolated: no saved room files or shared QA servers.
  const server = createApp({ storePath: '', distPath: '' });
  server.app.get('/', (request, response) => response.type('html').send('<!doctype html><html><body><div id="root"></div></body></html>'));
  server.app.use(express.static('public'));
  const address = await server.listen(0, '127.0.0.1');
  const origin = `http://127.0.0.1:${address.port}`;
  let raw;
  try {
    const post = async (pathname, body) => {
      const response = await fetch(origin + pathname, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      expect(response.status).toBe(201); return response.json();
    };
    const sender = await post('/api/rooms', { name: 'Boundary sender', theme: 'classic' });
    const recipient = await post(`/api/rooms/${sender.room.code}/join`, { name: 'Boundary recipient' });
    raw = io(origin, { auth: { roomCode: sender.room.code, sessionToken: sender.sessionToken }, transports: ['websocket'], reconnection: false, forceNew: true });
    await new Promise((resolve, reject) => { raw.once('connect', resolve); raw.once('connect_error', reject); });
    const started = await raw.timeout(5000).emitWithAck('action', { type: 'room:start', commandId: randomUUID(), ...decisionContext(sender.room) });
    expect(started.ok).toBe(true); raw.disconnect();
    await expect.poll(() => server.publicRoom(server.store.data.rooms[sender.room.code]).presentation, { timeout: 15000 }).toBeNull();
    const before = structuredClone(server.store.data.rooms[sender.room.code].game.players);

    const bundle = await build({
      stdin: {
        resolveDir: process.cwd(), loader: 'jsx',
        contents: `
          import React, { useEffect, useState } from 'react';
          import { createRoot } from 'react-dom/client';
          import App from './src/App.jsx';
          import RecoveryBoundary from './src/RecoveryBoundary.jsx';
          // This throwing sibling exists only inside the browser test bundle.
          // Its failure unmounts the same real App tree as any descendant crash.
          function RenderFailureProbe() {
            const [failed, setFailed] = useState(false);
            useEffect(() => {
              window.breakTableView = () => setFailed(true);
              return () => { delete window.breakTableView; };
            }, []);
            if (failed) throw new Error('Injected integrated render failure');
            return null;
          }
          createRoot(document.getElementById('root')).render(<React.StrictMode><RecoveryBoundary><App /><RenderFailureProbe /></RecoveryBoundary></React.StrictMode>);
        `,
      },
      bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' },
    });
    const moneyCommands = []; const lostAckIds = new Set(); let droppedAcks = 0; let upgrades = 0;
    await page.routeWebSocket(/\/socket\.io\//, route => {
      const transport = route.connectToServer();
      route.onMessage(message => {
        if (message === '5') upgrades += 1;
        const packet = String(message).match(/^42(\d+)(\[.*\])$/s);
        if (packet) {
          const [name, command] = JSON.parse(packet[2]);
          if (name === 'action' && command.type === 'money:send') { moneyCommands.push(command); lostAckIds.add(packet[1]); }
        }
        transport.send(message);
      });
      transport.onMessage(message => {
        const ack = String(message).match(/^43(\d+)\[/);
        if (ack && lostAckIds.delete(ack[1])) { droppedAcks += 1; return; }
        route.send(message);
      });
    });
    await page.goto(`${origin}/?room=${sender.room.code}`);
    const seat = { roomCode: sender.room.code, playerId: sender.playerId, sessionToken: sender.sessionToken, name: 'Boundary sender', theme: 'classic' };
    await page.evaluate(value => {
      localStorage.setItem('monopoly-table-sessions-v2', JSON.stringify({ [value.roomCode]: value }));
      localStorage.setItem('monopoly-table-active-v2', value.roomCode);
    }, seat);
    for (const filename of ['src/styles.css', 'src/board-scene.css', 'src/recovery.css']) await page.addStyleTag({ content: await readFile(filename, 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await expect(page.locator('.connection')).toHaveText('CONNECTED');
    await expect.poll(() => upgrades).toBeGreaterThan(0);
    const savedSeats = await page.evaluate(() => localStorage.getItem('monopoly-table-sessions-v2'));
    const pendingKey = `monopoly-pending-command-v2:${sender.room.code}:${sender.playerId}`;
    await page.getByLabel('Send money', { exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Payment amount', { exact: true }).fill('37');
    await dialog.getByRole('button', { name: 'Review payment', exact: true }).click();
    await dialog.getByRole('button', { name: /^Send \$37 to/ }).click();
    await expect.poll(() => droppedAcks).toBe(1);
    expect(moneyCommands).toHaveLength(1);
    const frozen = await page.evaluate(key => sessionStorage.getItem(key), pendingKey);
    expect(JSON.parse(frozen).commandId).toBe(moneyCommands[0].commandId);
    expect(server.store.data.rooms[sender.room.code].game.players.find(player => player.id === sender.playerId).cash).toBe(before.find(player => player.id === sender.playerId).cash - 37);

    // Crash before the acknowledgement deadline can resolve the pending packet.
    await page.evaluate(() => window.breakTableView());
    await expect(page.getByRole('heading', { name: 'The table view stopped.' })).toBeVisible();
    await expect.poll(() => server.publicRoom(server.store.data.rooms[sender.room.code]).players.find(player => player.id === sender.playerId).connected).toBe(false);
    expect(await page.evaluate(key => sessionStorage.getItem(key), pendingKey)).toBe(frozen);
    expect(await page.evaluate(() => localStorage.getItem('monopoly-table-sessions-v2'))).toBe(savedSeats);

    const receiptResponse = page.waitForResponse(response => response.url() === `${origin}/api/rooms/${sender.room.code}/commands/${moneyCommands[0].commandId}` && response.ok());
    await page.getByRole('button', { name: 'Reconnect to table' }).click();
    const receipt = await (await receiptResponse).json();
    expect(receipt.status).toBe('applied');
    expect(receipt.commandId).toBe(moneyCommands[0].commandId);
    await expect(page.locator('.connection')).toHaveText('CONNECTED');
    await expect(page.getByTestId('uncertain-command')).toHaveCount(0);
    await expect(page.getByLabel('Send money', { exact: true })).toBeEnabled();
    await expect.poll(() => page.evaluate(key => sessionStorage.getItem(key), pendingKey)).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('monopoly-table-sessions-v2'))).toBe(savedSeats);
    expect(moneyCommands).toHaveLength(1);
    const final = server.store.data.rooms[sender.room.code];
    expect(final.game.players.find(player => player.id === sender.playerId).cash).toBe(before.find(player => player.id === sender.playerId).cash - 37);
    expect(final.game.players.find(player => player.id === recipient.playerId).cash).toBe(before.find(player => player.id === recipient.playerId).cash + 37);
    expect(final.game.log.filter(event => event.type === 'moneyTransfer')).toHaveLength(1);
    expect(final._commandReceipts.filter(receipt => receipt.commandId === moneyCommands[0].commandId)).toHaveLength(1);
  } finally {
    raw?.disconnect();
    await page.close();
    await server.close();
  }
});
