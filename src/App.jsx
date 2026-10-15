import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { ArrowLeft, ArrowRight, Bell, BookOpen, Check, ChevronDown, CircleHelp, Clock3, Copy, Crown, Handshake, House, Landmark, Link, LogOut, Menu, Palette, Plus, Settings2, ShieldCheck, Sparkles, Users, Vote, Wifi, WifiOff, X } from 'lucide-react';
import { getBoard } from '../shared/board.js';
import { Board, Token, TOKEN_OPTIONS } from './Board.jsx';
import { ActionBar, PropertyModal, RulesModal } from './GameControls.jsx';
import { SidePanel, ContractComposer, VoteComposer, MoneyComposer } from './Panels.jsx';
import { GameContext } from './game-context.jsx';
import { createCommandId, prepareCommand, preventRepeatedActivation } from './action-gate.js';
import { usePresentation } from './presentation.jsx';
import { PlayerRail, TurnStrip, CurrentSpace, ContextActions, GameTools, GameDrawer, SharedEvents, ContractAnnouncements, PlayerHUD } from './GameHUD.jsx';
import PurchaseRule from './PurchaseRule.jsx';
import AppearanceControls, { readAppearance, DEFAULT_APPEARANCE } from './Appearance.jsx';
import PaymentFeedback from './PaymentFeedback.jsx';
import SoundControls, { useGameAudio } from './GameAudio.jsx';
import { useEmotes } from './use-emotes.js';
import MoneyFlight from './MoneyFlight.jsx';
import Welcome from './Welcome.jsx';
import { MatchResults, SettingsSections } from './CinematicViews.jsx';
import EmoteLayer from './EmoteLayer.jsx';
import { money, setInlandData, spaceName, THEMES } from './themes.js';

const SESSION_KEY = 'monopoly-table-session-v1';
const SESSIONS_KEY = 'monopoly-table-sessions-v2';
const ACTIVE_KEY = 'monopoly-table-active-v2';
const commandKey = session => `monopoly-pending-command-v2:${session.roomCode}:${session.playerId}`;
function savedCommand(session) {
  try { const command = JSON.parse(sessionStorage.getItem(commandKey(session)) || 'null'); return typeof command?.commandId === 'string' && typeof command?.type === 'string' ? command : null; } catch { return null; }
}
function savedTables() {
  try {
    const sessions = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '{}');
    const legacy = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (legacy?.roomCode && !sessions[legacy.roomCode]) sessions[legacy.roomCode] = legacy;
    return sessions;
  } catch { return {}; }
}
function savedSession(code = requestedRoom() || localStorage.getItem(ACTIVE_KEY)) {
  const sessions = savedTables();
  if (code) return sessions[code] || null;
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}
function persistSession(session) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify({ ...savedTables(), [session.roomCode]: session }));
  localStorage.setItem(ACTIVE_KEY, session.roomCode);
  localStorage.removeItem(SESSION_KEY);
}
function requestedRoom() {
  const url = new URL(window.location.href);
  return (url.searchParams.get('room') || url.pathname.match(/\/room\/([^/]+)/)?.[1] || '').toUpperCase();
}

export default function App() {
  const [session, setSession] = useState(null);
  const [room, setRoom] = useState(null);
  const [restoring, setRestoring] = useState(Boolean(savedSession()));
  const [connected, setConnected] = useState(false);
  const [pending, setPending] = useState('');
  const [uncertain, setUncertain] = useState(null);
  const [toast, setToast] = useState(null);
  const [selected, setSelected] = useState(null);
  const [panel, setPanel] = useState(null);
  const [composer, setComposer] = useState(null);
  const [modal, setModal] = useState(null);
  const [themeDataReady, setThemeDataReady] = useState(false);
  const [originalArtwork, setOriginalArtwork] = useState(true);
  const [localAppearance, setLocalAppearance] = useState(readAppearance);
  const socketRef = useRef(null);
  const roomRef = useRef(null);
  const inFlight = useRef(null);
  const joining = useRef(false);
  const toastTimer = useRef(null);
  const stableGame = useRef(null);
  const playerId = session?.playerId;
  const presentation = usePresentation(room);
  const audio = useGameAudio({ room, playerId, connected, presentation, panel, composer, modal, selected, toast });
  const shownResults = useRef(null);
  useEffect(() => { const key = !presentation.active && room?.game?.status === 'finished' ? `${room.code}:${room.game.winnerId}` : null; if (key && shownResults.current !== key) { shownResults.current = key; setModal('results'); } }, [room?.code, room?.game?.status, room?.game?.winnerId, presentation.active]);
  const { emotes, sendEmote, emoteStatus, emoteServerNow } = useEmotes({ room, playerId, connected, socketRef, playEmote: audio.playEmote });
  if (!presentation.active) stableGame.current = room?.game || null;
  const visualGame = presentation.active ? stableGame.current || room?.game : room?.game;
  const ingestRoom = useCallback(state => {
    const received = state ? { ...state, clientReceivedAt: Date.now(), clientReceivedMonotonicAt: performance.now() } : state;
    const current = roomRef.current;
    if (received && current?.code === received.code) {
      if (Number.isFinite(received.version) && Number.isFinite(current.version) && received.version < current.version) return false;
      if ((!Number.isFinite(received.version) || received.version === current.version) && received.serverNow < current.serverNow) return false;
    }
    roomRef.current = received;
    setRoom(received);
    return true;
  }, []);

  const notify = useCallback((message, type = 'success') => {
    setToast({ message, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), type === 'error' ? 9000 : 4500);
  }, []);

  useEffect(() => {
    fetch('/assets/inland-empire.json').then(result => result.ok ? result.json() : null).then(data => { if (data) { setInlandData(data); setThemeDataReady(true); } }).catch(() => {});
    const stored = savedSession();
    const code = requestedRoom();
    if (!stored || (code && code !== stored.roomCode)) { setRestoring(false); return; }
    let active = true;
    fetch(`/api/rooms/${encodeURIComponent(stored.roomCode)}`, { headers: { Authorization: `Bearer ${stored.sessionToken}` } }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The saved room could not be found.');
      if (active) { ingestRoom(data.room); setSession({ ...stored, playerId: data.playerId }); }
    }).catch(error => { if (active) notify(`${error.message} Your saved seat is still available below.`, 'error'); }).finally(() => active && setRestoring(false));
    return () => { active = false; };
  }, [notify]);

  const finishRequest = useCallback((request, result) => {
    if (inFlight.current !== request) return;
    if (result?.room?.code === request.roomCode) ingestRoom(result.room);
    try { sessionStorage.removeItem(request.storageKey); } catch { /* The server receipt remains authoritative if browser storage is unavailable. */ }
    inFlight.current = null; setPending(''); setUncertain(null);
    if (!result?.ok) notify(result?.error || 'That action could not be completed. Review the current table.', 'error');
    else if (request.restored) notify('Your previous action was confirmed.');
    request.resolve(Boolean(result?.ok));
  }, [ingestRoom, notify]);

  const recoverRequest = useCallback(async request => {
    if (!request || inFlight.current !== request || request.recovering) return;
    request.recovering = true;
    request.uncertain = true;
    setPending('confirming'); setUncertain({ id: request.command.commandId, checking: true });
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(request.roomCode)}/commands/${encodeURIComponent(request.command.commandId)}`, { headers: { Authorization: `Bearer ${request.sessionToken}` }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
      const receipt = await response.json();
      if (inFlight.current !== request) return;
      if (receipt?.room?.code === request.roomCode) ingestRoom(receipt.room);
      request.lastCheckedDecisionVersion = receipt.room?.decisionVersion ?? roomRef.current?.decisionVersion ?? 0;
      request.checkedConnectionId = request.socket.id;
      request.connectionLost = false;
      if (response.ok && receipt.status === 'applied') { finishRequest(request, { ok: true, room: receipt.room }); return; }
    } catch { /* Keep the original request identity. An unknown result is never a new intent. */ }
    finally { request.recovering = false; }
    if (inFlight.current === request) setUncertain({ id: request.command.commandId, checking: false });
  }, [finishRequest, ingestRoom]);

  const sendRequest = useCallback(request => {
    if (!request || inFlight.current !== request || request.recovering || !request.socket.connected) return;
    request.uncertain = false; request.connectionLost = false;
    setPending(request.command.type); setUncertain(null);
    // Volatile delivery prevents Socket.IO from queuing this packet for a later connection.
    request.socket.volatile.timeout(12000).emit('action', request.command, (timeout, result) => {
      if (inFlight.current !== request || socketRef.current !== request.socket) return;
      if (timeout) { request.uncertain = true; recoverRequest(request); return; }
      finishRequest(request, result);
    });
  }, [finishRequest, recoverRequest]);

  useEffect(() => {
    if (!session) return;
    const socket = io({ auth: { sessionToken: session.sessionToken, roomCode: session.roomCode }, reconnection: true, retries: 0 });
    socketRef.current = socket;
    const restoredCommand = savedCommand(session);
    if (restoredCommand && !inFlight.current) {
      inFlight.current = { command: restoredCommand, socket, resolve: () => {}, roomCode: session.roomCode, sessionToken: session.sessionToken, storageKey: commandKey(session), connectionLost: true, uncertain: true, restored: true };
      setPending('confirming'); setUncertain({ id: restoredCommand.commandId, checking: false });
    }
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => {
      setConnected(false);
      if (inFlight.current?.socket === socket) { inFlight.current.connectionLost = true; inFlight.current.uncertain = true; setPending('confirming'); setUncertain({ id: inFlight.current.command.commandId, checking: false }); }
    });
    socket.on('connect_error', error => { setConnected(false); notify(`Connection: ${error.message}. Reconnecting…`, 'error'); });
    socket.on('room:state', state => {
      if (socketRef.current !== socket || state?.code !== session.roomCode) return;
      ingestRoom(state);
      const request = inFlight.current;
      if (request?.socket === socket && request.uncertain && (request.connectionLost || request.checkedConnectionId !== socket.id || state.decisionVersion > (request.lastCheckedDecisionVersion ?? -1))) recoverRequest(request);
    });
    return () => {
      if (inFlight.current?.socket === socket) { inFlight.current.resolve(false); inFlight.current = null; setPending(''); setUncertain(null); }
      socket.disconnect(); if (socketRef.current === socket) socketRef.current = null; setConnected(false);
    };
  }, [session, notify, ingestRoom, recoverRequest]);

  const dispatchAction = useCallback(async (payload, renderedRoom) => {
    if (inFlight.current) return false;
    const socket = socketRef.current;
    if (!socket?.connected) { notify('You are reconnecting. Your seat is saved; try again when connected.', 'error'); return false; }
    const current = roomRef.current;
    let command;
    try {
      const serverTime = (current?.serverNow || Date.now()) + Math.max(0, performance.now() - (current?.clientReceivedMonotonicAt ?? performance.now()));
      command = prepareCommand(payload, renderedRoom, current, playerId, { commandId: createCommandId(), serverTime });
    } catch (error) { notify(error.message, 'error'); return false; }
    return new Promise(resolve => {
      const request = { command, socket, resolve, roomCode: current.code, sessionToken: session.sessionToken, storageKey: commandKey(session), connectionLost: false, uncertain: false };
      // This latch is synchronous. React's pending render alone cannot guard a second event.
      inFlight.current = request;
      try { sessionStorage.setItem(request.storageKey, JSON.stringify(command)); }
      catch { inFlight.current = null; notify('This browser could not save the action for recovery. No command was sent.', 'error'); resolve(false); return; }
      sendRequest(request);
    });
  }, [notify, playerId, session, sendRequest]);
  const action = useCallback(payload => dispatchAction(payload, room), [dispatchAction, room]);

  const enterRoom = async ({ name, code, token, theme, allowPassingUnowned = false }) => {
    if (joining.current) return;
    joining.current = true;
    setPending('join');
    try {
      const previousSeat = code ? savedSession(code.toUpperCase()) : null;
      const response = await fetch(code ? `/api/rooms/${encodeURIComponent(code.toUpperCase())}/join` : '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, token, theme, rules: { allowPassingUnowned }, appearance: localAppearance, ...(previousSeat ? { sessionToken: previousSeat.sessionToken } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to open the room.');
      const nextSession = { playerId: data.playerId, sessionToken: data.sessionToken, roomCode: data.room.code, name, theme: data.room.theme };
      persistSession(nextSession);
      window.history.replaceState({}, '', `/?room=${data.room.code}`);
      setSession(nextSession); ingestRoom(data.room); setPanel(null); notify(code ? 'Room joined.' : 'Room created.');
    } catch (error) { notify(error.message, 'error'); } finally { joining.current = false; setPending(''); }
  };

  const copyInvite = useCallback(async () => {
    if (!room) return;
    const invite = `${window.location.origin}/?room=${room.code}`;
    try { await navigator.clipboard.writeText(invite); notify('Room link copied.'); }
    catch { setModal('invite'); }
  }, [room, notify]);

  const leave = () => {
    socketRef.current?.disconnect();
    setSession(null); ingestRoom(null); setModal(null); setSelected(null); setPanel(null); setComposer(null); stableGame.current = null;
    if (session) persistSession(session);
    localStorage.removeItem(ACTIVE_KEY); window.history.replaceState({}, '', '/');
  };

  const game = room?.game;
  const board = getBoard(game || room?.theme);
  const decisionOpen = !presentation.active && game && (game.pendingMortgage || ['buy', 'auction', 'debt'].includes(game.phase) || (['roll', 'end'].includes(game.phase) && game.players.find(player => player.id === game.currentPlayerId)?.inJail));
  const seatLimit = room?.theme === 'inland-empire' ? 6 : 8;
  const me = visualGame?.players.find(player => player.id === playerId) || room?.players.find(player => player.id === playerId);
  const players = useMemo(() => (visualGame?.players || room?.players || []).map(player => ({ ...player, connected: room?.players.find(member => member.id === player.id)?.connected })), [room, visualGame]);
  const properties = useMemo(() => board.filter(space => game?.properties?.[space.id]?.ownerId === playerId), [game, playerId, room?.theme]);
  const isHost = room?.hostId === playerId;
  const appearance = room ? room.appearance || DEFAULT_APPEARANCE : localAppearance;
  const changeAppearance = async value => {
    if (room) return action({ type: 'room:appearance', appearance: value });
    setLocalAppearance(value); localStorage.setItem('monopoly-appearance-v1', JSON.stringify(value));
  };
  const openContracts = room?.contracts?.filter(contract => contract.status === 'proposed' && contract.partyIds.includes(playerId) && !contract.signatures.some(signature => signature.playerId === playerId)).length || 0;
  const openVotes = room?.votes?.filter(vote => vote.status === 'open' && !vote.ballots?.[playerId]).length || 0;
  const value = { room, game, visualGame, presentation, playerId, me, players, action, pending, connected, notify, selected, setSelected, panel, setPanel, composer, setComposer, setModal, copyInvite, themeDataReady, originalArtwork, setOriginalArtwork, emotes, sendEmote, emoteStatus, emoteServerNow };

  return <GameContext.Provider value={value}>
    <div className={`app ${room ? 'at-table' : 'at-home'}`} data-theme="cinematic" data-palette={appearance.palette} data-mode={appearance.mode} onClickCapture={preventRepeatedActivation} onKeyDownCapture={preventRepeatedActivation}>
      <header className="app-header">
        <a className="wordmark" href={room ? `/?room=${room.code}` : '/'} aria-label="Monopoly home"><span className="brand-m">M</span><span>MONOPOLY <span className="online-wordmark">ONLINE</span></span></a>
        {room && <div className="table-header-room"><span className="room-code">{room.code}</span><label className="compact-edition"><Landmark size={14} /><select aria-label="Game edition" value={room.theme} disabled={!isHost || Boolean(pending) || room.status !== 'lobby'} onChange={event => action({ type: 'room:theme', theme: event.target.value })}><option value="classic">Classic Monopoly</option><option value="inland-empire">Inland Empire-opoly</option></select></label></div>}
        <nav className="header-nav"><SoundControls audio={audio} /><button className="icon-button appearance-button" onClick={() => setModal('appearance')} aria-label="Appearance"><Palette size={18} /><span>Appearance</span></button>
          {room && <span className={`connection ${connected ? '' : 'offline'}`}><span className="live-dot" />{connected ? 'CONNECTED' : 'RECONNECTING'}</span>}
          <button className="icon-button rules-button" onClick={() => setModal('rules')} aria-label="Game rules"><BookOpen size={18} /><span>Rules</span></button>
          {room && <><button className="icon-button invite-button" onClick={copyInvite} aria-label="Invite players"><Link size={17} /><span>Invite</span></button><button className="avatar-button" style={{ '--player-color': me?.color }} onClick={() => setModal('settings')} aria-label="Room and profile settings">{me?.name?.slice(0, 1).toUpperCase() || 'M'}</button></>}
        </nav>
      </header>

      {restoring ? <main className="restoring"><span className="loading-ring" /><h1>Connecting…</h1><p>Restoring your saved room.</p></main> : !room ? <Welcome pending={pending} enterRoom={enterRoom} initialCode={requestedRoom()} onRules={() => setModal('rules')} onSettings={() => setModal('appearance')} savedRooms={Object.values(savedTables())} /> : <>
        <main className="game-layout immersive-layout">
          <PlayerRail seatLimit={seatLimit} />
          <section className={`play-area ${decisionOpen ? 'has-decision' : ''}`} aria-label="Game board and turn controls">
            <div className="game-stage">
              <div className="board-scroll"><Board /></div>
              <SharedEvents />
              <ContractAnnouncements />
            </div>
          </section>
          <aside className="context-rail" aria-label="Current turn and actions" data-testid="context-rail"><TurnStrip />{decisionOpen ? <section className={`shared-game-decision decision-${game.phase}`} aria-label="Shared game decision"><div className="decision-eyebrow">{game.pendingMortgage ? 'MORTGAGE DECISION' : game.phase === 'auction' ? 'LIVE AUCTION' : game.phase === 'debt' ? 'DEBT TO SETTLE' : game.phase === 'buy' ? 'PROPERTY AVAILABLE' : 'JAIL DECISION'}<span>SHARED WITH THE TABLE</span></div><ActionBar /></section> : <div className="turn-action-dock"><ActionBar /></div>}<CurrentSpace /><ContextActions /></aside>
          <div className="game-bottom-bar"><PlayerHUD /><GameTools openContracts={openContracts} openVotes={openVotes} /></div>
        </main>
        <GameDrawer><SidePanel /></GameDrawer>
      </>}

      <PaymentFeedback room={room} playerId={playerId} presentation={presentation} />
      <MoneyFlight room={room} presentation={presentation} />
      <EmoteLayer />
      {toast && <div className={`toast ${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'}>{toast.type === 'error' ? <CircleHelp size={18} /> : <Check size={18} />}<span>{toast.message}</span><button onClick={() => setToast(null)} aria-label="Dismiss notification"><X size={16} /></button></div>}
      {uncertain && <section className="uncertain-command" role="alert" data-testid="uncertain-command"><strong>Confirming your last action</strong><p>Its result is not yet confirmed. Check before continuing, or retry this same action.</p><div><button className="btn" disabled={!connected || uncertain.checking} onClick={() => recoverRequest(inFlight.current)}>{uncertain.checking ? 'Checking…' : 'Check result'}</button><button className="btn primary" disabled={!connected || uncertain.checking} onClick={() => sendRequest(inFlight.current)}>Retry same action</button></div></section>}
      {selected !== null && <PropertyModal spaceId={selected} onClose={() => setSelected(null)} />}
      {(composer === 'contract' || composer?.type === 'contract') && <ContractComposer existing={composer?.contract || null} onClose={() => setComposer(null)} />}
      {composer === 'money' && <MoneyComposer onClose={() => setComposer(null)} />}
      {composer === 'vote' && <VoteComposer onClose={() => setComposer(null)} />}
      {modal === 'rules' && <RulesModal onClose={() => setModal(null)} />}{modal === 'appearance' && <Modal title="Settings" eyebrow="PREFERENCES" className="settings-modal" onClose={() => setModal(null)}><SettingsSections audio={audio} appearance={appearance} onAppearanceChange={changeAppearance} appearanceDisabled={room ? !isHost || Boolean(pending) || !connected : false} inRoom={Boolean(room)} isHost={isHost} /></Modal>}
      {modal === 'results' && <MatchResults onClose={() => setModal(null)} onNewGame={leave} />}
      {modal === 'invite' && <Modal title="Invite players" onClose={() => setModal(null)}><p>Share this room link. Players join with a display name.</p><input readOnly value={`${window.location.origin}/?room=${room.code}`} onFocus={event => event.target.select()} /><p className="muted">Room code: <strong>{room.code}</strong></p></Modal>}
      {modal === 'settings' && <Modal title="Table settings" eyebrow="PREFERENCES" className="settings-modal" onClose={() => setModal(null)}><SettingsSections audio={audio} appearance={appearance} onAppearanceChange={changeAppearance} appearanceDisabled={!isHost || Boolean(pending) || !connected} inRoom isHost={isHost} initialTab="game" gameContent={<><div className="profile-overview"><Token token={me?.token} size={54} /><div><h3>{me?.name}</h3><p>{isHost ? 'Host' : 'Player'} · Room {room.code}</p></div></div>{room.status === 'lobby' && <ProfileForm me={me} players={players} action={action} pending={pending} notify={notify} />}{isHost && room.status === 'lobby' && <label className="form-label">Game edition<select value={room.theme} disabled={Boolean(pending)} onChange={event => action({ type: 'room:theme', theme: event.target.value })}><option value="classic">Classic Monopoly</option><option value="inland-empire">Inland Empire-opoly</option></select><small>Your choice sets the board and rules for everyone, and locks when the game starts.</small></label>}<PurchaseRule checked={(game?.rules || room.rules)?.allowPassingUnowned === true} disabled={!isHost || Boolean(pending) || !connected} locked={room.status !== 'lobby'} onChange={value => action({ type: 'room:rules', rules: { allowPassingUnowned: value } })} /><div className="settings-divider" />{isHost && room.players.length > 1 && <label className="form-label">Transfer host<select defaultValue="" disabled={Boolean(pending)} onChange={async event => { if (event.target.value && await action({ type: 'room:transfer-host', playerId: event.target.value })) notify('Host transferred.'); }}><option value="" disabled>Choose a new host</option>{room.players.filter(player => player.id !== playerId).map(player => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label>}<p className="muted">Your player session is saved in this browser. Rejoin from the home screen or the same room link.</p><button className="btn danger-outline" onClick={leave}><LogOut size={16} />Return home</button></>} /></Modal>}
    </div>
  </GameContext.Provider>;
}

export function Modal({ title, eyebrow, children, onClose, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const handler = event => {
      if ([...document.querySelectorAll('.modal-backdrop .modal')].at(-1) !== ref.current) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key === 'Tab') {
        const focusable = [...ref.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')].filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
        if (!focusable.length) return;
        const first = focusable[0], last = focusable.at(-1);
        if (!ref.current.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); return; }
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    const first = ref.current.querySelector('input, select, textarea, button');
    first?.focus();
    return () => { window.removeEventListener('keydown', handler); document.body.style.overflow = previousOverflow; if (previous?.isConnected && previous.getClientRects().length) previous.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && event.detail <= 1) onClose(); }}><section ref={ref} className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={title}><header className="modal-header"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={21} /></button></header><div className="modal-body">{children}</div></section></div>;
}

function ProfileForm({ me, players, action, pending, notify }) {
  const [name, setName] = useState(me.name);
  const [token, setToken] = useState(me.token);
  return <form onSubmit={async event => { event.preventDefault(); if (await action({ type: 'room:profile', name: name.trim(), token })) notify('Profile updated.'); }}><label className="form-label">Display name<input required value={name} maxLength={24} onChange={event => setName(event.target.value)} /></label><fieldset className="token-fieldset"><legend>Token</legend><div className="token-picker">{TOKEN_OPTIONS.map(item => <button type="button" key={item.id} disabled={players.some(player => player.id !== me.id && player.token === item.id)} className={token === item.id ? 'selected' : ''} title={item.name} aria-label={item.name} onClick={() => setToken(item.id)}><Token token={item.id} size={32} /></button>)}</div></fieldset><button className="btn" disabled={Boolean(pending)}>Save profile</button></form>;
}
