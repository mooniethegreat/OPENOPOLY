import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { io } from 'socket.io-client';
import { createApp } from '../server/app.js';
import { fixture } from './server-helpers.js';

test('HTTP guest sessions and sockets enforce identity, private state, and host controls', async t => {
  const f = await fixture(t);
  const denied = await fetch(`${f.base}/api/rooms/${f.code}`);
  assert.equal(denied.status, 400);
  const forgedHost = await f.action(1, { type: 'room:start', playerId: f.users[0].playerId });
  assert.equal(forgedHost.ok, false);
  assert.match(forgedHost.error, /host/);
  const room = await f.start();
  assert.equal(room.game.players.length, 2);
  assert.equal(room.game.players[0].token, 'hat');
  assert.equal(room.game._decks, undefined);
  assert.equal(room.game._randomState, undefined);
  assert.equal(room.game._effects, undefined);
  const forgedDice = await f.action(0, { type: 'roll', dice: [6, 6] });
  assert.equal(forgedDice.ok, false);
  assert.match(forgedDice.error, /dice/);
  const outOfTurn = await f.action(1, { type: 'roll' });
  assert.equal(outOfTurn.ok, false);
  const editionChange = await f.action(0, { type: 'room:theme', theme: 'inland-empire' });
  assert.equal(editionChange.ok, false);
  assert.match(editionChange.error, /locked/);
  const joinedLate = await f.post(`/api/rooms/${f.code}/join`, { name: 'Late player' });
  assert.equal(joinedLate.response.status, 400);
  const resumed = await f.post(`/api/rooms/${f.code}/join`, { sessionToken: f.users[0].sessionToken });
  assert.equal(resumed.data.playerId, f.users[0].playerId);
  assert.equal(resumed.data.room.game.players.length, 2);
});

test('multiple sockets reconnect to the same persisted player without duplicating seats', async t => {
  const f = await fixture(t);
  await f.start();
  f.users[0].socket.disconnect();
  const reconnect = await f.connect(f.users[0]);
  const result = await reconnect.timeout(3000).emitWithAck('action', f.command({ type: 'vote:propose', title: 'Take a break?', details: '', rule: 'majority' }));
  assert.equal(result.ok, true);
  assert.equal(result.room.players.length, 2);
  assert.equal(result.room.votes[0].proposerId, f.users[0].playerId);
  assert.equal(result.room.players.find(p => p.id === f.users[0].playerId).connected, true);
  const text = fs.readFileSync(f.storePath, 'utf8');
  assert.equal(text.includes(f.users[0].sessionToken), false, 'Only token hashes may be persisted');
  await f.server.close();
  const restarted = createApp({ storePath: f.storePath });
  t.after(() => restarted.close());
  const address = await restarted.listen(0, '127.0.0.1');
  const response = await fetch(`http://127.0.0.1:${address.port}/api/rooms/${f.code}`, { headers: { Authorization: `Bearer ${f.users[0].sessionToken}` } });
  const restored = await response.json();
  assert.equal(restored.playerId, f.users[0].playerId);
  assert.equal(restored.room.game.turn, 1);
  assert.equal(restored.room.votes[0].title, 'Take a break?');
});

test('wrong-room credentials cannot read a room or open a socket', async t => {
  const f = await fixture(t);
  const foreign = await f.post('/api/rooms', { name: 'Other host' });
  const response = await fetch(`${f.base}/api/rooms/${f.code}`, { headers: { Authorization: `Bearer ${foreign.data.sessionToken}` } });
  assert.equal(response.status, 400);
  const socket = io(f.base, { transports: ['websocket'], reconnection: false, auth: { roomCode: f.code, sessionToken: foreign.data.sessionToken }, forceNew: true });
  t.after(() => socket.disconnect());
  const error = await new Promise(resolve => socket.once('connect_error', resolve));
  assert.match(error.message, /cannot access/);
});

test('host transfers and edition changes broadcast in lobby; Inland rooms cap at six', async t => {
  const f = await fixture(t, 6, { theme: 'inland-empire' });
  const overCapacity = await f.post(`/api/rooms/${f.code}/join`, { name: 'Seventh' });
  assert.equal(overCapacity.response.status, 400);
  let room = await f.success(0, { type: 'room:transfer-host', playerId: f.users[1].playerId });
  assert.equal(room.hostId, f.users[1].playerId);
  assert.equal((await f.action(0, { type: 'room:theme', theme: 'classic' })).ok, false);
  room = await f.success(1, { type: 'room:theme', theme: 'classic' });
  assert.equal(room.theme, 'classic');
  const joined = await f.post(`/api/rooms/${f.code}/join`, { name: 'Seventh' });
  assert.equal(joined.response.status, 201);
  assert.equal((await f.action(1, { type: 'room:theme', theme: 'inland-empire' })).ok, false);
});

test('anytime majority and unanimous votes use fixed eligible voters and one ballot each', async t => {
  const f = await fixture(t, 3);
  await f.start();
  let room = await f.success(2, { type: 'vote:propose', title: 'Dinner break', details: 'After this round', rule: 'majority' });
  const id = room.votes[0].id;
  room = await f.success(0, { type: 'vote:cast', voteId: id, choice: 'yes' });
  assert.equal(room.votes[0].status, 'open');
  assert.equal((await f.action(0, { type: 'vote:cast', voteId: id, choice: 'yes' })).ok, false);
  room = await f.success(1, { type: 'vote:cast', voteId: id, choice: 'yes' });
  assert.equal(room.votes[0].status, 'approved');
  room = await f.success(0, { type: 'vote:propose', title: 'Agree unanimously', details: '', rule: 'unanimous' });
  room = await f.success(2, { type: 'vote:cast', voteId: room.votes[0].id, choice: 'no' });
  assert.equal(room.votes[0].status, 'rejected');
  room = await f.success(1, { type: 'vote:propose', title: 'Expires', rule: 'majority' });
  f.server.store.transaction(data => { data.rooms[f.code].votes[0].expiresAt = '2000-01-01T00:00:00.000Z'; });
  assert.equal((await f.action(1, { type: 'vote:cast', voteId: room.votes[0].id, choice: 'yes' })).ok, false);
  room = await f.success(0, { type: 'vote:propose', title: 'New proposal', rule: 'majority' });
  assert.equal(room.votes[1].status, 'expired');
});

test('all eight pictured UI pieces can be chosen and keep their exact identifiers', async t => {
  const f = await fixture(t, 1);
  const tokens = ['hat', 'car', 'dog', 'ship', 'cat', 'penguin', 'thimble', 'duck'];
  assert.equal(f.users[0].room.players[0].token, tokens[0]);
  let room;
  for (const token of tokens.slice(1)) {
    const joined = await f.post(`/api/rooms/${f.code}/join`, { name: `Piece ${token}`, token });
    assert.equal(joined.response.status, 201, joined.data.error);
    room = joined.data.room;
    assert.equal(room.players.find(player => player.id === joined.data.playerId).token, token, 'The chosen piece must not silently fall back');
  }
  assert.deepEqual(new Set(room.players.map(player => player.token)), new Set(tokens));
  const started = await f.start();
  assert.deepEqual(new Set(started.game.players.map(player => player.token)), new Set(tokens));
});

test('host appearance changes persist and broadcast during play while edition stays locked', async t => {
  const f = await fixture(t, 2, { appearance: { palette: 'slate', mode: 'light' } });
  assert.deepEqual(f.users[0].room.appearance, { palette: 'slate', mode: 'light' });
  await f.start();
  const denied = await f.action(1, { type: 'room:appearance', appearance: { palette: 'ocean', mode: 'dark' } });
  assert.equal(denied.ok, false);
  assert.match(denied.error, /host/);
  assert.equal((await f.action(0, { type: 'room:appearance', appearance: { palette: 'unknown', mode: 'dark' } })).ok, false);
  const broadcast = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Guest did not receive appearance broadcast')), 3000);
    const onState = room => {
      if (room.appearance?.palette !== 'burgundy') return;
      clearTimeout(timer);
      f.users[1].socket.off('room:state', onState);
      resolve(room);
    };
    f.users[1].socket.on('room:state', onState);
  });
  const room = await f.success(0, { type: 'room:appearance', appearance: { palette: 'burgundy', mode: 'dark' } });
  assert.deepEqual((await broadcast).appearance, { palette: 'burgundy', mode: 'dark' });
  assert.equal(room.theme, 'classic');
  assert.equal(room.game.turn, 1);
  assert.equal((await f.action(0, { type: 'room:theme', theme: 'inland-empire' })).ok, false);
  const saved = JSON.parse(fs.readFileSync(f.storePath, 'utf8'));
  assert.deepEqual(saved.rooms[f.code].appearance, room.appearance);
  f.server.store.transaction(data => {
    data.rooms[f.code].status = 'finished';
    data.rooms[f.code].game.status = 'finished';
  });
  assert.equal((await f.action(0, { type: 'room:appearance', appearance: { palette: 'forest', mode: 'light' } })).ok, true);
  f.server.store.transaction(data => { delete data.rooms[f.code].appearance; });
  const response = await fetch(`${f.base}/api/rooms/${f.code}`, { headers: { Authorization: `Bearer ${f.users[0].sessionToken}` } });
  assert.deepEqual((await response.json()).room.appearance, { palette: 'graphite', mode: 'dark' });
});

test('new rooms default to neutral Graphite while only the host can change shared appearance and explicit saved palettes persist', async t => {
  const f = await fixture(t, 2);
  for (const user of f.users) assert.deepEqual(user.room.appearance, { palette: 'graphite', mode: 'dark' });
  await f.start();
  const before = structuredClone(f.server.store.data.rooms[f.code]);
  const denied = await f.action(1, { type: 'room:appearance', appearance: { palette: 'graphite', mode: 'light' } });
  assert.equal(denied.ok, false); assert.match(denied.error, /host/);
  const broadcast = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Guest did not receive the Graphite update')), 2000);
    const receive = room => {
      if (room.appearance.palette !== 'graphite' || room.appearance.mode !== 'light') return;
      clearTimeout(timer); f.users[1].socket.off('room:state', receive); resolve(room);
    };
    f.users[1].socket.on('room:state', receive);
  });
  const updated = await f.success(0, { type: 'room:appearance', appearance: { palette: 'graphite', mode: 'light' } });
  assert.deepEqual((await broadcast).appearance, { palette: 'graphite', mode: 'light' });
  assert.equal(updated.decisionVersion, before.decisionVersion); assert.deepEqual(updated.turnTimer, before.turnTimer);
  assert.deepEqual(f.server.store.data.rooms[f.code].game, before.game);
  for (const palette of ['forest', 'slate', 'ocean', 'burgundy']) {
    const chosen = { palette, mode: 'light' };
    await f.success(0, { type: 'room:appearance', appearance: chosen });
    const saved = JSON.parse(fs.readFileSync(f.storePath, 'utf8'));
    assert.deepEqual(saved.rooms[f.code].appearance, chosen);
    const response = await fetch(`${f.base}/api/rooms/${f.code}`, { headers: { Authorization: `Bearer ${f.users[1].sessionToken}` } });
    assert.deepEqual((await response.json()).room.appearance, chosen);
  }
});
