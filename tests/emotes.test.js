import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as pause } from 'node:timers/promises';
import { createEmoteChannel } from '../server/emotes.js';
import { EMOTE_KINDS } from '../shared/emotes.js';
import { normalizeIncomingEmote, appendEmote } from '../src/emote-state.js';
import { fixture } from './server-helpers.js';

const request = (kind = 'happy', target = { kind: 'table' }) => ({ clientId: randomUUID(), kind, target });
const table = () => ({ code: 'EMOTE1', theme: 'classic', players: Array.from({ length: 8 }, (_, index) => ({ id: `player-${index}`, name: `Player ${index}` })) });

test('emotes validate sender, target, identifiers and all board spaces without mutating input', () => {
  const channel = createEmoteChannel(), room = table(), original = structuredClone(room);
  let at = 10000;
  for (const kind of EMOTE_KINDS) {
    const input = request(kind), result = channel.send(room, 'player-0', input, at);
    assert.deepEqual(result.event.target, { kind: 'table' }); assert.equal(result.event.senderId, 'player-0'); assert.equal(result.event.roomCode, room.code); assert.equal(result.event.endsAt - result.event.startedAt, 3000); assert.equal(result.event.startedAt, at); at += 1600;
  }
  for (const edition of ['classic', 'inland-empire']) {
    room.theme = edition;
    for (let id = 0; id < 40; id += 1) { const result = channel.send(room, 'player-0', request('poop', { kind: 'property', propertyId: id }), at); assert.equal(result.event.target.propertyId, id); at += 1600; }
  }
  room.theme = original.theme; assert.deepEqual(room, original);
  for (const input of [null, {}, { ...request(), senderId: 'player-1' }, { ...request(), label: 'Spoofed' }, { ...request(), clientId: 'x'.repeat(101) }, { ...request(), clientId: '../invalid id' }, request('unknown'), request('happy', { kind: 'player', playerId: 'outside-room' }), request('poop', { kind: 'property', propertyId: 40 }), request('poop', { kind: 'property', propertyId: -1 }), request('poop', { kind: 'property', propertyId: '1' }), request('poop', { kind: 'property', propertyId: 1.5 }), request('happy', { kind: 'table', playerId: 'player-1' })]) {
    assert.throws(() => channel.send(room, 'player-1', input, at), error => error.code === 'INVALID_EMOTE');
  }
  assert.throws(() => channel.send(room, 'forged-seat', request(), at), error => error.code === 'EMOTE_UNAUTHORIZED');
});

test('per-seat dedup spans sockets, conflicting IDs fail, cooldown and room bursts are bounded', () => {
  const channel = createEmoteChannel(), room = table(), packet = request();
  const first = channel.send(room, 'player-0', packet, 10000);
  assert.deepEqual(channel.send(room, 'player-0', packet, 10001), { id: first.id, event: null, duplicate: true });
  assert.throws(() => channel.send(room, 'player-0', { ...packet, kind: 'cry' }, 10001), error => error.code === 'EMOTE_ID_CONFLICT');
  assert.throws(() => channel.send(room, 'player-0', request(), 10001), error => error.code === 'EMOTE_COOLDOWN' && error.retryAfterMs === 1499);
  for (let index = 1; index < 8; index += 1) channel.send(room, `player-${index}`, request(), 10000);
  assert.throws(() => channel.send(room, 'player-0', request(), 11500), error => error.code === 'EMOTE_RATE_LIMIT' && error.retryAfterMs === 1500);
  assert.equal(channel.send(room, 'player-0', request(), 13000).duplicate, false);
  const other = { ...room, code: 'OTHER1' }; assert.equal(channel.send(other, 'player-0', packet, 10001).duplicate, false);
  assert.equal(channel.send(room, 'player-0', packet, 71000).duplicate, false); // Explicitly bounded ephemeral receipts, never game commands.
  for (let index = 0; index < 40; index += 1) {
    try { channel.send(room, 'player-1', request(), 72000); } catch (error) { assert.ok(['EMOTE_COOLDOWN', 'EMOTE_RATE_LIMIT'].includes(error.code)); }
  }
  assert.throws(() => channel.send(room, 'player-1', request(), 72000), error => error.code === 'EMOTE_RATE_LIMIT');
  channel.cleanup(300000); assert.equal(channel.send(room, 'player-1', request(), 300001).duplicate, false); channel.clear();
});

test('three authenticated sockets see the same ephemeral event; all durable game and timer data stays identical', async t => {
  const f = await fixture(t, 3); await f.start(); await pause(20);
  const room = f.server.store.data.rooms[f.code], before = JSON.stringify(f.server.store.data), fileBefore = fs.readFileSync(f.storePath, 'utf8');
  let commits = 0; const commit = f.server.store.commit.bind(f.server.store); f.server.store.commit = next => { commits += 1; return commit(next); };
  const received = f.users.map(() => []); f.users.forEach((user, index) => user.socket.on('room:emote', event => received[index].push(event)));
  const packet = request('poop', { kind: 'player', playerId: f.users[1].playerId });
  const events = f.users.map(user => once(user.socket, 'room:emote', { signal: AbortSignal.timeout(2000) }));
  const result = await f.users[0].socket.timeout(2000).emitWithAck('emote:send', packet); assert.equal(result.ok, true);
  const published = (await Promise.all(events)).map(([event]) => event);
  assert.deepEqual(published[0], published[1]); assert.deepEqual(published[0], published[2]);
  assert.equal(published[0].senderId, f.users[0].playerId); assert.equal(published[0].roomCode, f.code); assert.equal(published[0].endsAt - published[0].startedAt, 3000);
  const duplicate = await f.users[0].socket.timeout(2000).emitWithAck('emote:send', packet); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.id, result.id);
  const forged = await f.users[0].socket.timeout(2000).emitWithAck('emote:send', { ...request(), senderId: f.users[2].playerId }); assert.equal(forged.ok, false);
  const invalidTarget = await f.users[1].socket.timeout(2000).emitWithAck('emote:send', request('middle-finger', { kind: 'player', playerId: 'foreign-seat' })); assert.equal(invalidTarget.ok, false);
  await pause(30); assert.deepEqual(received.map(list => list.length), [1, 1, 1]);
  assert.equal(JSON.stringify(f.server.store.data), before); assert.equal(fs.readFileSync(f.storePath, 'utf8'), fileBefore); assert.equal(commits, 0);
  assert.equal(f.server.store.data.rooms[f.code], room);
});

test('authentication is rechecked, no emote history replays on reconnect, and gameplay remains available during cooldown', async t => {
  const f = await fixture(t, 2); await f.start();
  const secondSocket = await f.connect(f.users[0]);
  const packet = request('laugh');
  assert.equal((await f.users[0].socket.timeout(2000).emitWithAck('emote:send', packet)).ok, true);
  assert.equal((await secondSocket.timeout(2000).emitWithAck('emote:send', packet)).duplicate, true);
  const blocked = await secondSocket.timeout(2000).emitWithAck('emote:send', request()); assert.equal(blocked.code, 'EMOTE_COOLDOWN');
  assert.equal((await f.action(0, { type: 'money:send', toPlayerId: f.users[1].playerId, amount: 3 })).ok, true);
  let history = 0; secondSocket.on('room:emote', () => { history += 1; }); secondSocket.disconnect();
  const rejoined = await f.connect(f.users[0]); rejoined.on('room:emote', () => { history += 1; }); await pause(30); assert.equal(history, 0);
  assert.equal((await rejoined.timeout(2000).emitWithAck('emote:send', request())).code, 'EMOTE_COOLDOWN');
  f.server.store.transaction(data => { const player = data.rooms[f.code].players.find(item => item.id === f.users[0].playerId); player.id = 'removed-seat'; });
  const revoked = await rejoined.timeout(2000).emitWithAck('emote:send', request()); assert.equal(revoked.ok, false); assert.equal(revoked.code, 'EMOTE_UNAUTHORIZED');
});

test('client emote reducer drops expired, forged and wrong-room events, and bounds visible events', () => {
  const room = table(), channel = createEmoteChannel(); let events = [];
  for (let index = 0; index < 8; index += 1) {
    const event = channel.send(room, `player-${index}`, request('poop', { kind: 'property', propertyId: index }), 10000).event;
    const normalized = normalizeIncomingEmote(event, room, 10050); assert.ok(normalized); events = appendEmote(events, normalized, 10050);
  }
  assert.equal(events.length, 3);
  const latest = events.at(-1); assert.equal(normalizeIncomingEmote(latest, room, 13000), null);
  assert.equal(normalizeIncomingEmote({ ...latest, roomCode: 'OTHER1' }, room, 10050), null);
  assert.equal(normalizeIncomingEmote({ ...latest, senderId: 'unknown' }, room, 10050), null);
  assert.equal(normalizeIncomingEmote({ ...latest, endsAt: 15000 }, room, 10050), null);
  assert.equal(normalizeIncomingEmote({ ...latest, target: { kind: 'property', propertyId: 40 } }, room, 10050), null);
  assert.deepEqual(appendEmote(events, latest, 10050), events);
});
