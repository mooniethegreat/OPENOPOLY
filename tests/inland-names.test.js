import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { BOARD, getBoard } from '../shared/board.js';
import { createGame } from '../shared/engine.js';
import { createApp } from '../server/app.js';
import { decisionContext } from '../server/commands.js';

const replacements = [
  [9, 'Ontario Town Square', 'Ontario Mills', 100],
  [14, 'The Green Shack Market', 'Iron and Kin Coffee Shop', 150],
  [18, 'Boomers! Upland', 'Bullwinkles', 170],
  [19, 'Santa Ana River Trail', 'Scandia', 190],
];

test('the four requested Inland names retain their IDs, source names and exact slot economics', () => {
  const board = getBoard('inland-empire');
  assert.equal(board.length, 40);
  assert.deepEqual(board.filter(space => space.customization?.kind === 'display-name').map(space => space.id), [9, 14, 18, 19]);
  for (const [id, originalName, name, price] of replacements) {
    const space = board[id], classic = BOARD[id];
    assert.equal(space.id, id); assert.equal(space.index, id);
    assert.equal(space.name, name); assert.equal(space.originalName, originalName);
    assert.equal(space.price, price); assert.equal(space.mortgage, classic.mortgage);
    assert.deepEqual(space.rents, classic.rents); assert.equal(space.houseCost, classic.houseCost);
    assert.equal(space.group, classic.group); assert.equal(space.type, classic.type);
    assert.equal(space.customization.retainedEconomics, true);
    assert.equal(space.verification.name, 'user-customization');
    assert.equal(space.verification.economics, 'classic-fallback-unverified');
    assert.equal(getBoard('classic')[id].name, classic.name);
  }
  assert.equal(board[1].name, 'The Resort'); assert.equal(board[1].price, 70);
});

test('a persisted Inland game reloads with its original seats, finances, ownership and contracts, then uses the new name in future activity', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'openopoly-inland-names-'));
  const storePath = path.join(folder, 'rooms.json');
  let server = createApp({ storePath }), socket;
  t.after(async () => { socket?.disconnect(); await server.close(); fs.rmSync(folder, { recursive: true, force: true }); });
  let address = await server.listen(0, '127.0.0.1'), origin = `http://127.0.0.1:${address.port}`;
  const post = async (route, body) => { const response = await fetch(origin + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); assert.equal(response.status, 201); return response.json(); };
  const host = await post('/api/rooms', { name: 'Saved Inland host', theme: 'inland-empire' });
  const guest = await post(`/api/rooms/${host.room.code}/join`, { name: 'Saved Inland guest' });
  server.store.transaction(data => {
    const room = data.rooms[host.room.code];
    room.game = structuredClone(createGame(room.players, { edition: 'inland', seed: 42, firstPlayerId: host.playerId }));
    // A legacy save has only the earlier Resort customization and historical messages.
    room.game.editionInfo.customizations = room.game.editionInfo.customizations.slice(0, 1);
    room.game.players[0].cash = 1234; room.game.players[1].cash = 987;
    room.game.players[0].position = 14; room.game.currentPlayerId = host.playerId;
    room.game.phase = 'buy'; room.game.pendingPurchase = 14; room.game._effects = [];
    room.game.properties[9].ownerId = guest.playerId;
    room.game.properties[18].ownerId = host.playerId; room.game.properties[18].mortgaged = true;
    room.game.properties[19].ownerId = guest.playerId;
    room.game.log.push({ id: 'historical-name', seq: ++room.game._eventSeq, type: 'move', message: 'Saved Inland host moves to The Green Shack Market.', turn: 1, at: new Date().toISOString() });
    room.status = 'playing'; room.presentation = null; room.turnTimer = null;
    room.version++; room.decisionVersion++;
  });
  await server.close();
  const before = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  server = createApp({ storePath });
  address = await server.listen(0, '127.0.0.1'); origin = `http://127.0.0.1:${address.port}`;
  const response = await fetch(`${origin}/api/rooms/${host.room.code}`, { headers: { Authorization: `Bearer ${host.sessionToken}` } });
  assert.equal(response.status, 200);
  const restored = await response.json(), savedRoom = before.rooms[host.room.code];
  assert.equal(restored.playerId, host.playerId);
  assert.deepEqual(server.store.data.sessions, before.sessions);
  assert.deepEqual(server.store.data.rooms[host.room.code].game, savedRoom.game);
  assert.deepEqual(restored.room.contracts, savedRoom.contracts);
  assert.deepEqual(restored.room.game.properties, savedRoom.game.properties);
  assert.deepEqual(restored.room.game.players.map(player => player.cash), [1234, 987]);
  for (const [id, , name] of replacements) assert.equal(getBoard(restored.room.game)[id].name, name);
  assert.equal(restored.room.game.log.at(-1).message, 'Saved Inland host moves to The Green Shack Market.');
  socket = io(origin, { auth: { roomCode: host.room.code, sessionToken: host.sessionToken }, transports: ['websocket'], reconnection: false });
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  const result = await socket.timeout(3000).emitWithAck('action', { commandId: randomUUID(), ...decisionContext(server.store.data.rooms[host.room.code]), type: 'buy', propertyId: 14 });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.room.game.properties[14].ownerId, host.playerId);
  assert.equal(result.room.game.players[0].cash, 1084);
  assert.match(result.room.game.log.findLast(event => event.type === 'purchase').message, /Iron and Kin Coffee Shop/);
  for (const id of [9, 18, 19]) assert.deepEqual(result.room.game.properties[id], savedRoom.game.properties[id]);
});
