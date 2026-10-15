import express from 'express';
import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { Server as SocketServer } from 'socket.io';
import { createGame, applyAction, publicGame } from '../shared/engine.js';
import { TOKENS as BOARD_TOKENS, PLAYER_COLORS } from '../shared/board.js';
import { createPresentation, isPresentationActive, PRESENTATION_TIMING } from '../shared/presentation.js';
import { RoomStore } from './store.js';
import { assert, text, getPlayer } from './validation.js';
import { handleContract, processContractEvents, nextScheduledPaymentAt, processScheduledPayments } from './contracts.js';
import { handleVote, expireVotes } from './votes.js';
import { sendChat } from './chat.js';
import { sendMoney } from './money.js';
import { ACTION_PROTOCOL, decodeCommand, findCommandReceipt, validateDecisionContext, rememberCommand, commandOutcome, decisionContext } from './commands.js';
import { TURN_TIMEOUT_MS, timedTurnContext, reconcileTurnTimer, isTurnTimerDue } from './turn-timers.js';
import { createEmoteChannel } from './emotes.js';

const TOKENS = BOARD_TOKENS.map(token => token.id);
const COLORS = PLAYER_COLORS;
const THEMES = ['classic', 'inland-empire'];
const DEFAULT_APPEARANCE = { palette: 'graphite', mode: 'dark' };
const hashToken = token => createHash('sha256').update(token).digest('hex');
const timestamp = () => new Date().toISOString();

function normalizeAppearance(value = DEFAULT_APPEARANCE) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Appearance must contain a palette and mode');
  assert(Object.keys(value).every(key => ['palette', 'mode'].includes(key)), 'Unknown appearance setting');
  const palette = value.palette ?? DEFAULT_APPEARANCE.palette;
  const mode = value.mode ?? DEFAULT_APPEARANCE.mode;
  assert(['graphite', 'forest', 'slate', 'ocean', 'burgundy'].includes(palette), 'Choose a supported color palette');
  assert(['dark', 'light'].includes(mode), 'Choose dark or light mode');
  return { palette, mode };
}

function normalizeRoomRules(value = {}) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Room rules must be an object');
  assert(Object.keys(value).every(key => key === 'allowPassingUnowned'), 'Unknown room rule');
  const allowPassingUnowned = value.allowPassingUnowned === undefined ? false : value.allowPassingUnowned;
  assert(typeof allowPassingUnowned === 'boolean', 'Allow passing on unowned properties must be true or false');
  return { allowPassingUnowned };
}

function addActivity(room, type, playerId, message) {
  room.activity.unshift({ id: randomUUID(), type, playerId, message, at: timestamp() });
  room.activity = room.activity.slice(0, 200);
}

function selectToken(room, requested, strict = false, playerId = null) {
  if (requested !== undefined) assert(TOKENS.includes(requested), 'Choose a valid playing piece');
  const used = room.players.filter(p => p.id !== playerId).map(p => p.token);
  if (requested && !used.includes(requested)) return requested;
  assert(!strict, 'That playing piece is already taken');
  return TOKENS.find(token => !used.includes(token));
}

function newPlayer(room, input) {
  const name = text(input.name, 'Display name', 1, 24);
  assert(!room.players.some(p => p.name.toLocaleLowerCase() === name.toLocaleLowerCase()), 'That display name is already in this room');
  return { id: randomUUID(), name, token: selectToken(room, input.token), color: COLORS.find(color => !room.players.some(p => p.color === color)), joinedAt: timestamp() };
}

function randomCode(rooms) {
  let code;
  do { code = Array.from(randomBytes(6), byte => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[byte % 32]).join(''); } while (rooms[code]);
  return code;
}

export function createApp(options = {}) {
  assert(!options.presentationTiming || process.env.NODE_TEST_CONTEXT, 'Presentation timing overrides are available only to Node test fixtures');
  const presentationTiming = { ...PRESENTATION_TIMING, ...options.presentationTiming };
  assert(Object.entries(presentationTiming).every(([key, value]) => Object.hasOwn(PRESENTATION_TIMING, key) && Number.isFinite(value) && value >= 0 && value <= 30000), 'Invalid presentation timing');
  assert(options.turnTimeoutMs === undefined || process.env.NODE_TEST_CONTEXT, 'Turn timer overrides are available only to Node test fixtures');
  const turnTimeoutMs = options.turnTimeoutMs ?? TURN_TIMEOUT_MS;
  assert(Number.isSafeInteger(turnTimeoutMs) && turnTimeoutMs >= 20 && turnTimeoutMs <= TURN_TIMEOUT_MS, 'Invalid turn timeout');
  const store = new RoomStore(options.storePath ?? process.env.STORE_PATH ?? path.resolve('data/rooms.json'));
  const app = express();
  const httpServer = createServer(app);
  const origin = options.publicOrigin ?? process.env.PUBLIC_ORIGIN;
  const io = new SocketServer(httpServer, {
    maxHttpBufferSize: 32768,
    cors: origin ? { origin, methods: ['GET', 'POST'] } : undefined,
    allowRequest: (request, callback) => callback(null, !origin || !request.headers.origin || request.headers.origin === origin),
  });
  const presence = new Map();
  const rates = new Map();
  const emotes = createEmoteChannel();
  let closing = false;
  let deadlineTimer;

  function touch(room) {
    room.version = (room.version ?? 0) + 1;
    room.updatedAt = timestamp();
  }

  function connectedActive(room) {
    return Boolean(room.game?.players.some(player => !player.bankrupt && (presence.get(`${room.code}:${player.id}`)?.size ?? 0) > 0));
  }

  function reconcileClock(room, extra = {}) {
    return reconcileTurnTimer(room, { connectedActive: connectedActive(room), durationMs: turnTimeoutMs, ...extra });
  }

  function reconcilePresence(code, forceRestart = false) {
    const candidate = structuredClone(store.data.rooms[code]);
    if (!candidate || !reconcileClock(candidate, { forceRestart })) return;
    store.transaction(data => { data.rooms[code].turnTimer = candidate.turnTimer; touch(data.rooms[code]); });
  }

  function rateLimit(key, maximum, milliseconds) {
    const time = Date.now();
    const previous = rates.get(key);
    const entry = previous && previous.reset > time ? previous : { count: 0, reset: time + milliseconds };
    entry.count += 1;
    rates.set(key, entry);
    assert(entry.count <= maximum, 'Too many requests. Please wait a moment');
  }

  function authenticate(token, roomCode) {
    assert(typeof token === 'string' && token.length >= 32 && token.length <= 128, 'A valid guest session is required');
    const session = store.data.sessions[hashToken(token)];
    assert(session && session.roomCode === roomCode, 'This guest session cannot access that room');
    const room = store.data.rooms[roomCode];
    assert(room && room.players.some(p => p.id === session.playerId), 'Your seat is no longer in this room');
    return session;
  }

  function publicRoom(room) {
    const serverNow = Date.now();
    const result = structuredClone(room);
    delete result._commandReceipts;
    result.actionProtocol = ACTION_PROTOCOL;
    result.decisionVersion = room.decisionVersion ?? 0;
    result.version = room.version ?? 0;
    result.serverNow = serverNow;
    result.chat ??= [];
    result.presentation = isPresentationActive(room.presentation, serverNow) ? structuredClone(room.presentation) : null;
    result.turnTimer = timedTurnContext(room, { at: serverNow, connectedActive: connectedActive(room) }) && room.turnTimer ? structuredClone(room.turnTimer) : null;
    result.appearance = normalizeAppearance(room.appearance);
    result.rules = normalizeRoomRules(room.rules);
    result.players = result.players.map(player => ({ ...player, connected: (presence.get(`${room.code}:${player.id}`)?.size ?? 0) > 0 }));
    result.game = room.game ? publicGame(room.game) : null;
    return result;
  }

  function publish(code) {
    if (store.data.rooms[code]) io.to(code).emit('room:state', publicRoom(store.data.rooms[code]));
  }

  function scheduleDeadlines(retryAfter = 0) {
    clearTimeout(deadlineTimer);
    if (closing) return;
    const currentTime = Date.now();
    let next = Infinity;
    for (const room of Object.values(store.data.rooms)) {
      if (Number.isFinite(room.presentation?.endsAt)) next = Math.min(next, room.presentation.endsAt);
      const paymentAt = nextScheduledPaymentAt(room);
      if (Number.isFinite(paymentAt)) next = Math.min(next, isPresentationActive(room.presentation, currentTime) ? Math.max(paymentAt, room.presentation.endsAt) : paymentAt);
      if (timedTurnContext(room, { at: currentTime, connectedActive: connectedActive(room) }) && Number.isFinite(room.turnTimer?.endsAt)) next = Math.min(next, room.turnTimer.endsAt);
    }
    if (!Number.isFinite(next)) return;
    deadlineTimer = setTimeout(() => {
      try { flushDeadlines(); scheduleDeadlines(); }
      catch (error) {
        console.error('Unable to persist room deadlines:', error.message);
        scheduleDeadlines(1000);
      }
    }, Math.max(1, retryAfter, Math.min(2147483647, next - currentTime)));
    deadlineTimer.unref();
  }

  function flushDeadlines() {
    const currentTime = Date.now();
    const codes = Object.values(store.data.rooms).filter(room =>
      (room.presentation && room.presentation.endsAt <= currentTime) ||
      (!isPresentationActive(room.presentation, currentTime) && nextScheduledPaymentAt(room) <= currentTime)
    ).map(room => room.code);
    if (codes.length) store.transaction(data => {
      for (const code of codes) {
        const room = data.rooms[code];
        if (room.presentation?.endsAt <= currentTime) room.presentation = null;
        if (processScheduledPayments(room, currentTime)) room.decisionVersion = (room.decisionVersion ?? 0) + 1;
        reconcileClock(room, { at: currentTime });
        touch(room);
      }
    });
    codes.forEach(publish);
    let automatic = false;
    // Dispatch outside the deadline transaction. A nested clone/commit could overwrite a turn.
    for (const code of Object.keys(store.data.rooms)) {
      const room = store.data.rooms[code];
      if (!isTurnTimerDue(room, { at: Date.now(), connectedActive: connectedActive(room) })) continue;
      const timer = room.turnTimer;
      execute(code, timer.playerId, { commandId: `timer-${timer.id}`, ...decisionContext(room), type: timer.phase === 'roll' ? 'roll' : 'endTurn' }, { skipDeadlineFlush: true, automaticTimerId: timer.id });
      automatic = true; publish(code);
    }
    if (codes.length || automatic) scheduleDeadlines();
  }

  function execute(code, actorId, input, { skipDeadlineFlush = false, automaticTimerId = null } = {}) {
    assert(input && typeof input === 'object' && !Array.isArray(input), 'Action must be an object');
    assert(typeof input.type === 'string' && input.type.length <= 60, 'Action type is required');
    for (const field of ['actorId', 'player', 'dice', 'state', 'game', 'options', 'sessionToken']) {
      assert(!Object.hasOwn(input, field), `Client-supplied ${field} is not accepted`);
    }
    assert(automaticTimerId || !(typeof input.commandId === 'string' && input.commandId.startsWith('timer-')), 'That action identifier is reserved for the server turn clock');
    const command = decodeCommand(input);
    const receipt = findCommandReceipt(store.data.rooms[code], actorId, command);
    // Everything through transaction/commit is synchronous, with no await where
    // another socket could interleave. A replay returns without a durable write,
    // timer changes, or another broadcast, even if its old decision is now stale.
    if (receipt) return { duplicate: true, receipt };
    const action = command.action;
    // Clock obligations that were due before this request settle first. During a
    // roll they wait for its final position, just like a player's next action.
    if (!skipDeadlineFlush) flushDeadlines();
    return store.transaction(data => {
      const room = data.rooms[code];
      const actor = getPlayer(room, actorId);
      if (automaticTimerId) {
        assert(room.turnTimer?.id === automaticTimerId && room.turnTimer.playerId === actorId &&
          isTurnTimerDue(room, { connectedActive: connectedActive(room) }) &&
          input.type === (room.turnTimer.phase === 'roll' ? 'roll' : 'endTurn'), 'The turn timer changed before its automatic action');
      }
      validateDecisionContext(room, command);
      const previousSeq = Math.max(0, ...(room.game?.log ?? []).map(e => e.seq ?? 0));
      const permittedDuringPresentation = action.type === 'chat:send' || action.type.startsWith('vote:') || ['room:appearance', 'contract:cancel', 'contract:reject'].includes(action.type);
      assert(!isPresentationActive(room.presentation) || permittedDuringPresentation, 'Wait for the shared dice and movement to finish');
      expireVotes(room);
      if (action.type.startsWith('room:')) {
        if (action.type === 'room:profile') {
          assert(room.status === 'lobby', 'Profiles are locked once a game starts');
          if (action.name !== undefined) {
            const name = text(action.name, 'Display name', 1, 24);
            assert(!room.players.some(p => p.id !== actorId && p.name.toLocaleLowerCase() === name.toLocaleLowerCase()), 'That name is already taken');
            actor.name = name;
          }
          if (action.token !== undefined) actor.token = selectToken(room, action.token, true, actorId);
        } else {
          assert(room.hostId === actorId, 'Only the host can do that');
          if (action.type === 'room:start') {
            assert(room.status === 'lobby', 'This game has already started');
            assert(room.players.length >= 2 && room.players.length <= 8, 'A game requires 2 to 8 players');
            assert(room.players.length <= (room.theme === 'inland-empire' ? 6 : 8), 'Inland Empire-Opoly supports at most 6 players');
            room.game = createGame(room.players.map(p => ({ id: p.id, name: p.name, token: p.token, color: p.color })), { edition: room.theme, allowPassingUnowned: room.rules?.allowPassingUnowned === true });
            room.status = 'playing';
            addActivity(room, 'start', actorId, `${actor.name} started the game`);
          } else if (action.type === 'room:theme') {
            assert(room.status === 'lobby', 'The edition and its rules are locked after the game starts');
            assert(THEMES.includes(action.theme), 'Unknown board theme');
            assert(action.theme !== 'inland-empire' || room.players.length <= 6, 'Inland Empire-Opoly supports at most 6 players');
            room.theme = action.theme;
            addActivity(room, 'theme', actorId, `${actor.name} changed the shared board theme`);
          } else if (action.type === 'room:rules') {
            assert(room.status === 'lobby', 'Room rules are locked after the game starts');
            room.rules = normalizeRoomRules(action.rules);
            addActivity(room, 'rules', actorId, `${actor.name} ${room.rules.allowPassingUnowned ? 'enabled' : 'disabled'} passing on unowned properties`);
          } else if (action.type === 'room:appearance') {
            room.appearance = normalizeAppearance(action.appearance);
            addActivity(room, 'appearance', actorId, `${actor.name} set ${room.appearance.palette} colors and ${room.appearance.mode} mode`);
          } else if (action.type === 'room:transfer-host') {
            getPlayer(room, action.playerId);
            room.hostId = action.playerId;
            addActivity(room, 'host', actorId, `${actor.name} transferred the host role`);
          } else throw new Error('Unknown room action');
        }
      } else if (action.type === 'chat:send') {
        sendChat(room, actorId, action);
      } else if (action.type === 'money:send') {
        sendMoney(room, actorId, action);
      } else if (action.type.startsWith('contract:')) {
        handleContract(room, actorId, action);
        addActivity(room, 'contract', actorId, `${actor.name}: ${action.type.slice(9).replaceAll('-', ' ')} contract`);
      } else if (action.type.startsWith('vote:')) {
        handleVote(room, actorId, action);
        addActivity(room, 'vote', actorId, `${actor.name}: ${action.type.slice(5)} vote`);
      } else {
        assert(room.status === 'playing' && room.game, 'Start the game first');
        applyAction(room.game, actorId, action);
      }
      const events = (room.game?.log ?? []).filter(e => e.seq > previousSeq);
      processContractEvents(room, events);
      const outcomeEvents = (room.game?.log ?? []).filter(e => e.seq > previousSeq);
      const presentation = createPresentation(outcomeEvents, { id: randomUUID(), timing: presentationTiming });
      if (presentation) room.presentation = presentation;
      if (room.game?.status === 'finished') room.status = 'finished';
      if ((room.game?._eventSeq ?? 0) !== previousSeq) room.decisionVersion = (room.decisionVersion ?? 0) + 1;
      const substantive = !['room:', 'chat:', 'vote:'].some(prefix => action.type.startsWith(prefix));
      reconcileClock(room, { restartEnd: substantive && actorId === room.game?.currentPlayerId, forceRestart: action.type === 'roll' });
      if (automaticTimerId) addActivity(room, action.type === 'roll' ? 'auto-roll' : 'auto-end', actorId, `${actor.name} ${action.type === 'roll' ? 'rolled automatically' : 'ended the turn automatically'} after the 30-second timer expired`);
      touch(room);
      return { duplicate: false, receipt: rememberCommand(room, actorId, command) };
    });
  }

  app.disable('x-powered-by');
  app.use((request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use(express.json({ limit: '24kb' }));
  app.use('/api', (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    try { rateLimit(`http:${request.ip}`, 120, 60000); next(); } catch (error) { response.status(429).json({ error: error.message }); }
  });
  app.get('/api/health', (request, response) => response.json({ ok: true }));

  app.post('/api/rooms', (request, response, next) => {
    try {
      const theme = request.body.theme ?? 'classic';
      assert(THEMES.includes(theme), 'Unknown board theme');
      const appearance = normalizeAppearance(request.body.appearance);
      const rules = normalizeRoomRules(request.body.rules);
      const sessionToken = randomBytes(32).toString('base64url');
      const created = store.transaction(data => {
        const code = randomCode(data.rooms);
        const room = { code, version: 1, decisionVersion: 0, hostId: null, theme, appearance, rules, status: 'lobby', players: [], game: null, presentation: null, turnTimer: null, chat: [], contracts: [], votes: [], activity: [], createdAt: timestamp(), updatedAt: timestamp() };
        const player = newPlayer(room, request.body);
        room.players.push(player);
        room.hostId = player.id;
        addActivity(room, 'created', player.id, `${player.name} opened the room`);
        data.rooms[code] = room;
        data.sessions[hashToken(sessionToken)] = { playerId: player.id, roomCode: code, createdAt: timestamp() };
        return { room, playerId: player.id };
      });
      response.status(201).json({ room: publicRoom(created.room), playerId: created.playerId, sessionToken });
    } catch (error) { next(error); }
  });

  app.post('/api/rooms/:code/join', (request, response, next) => {
    try {
      const code = request.params.code.toUpperCase();
      assert(store.data.rooms[code], 'Room not found. Check the six-character room code');
      if (request.body.sessionToken) {
        const session = authenticate(request.body.sessionToken, code);
        response.json({ room: publicRoom(store.data.rooms[code]), playerId: session.playerId, sessionToken: request.body.sessionToken });
        return;
      }
      const sessionToken = randomBytes(32).toString('base64url');
      const joined = store.transaction(data => {
        const room = data.rooms[code];
        assert(room.status === 'lobby', 'This game has started. Rejoin with your original guest session');
        assert(room.players.length < (room.theme === 'inland-empire' ? 6 : 8), 'This room is full');
        const player = newPlayer(room, request.body);
        room.players.push(player);
        addActivity(room, 'joined', player.id, `${player.name} joined the room`);
        touch(room);
        data.sessions[hashToken(sessionToken)] = { playerId: player.id, roomCode: code, createdAt: timestamp() };
        return { room, playerId: player.id };
      });
      publish(code);
      response.status(201).json({ room: publicRoom(joined.room), playerId: joined.playerId, sessionToken });
    } catch (error) { next(error); }
  });

  app.get('/api/rooms/:code', (request, response, next) => {
    try {
      const code = request.params.code.toUpperCase();
      const token = request.get('Authorization')?.replace(/^Bearer\s+/i, '');
      const session = authenticate(token, code);
      response.json({ room: publicRoom(store.data.rooms[code]), playerId: session.playerId });
    } catch (error) { next(error); }
  });

  // A client with an uncertain acknowledgement can inspect its own receipt.
  // Unknown is deliberately inconclusive: it never authorizes an automatic retry.
  app.get('/api/rooms/:code/commands/:commandId', (request, response, next) => {
    try {
      const code = request.params.code.toUpperCase();
      const token = request.get('Authorization')?.replace(/^Bearer\s+/i, '');
      const session = authenticate(token, code);
      const room = store.data.rooms[code];
      response.json({ ...commandOutcome(room, session.playerId, request.params.commandId), room: publicRoom(room) });
    } catch (error) { next(error); }
  });

  io.use((socket, next) => {
    try {
      rateLimit(`connection:${socket.handshake.address}`, 100, 60000);
      const code = String(socket.handshake.auth.roomCode ?? '').toUpperCase();
      const token = socket.handshake.auth.sessionToken;
      const session = authenticate(token, code);
      socket.data = { roomCode: code, playerId: session.playerId, token };
      next();
    } catch (error) { next(error); }
  });

  io.on('connection', socket => {
    const { roomCode, playerId } = socket.data;
    const key = `${roomCode}:${playerId}`;
    const wasActive = connectedActive(store.data.rooms[roomCode]);
    const set = presence.get(key) ?? new Set();
    set.add(socket.id);
    presence.set(key, set);
    socket.join(roomCode);
    try { reconcilePresence(roomCode, !wasActive); scheduleDeadlines(); }
    catch (error) { console.error('Unable to persist the resumed turn clock:', error.message); }
    publish(roomCode);
    socket.on('emote:send', (input, acknowledge) => {
      const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
      try {
        const session = authenticate(socket.data.token, roomCode);
        const result = emotes.send(store.data.rooms[roomCode], session.playerId, input);
        if (result.event) io.to(roomCode).volatile.emit('room:emote', result.event);
        reply({ ok: true, id: result.id, duplicate: result.duplicate });
      } catch (error) {
        reply({ ok: false, error: error.message || 'That reaction could not be sent', code: error.code || 'EMOTE_UNAUTHORIZED', ...(error.retryAfterMs ? { retryAfterMs: error.retryAfterMs } : {}) });
      }
    });
    socket.on('action', (action, acknowledge) => {
      const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
      let authenticated = false;
      try {
        rateLimit(`action:${key}`, 100, 10000);
        const session = authenticate(socket.data.token, roomCode);
        authenticated = true;
        if (action?.type === 'chat:send') rateLimit(`chat:${key}`, 8, 10000);
        const result = execute(roomCode, session.playerId, action);
        if (!result.duplicate) { scheduleDeadlines(); publish(roomCode); }
        reply({ ok: true, duplicate: result.duplicate, commandId: result.receipt.commandId, appliedVersion: result.receipt.appliedVersion, appliedDecisionVersion: result.receipt.appliedDecisionVersion, room: publicRoom(store.data.rooms[roomCode]) });
      } catch (error) {
        reply({
          ok: false, error: error.message || 'The action could not be completed', errorCode: error.code || 'INVALID_ACTION',
          commandId: typeof action?.commandId === 'string' ? action.commandId.slice(0, 100) : null,
          ...(authenticated && store.data.rooms[roomCode] ? { room: publicRoom(store.data.rooms[roomCode]) } : {}),
        });
      }
    });
    socket.on('disconnect', () => {
      const connected = presence.get(key);
      connected?.delete(socket.id);
      if (!connected?.size) presence.delete(key);
      if (!closing) {
        try { reconcilePresence(roomCode); scheduleDeadlines(); }
        catch (error) { console.error('Unable to persist the paused turn clock:', error.message); }
        publish(roomCode);
      }
    });
  });

  const expirationTimer = setInterval(() => {
    const codes = Object.values(store.data.rooms).filter(room => room.votes.some(v => v.status === 'open' && Date.parse(v.expiresAt) <= Date.now())).map(room => room.code);
    if (codes.length) {
      try {
        store.transaction(data => codes.forEach(code => { expireVotes(data.rooms[code]); touch(data.rooms[code]); }));
        codes.forEach(publish);
      } catch (error) { console.error('Unable to persist vote expirations:', error.message); }
    }
    for (const [key, value] of rates) if (value.reset < Date.now()) rates.delete(key);
    emotes.cleanup();
  }, 15000);
  expirationTimer.unref();
  // Rebuild timers from durable pending deadlines, including overdue payments
  // after a restart. Persisted status makes each occurrence execute once.
  try {
    // No socket presence survives a restart. Never replay an unattended saved turn clock.
    if (Object.values(store.data.rooms).some(room => room.turnTimer)) store.transaction(data => {
      for (const room of Object.values(data.rooms)) if (room.turnTimer) { room.turnTimer = null; touch(room); }
    });
    flushDeadlines(); scheduleDeadlines();
  }
  catch (error) { console.error('Unable to recover room deadlines:', error.message); scheduleDeadlines(1000); }

  const distPath = options.distPath ?? path.resolve('dist');
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath, {
      maxAge: '1h',
      setHeaders(response, filePath) {
        if (path.basename(filePath) === 'index.html') response.setHeader('Cache-Control', 'no-cache');
      },
    }));
    app.get('/{*path}', (request, response, next) => {
      if (request.path.startsWith('/api/')) return next();
      response.setHeader('Cache-Control', 'no-cache');
      response.sendFile(path.join(distPath, 'index.html'));
    });
  }
  app.use('/api', (request, response) => response.status(404).json({ error: 'API endpoint not found' }));
  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    const status = error.status === 413 ? 413 : 400;
    response.status(status).json({ error: status === 413 ? 'Request is too large' : error.message || 'Invalid request' });
  });

  return {
    app, httpServer, io, store, publicRoom,
    listen(port = 3001, host = '0.0.0.0') {
      return new Promise(resolve => httpServer.listen(port, host, () => resolve(httpServer.address())));
    },
    async close() {
      closing = true;
      clearInterval(expirationTimer);
      clearTimeout(deadlineTimer);
      emotes.clear();
      await new Promise(resolve => io.close(resolve));
      if (httpServer.listening) await new Promise(resolve => httpServer.close(resolve));
    },
  };
}
