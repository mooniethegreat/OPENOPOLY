import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceAudioFeed, eventSoundKinds, presentationSoundCues, emoteSoundCue } from '../src/game-audio-events.js';
import { EMOTE_IMPACT_FRACTION } from '../src/emote-visual.js';
import { createAudioEngine, DEFAULT_AUDIO_SETTINGS, readAudioSettings, saveAudioSettings, synthesizeSound } from '../src/game-audio-engine.js';

const players = [{ id: 'a', name: 'Alex' }, { id: 'b', name: 'Blair' }];
const room = (log = [], extra = {}) => ({ code: 'SOUND1', version: 1, serverNow: 1000, players, game: { edition: 'classic', players, rules: {}, log }, contracts: [], chat: [], votes: [], ...extra });
const event = (seq, type, extra = {}) => ({ id: `event-${seq}`, seq, type, ...extra });

test('sound hydration, duplicate ACKs, old snapshots and room switches are quiet', () => {
  const initial = room([event(1, 'moneyTransfer', { fromPlayerId: 'b', toPlayerId: 'a', amount: 40 })]);
  let feed = advanceAudioFeed(null, initial, 'a'); assert.deepEqual(feed.cues, []);
  const updated = room([...initial.game.log, event(2, 'moneyTransfer', { fromPlayerId: 'a', toPlayerId: 'b', amount: 20 })], { version: 2, serverNow: 1200 });
  feed = advanceAudioFeed(feed.cursor, updated, 'a'); assert.deepEqual(feed.cues.map(item => item.kind), ['money-out']);
  assert.deepEqual(advanceAudioFeed(feed.cursor, updated, 'a').cues, []);
  assert.deepEqual(advanceAudioFeed(feed.cursor, initial, 'a').cues, []);
  assert.deepEqual(advanceAudioFeed(feed.cursor, { ...updated, code: 'OTHER1' }, 'a').cues, []);
  assert.deepEqual(advanceAudioFeed(feed.cursor, updated, 'b').cues, []);
});

test('canonical cash companions, group development and card releases make one correct cash cue', () => {
  const table = room();
  assert.deepEqual(eventSoundKinds(table, 'a', event(1, 'passGo', { playerId: 'a', amount: 200 })), []);
  assert.deepEqual(eventSoundKinds(table, 'a', event(2, 'payment', { fromPlayerId: null, toPlayerId: 'a', amount: 200 })), ['money-in']);
  assert.deepEqual(eventSoundKinds(table, 'a', event(3, 'build', { playerId: 'a', amount: 50, groupBuildId: 'g' })), []);
  assert.deepEqual(eventSoundKinds(table, 'a', event(4, 'buildGroup', { playerId: 'a', propertyIds: [1, 3], amount: 100, groupBuildId: 'g' })), ['money-out', 'build']);
  assert.deepEqual(eventSoundKinds(table, 'a', event(5, 'purchase', { playerId: 'a', propertyId: 1, amount: 60, auction: true })), ['purchase']);
  assert.deepEqual(eventSoundKinds(table, 'a', event(6, 'transferProperty', { fromPlayerId: 'b', toPlayerId: 'a', amount: 20, propertyId: 1 })), []);
  assert.deepEqual(eventSoundKinds(table, 'a', event(7, 'debt', { fromPlayerId: 'a', amount: 200 })), ['popup']);
  assert.deepEqual(eventSoundKinds(table, 'a', event(8, 'releaseJail', { playerId: 'a' })), ['release']);
  assert.deepEqual(eventSoundKinds(table, 'a', event(9, 'releaseJail', { playerId: 'a', deck: 'chance' })), ['card']);
  for (const type of ['start', 'bid', 'passAuction', 'auctionClosed', 'bankruptcy', 'win']) assert.equal(eventSoundKinds(table, 'a', event(10, type)).length, 1);
});

test('dice, tile steps, card draw and payment use the shared absolute movement clock once', () => {
  const logs = [event(1, 'roll'), event(2, 'move'), event(3, 'card'), event(4, 'move'), event(5, 'payment', { fromPlayerId: null, toPlayerId: 'a', amount: 200 }), event(6, 'jail')];
  const timeline = { id: 'roll-one', playerId: 'a', startedAt: 1100, rollEndsAt: 2600, endsAt: 4800, dice: [3, 4], events: logs, moves: [
    { from: 0, to: 7, path: [1, 2, 3, 4, 5, 6, 7], startedAt: 2600, endsAt: 3580 },
    { from: 7, to: 0, path: [0], startedAt: 4030, endsAt: 4170 },
    { from: 0, to: 10, path: [10], direct: true, startedAt: 4170, endsAt: 4620 },
  ] };
  const pure = presentationSoundCues(timeline);
  assert.equal(pure.cues.filter(item => item.kind === 'dice').length, 7);
  assert.equal(pure.cues.find(item => item.kind === 'clack').at, 2600);
  assert.equal(pure.cues.filter(item => item.kind === 'step').length, 8);
  assert.equal(pure.eventTimes.get('event-3'), 3580);
  assert.equal(pure.eventTimes.get('event-5'), 4170);
  assert.equal(pure.eventTimes.get('event-6'), 4620);
  const baseline = advanceAudioFeed(null, room(), 'a');
  const updated = room(logs, { version: 2, serverNow: 1150, presentation: timeline });
  const feed = advanceAudioFeed(baseline.cursor, updated, 'a');
  assert.equal(feed.cues.find(item => item.kind === 'card').at, 3580);
  assert.equal(feed.cues.find(item => item.kind === 'money-in').at, 4170);
  assert.deepEqual(advanceAudioFeed(feed.cursor, { ...updated, version: 3, serverNow: 2000 }, 'a').cues, []);
  assert.deepEqual(advanceAudioFeed(null, updated, 'a').cues, []);
});

test('proposal/signature changes, vote activity and chat bursts consume public identities once', () => {
  let feed = advanceAudioFeed(null, room(), 'a');
  const proposed = room([], { version: 2, serverNow: 1100, contracts: [{ id: 'c', revision: 1, status: 'proposed', signatures: [] }], votes: [{ id: 'v', status: 'open', ballots: {} }], chat: [{ id: 'm1' }, { id: 'm2' }] });
  feed = advanceAudioFeed(feed.cursor, proposed, 'a');
  assert.deepEqual(feed.cues.map(item => item.kind).sort(), ['chat', 'proposal', 'vote']);
  const signed = { ...proposed, version: 3, contracts: [{ ...proposed.contracts[0], signatures: [{ playerId: 'b' }] }], votes: [{ id: 'v', status: 'approved', ballots: { a: 'yes' } }] };
  feed = advanceAudioFeed(feed.cursor, signed, 'a');
  assert.deepEqual(feed.cues.map(item => item.kind).sort(), ['signature', 'vote']);
  assert.deepEqual(advanceAudioFeed(feed.cursor, signed, 'a').cues, []);
  assert.deepEqual(advanceAudioFeed(feed.cursor, proposed, 'a').cues, []);
});

function fakeAudio() {
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });
  const node = () => ({ connect() {}, disconnect() {}, start() {}, stop() {}, gain: param(), frequency: param(), Q: param() });
  const context = { state: 'suspended', sampleRate: 8000, currentTime: 0, destination: {}, createGain: node, createOscillator: node, createBufferSource: node, createBiquadFilter: node,
    createDynamicsCompressor: () => ({ ...node(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }),
    createBuffer: (_, length) => ({ getChannelData: () => new Float32Array(length) }),
    async resume() { this.state = 'running'; this.onstatechange?.(); }, async suspend() { this.state = 'suspended'; this.onstatechange?.(); }, async close() { this.state = 'closed'; },
  };
  let stamp = 0, serial = 0; const timers = new Map(), played = [];
  const engine = createAudioEngine({ contextFactory: () => context, now: () => stamp, setTimer: (callback, delay) => { timers.set(++serial, { callback, due: stamp + delay }); return serial; }, clearTimer: id => timers.delete(id), onPlay: cue => played.push(cue) });
  const advance = ms => { stamp += ms; let count = 0; while ([...timers.values()].some(item => item.due <= stamp)) { if (++count > 200) throw new Error('Unbounded audio timers'); const [id, item] = [...timers].find(([, value]) => value.due <= stamp); timers.delete(id); item.callback(); } };
  return { engine, context, timers, played, advance };
}

test('audio needs unlock, bounds callbacks and voices, and never replays muted/hidden/suspended cues', async () => {
  const { engine, context, timers, played, advance } = fakeAudio();
  engine.setScope('a'); engine.setPresentation('p');
  engine.enqueue([{ id: 'locked', kind: 'money-in', at: 1000 }], 1000);
  assert.equal(played.length, 0); assert.equal(timers.size, 0);
  assert.equal(await engine.unlock(), true);
  engine.enqueue([{ id: 'locked', kind: 'money-in', at: 1000 }], 1000); assert.equal(played.length, 0);
  engine.enqueue(Array.from({ length: 300 }, (_, i) => ({ id: `step-${i}`, kind: 'step', at: 1000 + i * 100, presentationId: 'p' })), 1000);
  assert.ok(engine.getState().pendingCount <= 80); assert.ok(timers.size <= 1);
  advance(100); assert.equal(played.length, 2);
  engine.setHidden(true); assert.equal(timers.size, 0); assert.equal(engine.getState().pendingCount, 0); assert.equal(context.state, 'suspended');
  engine.enqueue([{ id: 'hidden', kind: 'chat', at: 1200 }], 1200);
  engine.setHidden(false); await engine.unlock();
  engine.enqueue([{ id: 'hidden', kind: 'chat', at: 1200 }], 1200); assert.equal(played.length, 2);
  engine.setSettings({ muted: true, volume: 0.5 }); engine.enqueue([{ id: 'muted', kind: 'money', at: 1300 }], 1300);
  engine.setSettings({ muted: false, volume: 0.5 }); engine.enqueue([{ id: 'muted', kind: 'money', at: 1300 }], 1300); assert.equal(played.length, 2);
  const kinds = ['click', 'popup', 'clack', 'card', 'money-in', 'money-out', 'money', 'purchase', 'build', 'proposal', 'signature'];
  for (const kind of kinds) engine.gesture(kind);
  assert.ok(engine.getState().activeVoices <= 8);
  advance(1000); assert.equal(engine.getState().activeVoices, 0); assert.equal(timers.size, 0);
  context.state = 'suspended'; context.onstatechange();
  assert.equal(engine.getState().activeVoices, 0); assert.equal(engine.getState().status, 'locked');
  engine.dispose(); assert.equal(await engine.unlock(), false); assert.equal(timers.size, 0);
});

test('stale presentation, clock-delayed steps and scope changes are cancelled', async () => {
  const { engine, played, advance, timers } = fakeAudio(); await engine.unlock(); engine.setScope('one'); engine.setPresentation('first');
  engine.enqueue([{ id: 'old', kind: 'step', at: 1300, presentationId: 'first' }, { id: 'late', kind: 'chat', at: 600 }], 1000);
  engine.setPresentation('second'); advance(400); assert.equal(played.length, 0);
  engine.enqueue([{ id: 'next', kind: 'step', at: 1500, presentationId: 'second' }], 1400); advance(1000); assert.equal(played.length, 0);
  engine.enqueue([{ id: 'last', kind: 'chat', at: 3000 }], 2900); assert.equal(timers.size, 1);
  engine.setScope('other'); advance(100); assert.equal(played.length, 0); assert.equal(timers.size, 0);
  engine.dispose();
});

test('the shared toss sound waits for the same canonical impact fraction as the renderer', async () => {
  const { engine, played, advance } = fakeAudio(); await engine.unlock(); engine.setScope('table');
  const cue = emoteSoundCue({ id: 'toss-one', kind: 'poop', startedAt: 1000, endsAt: 4000 });
  assert.equal(cue.kind, 'splat'); assert.equal(cue.at, 1000 + 3000 * EMOTE_IMPACT_FRACTION);
  engine.enqueue([cue], 1000); assert.equal(played.length, 0);
  advance(779); assert.equal(played.length, 0); advance(1); assert.equal(played.length, 1);
  engine.enqueue([cue], 1780); assert.equal(played.length, 1);
  assert.equal(emoteSoundCue({ id: 'face', kind: 'happy', startedAt: 1000, endsAt: 4000 }).at, 1000);
  engine.dispose();
});

test('storage, unavailable Web Audio and synthesis failures cannot escape into the game', async () => {
  const unavailable = createAudioEngine({ contextFactory: () => null }); assert.equal(await unavailable.unlock(), false); assert.equal(unavailable.getState().status, 'unavailable');
  const broken = createAudioEngine({ contextFactory: () => { throw new Error('Blocked audio'); }, onState: () => { throw new Error('Observer'); } });
  assert.equal(await broken.unlock(), false); assert.doesNotThrow(() => broken.enqueue([{ id: '1', kind: 'win', at: 1 }], 1));
  assert.equal(synthesizeSound({}, {}, 'dice').duration, 0);
  const storage = { getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Full'); } };
  assert.deepEqual(readAudioSettings(storage), DEFAULT_AUDIO_SETTINGS); assert.doesNotThrow(() => saveAudioSettings(storage, { muted: true, volume: 0 }));
  assert.deepEqual(readAudioSettings({ getItem: () => '{"muted":true,"volume":99}' }), { muted: true, volume: 1 });
  unavailable.dispose(); broken.dispose();
});
