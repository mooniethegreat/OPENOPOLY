import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { createApp } from '../server/app.js';
import { randomUUID } from 'node:crypto';
import { decisionContext } from '../server/commands.js';
import { reconcileTurnTimer } from '../server/turn-timers.js';

export async function fixture(t, playerCount = 2, options = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'monopoly-test-'));
  const storePath = path.join(folder, 'rooms.json');
  const { presentationTiming = { rollMs: 0, stepMs: 0, directMs: 0, settleMs: 0, cardPauseMs: 0 }, turnTimeoutMs, ...roomOptions } = options;
  const server = createApp({ storePath, presentationTiming, turnTimeoutMs });
  const address = await server.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;
  const sockets = [];
  t.after(async () => {
    for (const socket of sockets) socket.disconnect();
    await server.close();
    fs.rmSync(folder, { recursive: true, force: true });
  });
  const post = async (url, body) => {
    const response = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { response, data: await response.json() };
  };
  const first = await post('/api/rooms', { name: 'Alex', token: 'hat', ...roomOptions });
  assert.equal(first.response.status, 201, JSON.stringify(first.data));
  const users = [first.data];
  const code = first.data.room.code;
  for (let index = 1; index < playerCount; index += 1) {
    const result = await post(`/api/rooms/${code}/join`, { name: `Player ${index + 1}` });
    assert.equal(result.response.status, 201, JSON.stringify(result.data));
    users.push(result.data);
  }
  async function connect(user, overrides = {}) {
    const socket = io(base, { transports: ['websocket'], reconnection: false, auth: { roomCode: code, sessionToken: user.sessionToken, ...overrides }, forceNew: true });
    sockets.push(socket);
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    return socket;
  }
  for (const user of users) user.socket = await connect(user);
  function command(input) {
    const room = server.store.data.rooms[code];
    return { commandId: randomUUID(), ...decisionContext(room), ...(['buy', 'auction'].includes(input.type) ? { propertyId: room.game?.pendingPurchase } : {}), ...input };
  }
  async function rawAction(userIndex, input) {
    return users[userIndex].socket.timeout(3000).emitWithAck('action', input);
  }
  async function action(userIndex, input) {
    return rawAction(userIndex, command(input));
  }
  async function success(userIndex, command) {
    const result = await action(userIndex, command);
    assert.equal(result.ok, true, result.error);
    return result.room;
  }
  async function start() {
    await success(0, { type: 'room:start' });
    // The real game chooses its starter by opening rolls. Integration fixtures
    // pin a seat after creation so individual scenario assertions are stable.
    server.store.transaction(data => {
      data.rooms[code].game.currentPlayerId = users[0].playerId;
      reconcileTurnTimer(data.rooms[code], { connectedActive: true, durationMs: turnTimeoutMs });
    });
    return server.publicRoom(server.store.data.rooms[code]);
  }
  return { server, storePath, base, post, code, users, connect, action, rawAction, command, success, start };
}
