import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Banknote, Bell, BookOpen, Camera, CheckCheck, ChevronRight, Clock3, Crown, Handshake, House, Maximize, Menu, MessageSquare, Minimize, Plus, Send, Smile, Sparkles, Ticket, Users, Vote, X } from 'lucide-react';
import { getBoard, getCardDecks } from '../shared/board.js';
import { Token } from './Board.jsx';
import { useGame } from './game-context.jsx';
import { ContractDetails, waitingFor } from './Panels.jsx';
import { money, spaceName } from './themes.js';
import { releaseCardName } from './release-cards.js';
import EmotePicker from './EmotePicker.jsx';

// Mirror the rules engine's seat traversal, including seats that miss a turn.
export function nextTurnPlayer(game) {
  if (!game?.players?.length || game.status !== 'playing') return null;
  const seats = game.players.map(player => ({ ...player }));
  let index = seats.findIndex(player => player.id === game.currentPlayerId);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    index = (index + 1) % seats.length;
    const next = seats[index];
    if (next.bankrupt) continue;
    if (next.skipTurns > 0) { next.skipTurns -= 1; continue; }
    return next;
  }
  return null;
}

export function PlayerRail({ seatLimit }) {
  const { room, visualGame: game, players, playerId, copyInvite } = useGame();
  const board = getBoard(game || room.theme);
  const next = nextTurnPlayer(game);
  const rail = useRef(null);
  useEffect(() => { rail.current?.querySelector('.player-card.current')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [game?.currentPlayerId]);
  return <aside className="players-panel player-rail" aria-label="Players at this table" data-testid="player-rail">
    <div className="panel-heading"><h2><Users size={14} />Players</h2><span className="count-badge">{players.length}/{seatLimit}</span></div>
    <div ref={rail} className="player-list" style={{ '--visible-players': Math.min(players.length, 3) }}>{players.map(player => {
      const current = game?.currentPlayerId === player.id;
      const owned = board.filter(space => game?.properties?.[space.id]?.ownerId === player.id);
      return <article className={`player-card ${current ? 'current' : ''} ${player.bankrupt ? 'bankrupt-player' : ''}`} key={player.id} style={{ '--player-color': player.color }} data-player-id={player.id} data-current={current}>
        <div className="player-token"><Token token={player.token} size={32} /><span className={`presence-dot ${player.connected ? 'online' : ''}`} title={player.connected ? 'Connected' : 'Away · seat saved'} /></div>
        <div className="player-details"><div className="player-name" title={player.name}><span className="player-name-text">{player.name}</span>{player.id === playerId && <small>YOU</small>}{player.id === room.hostId && <Crown size={11} className="host-crown" />}</div>
          <div className="player-money">{game ? money(player.cash) : <span className="ready-text">{player.connected ? 'Ready' : 'Seat saved'}</span>}</div>
          {game && <div className="player-state">{current ? <b className="current-label">CURRENT</b> : next?.id === player.id ? <b className="next-label">NEXT</b> : null}{player.bankrupt ? <span>Bankrupt</span> : player.inJail ? <span>{game.edition === 'inland' ? 'Traffic Jam' : 'In jail'}</span> : player.skipTurns > 0 ? <span>Misses {player.skipTurns} turn</span> : null}</div>}
          {owned.length > 0 && <div className="player-properties" aria-label={`${owned.length} properties`}>{owned.map(space => <i key={space.id} style={{ background: space.color || '#aaa69d' }} title={spaceName(space, room.theme)} />)}</div>}
        </div>
      </article>;
    })}</div>
    {room.status === 'lobby' && <button className="open-seat" onClick={copyInvite}><Plus size={16} /><span>Invite player</span></button>}
    <div className="rail-room"><span>ROOM {room.code}</span><span>{room.status === 'lobby' ? 'Lobby' : `ROUND ${game?.round || 1}`}</span></div>
  </aside>;
}

export function TurnStrip() {
  const { visualGame: game, room, players, playerId, presentation } = useGame();
  const currentId = presentation.active ? presentation.playerId || game?.currentPlayerId : game?.currentPlayerId;
  const current = players.find(player => player.id === currentId);
  const next = nextTurnPlayer(game);
  const extraRoll = game?.doubles > 0 && !current?.inJail && ['roll', 'buy'].includes(game?.phase);
  const instruction = game?.status === 'finished' ? 'Game complete' : presentation.active ? presentation.rolling ? 'Rolling the dice…' : 'Moving around the board…' : extraRoll ? 'Doubles · another roll this turn' : current?.inJail ? game.edition === 'inland' ? 'Traffic Jam' : 'In jail' : '';
  if (!game) return <div className="turn-strip lobby-strip"><span className="turn-number">LOBBY</span><div><strong>{room.theme === 'inland-empire' ? 'Inland Empire-opoly' : 'Classic Openopoly'}</strong><span>Choose a token, invite players, then start.</span></div><span className="turn-next">{players.length} players ready</span></div>;
  return <div className={`turn-strip ${currentId === playerId ? 'your-turn' : ''}`} data-testid="turn-strip" aria-live="polite">
    <span className="turn-number">TURN<strong>{game.turn}</strong></span>
    <div className="turn-current" key={currentId}><span className="turn-color" style={{ background: current?.color }} /><div><strong>{currentId === playerId ? 'Your turn' : `${current?.name}’s turn`}</strong>{instruction && <span>{instruction}</span>}</div></div>
    {next && <div className="turn-next" data-testid="next-player"><span>NEXT TURN</span><strong><i style={{ background: next.color }} />{next.name}</strong></div>}
  </div>;
}

export function PlayerHUD() {
  const { visualGame: game, playerId, players, setPanel, setComposer, pending, connected, presentation } = useGame();
  const me = players.find(player => player.id === playerId);
  const count = Object.values(game?.properties || {}).filter(property => property.ownerId === playerId).length;
  const cardCount = me?.jailCards?.length || 0;
  const cardLabel = `Your cards: ${cardCount} ${releaseCardName(game)} card${cardCount === 1 ? '' : 's'}`;
  return <div className="player-hud" data-player-id={playerId}><div className="hud-token" style={{ '--player-color': me?.color }}><Token token={me?.token} size={29} /></div><div><span>{me?.name}<small>YOU</small></span><strong>{game ? money(me?.cash) : 'Ready to play'}</strong></div>{game && <><button className="hud-property-button" onClick={() => setPanel('properties')}><House size={15} /><strong>{count}</strong><span>properties</span></button><button className={`hud-card-button ${cardCount ? 'has-cards' : ''}`} data-testid="card-inventory-button" aria-label={cardLabel} title={`${cardLabel}. View your inventory.`} onClick={() => setPanel('properties')}><Ticket size={17} /><strong>{cardCount}</strong><span>cards</span></button></>}<button className="send-money-button" aria-label="Send money" title="Send money directly" disabled={!game || game.status !== 'playing' || me?.bankrupt || Boolean(pending) || !connected || presentation.active || game?.debt?.playerId === playerId || (me?.cash || 0) - (game?.auction?.highestBidderId === playerId ? game.auction.currentBid : 0) <= 0} onClick={() => setComposer('money')}><Send size={15} /><span>Send money</span></button></div>;
}

export function CurrentSpace() {
  const { room, visualGame: game, players, presentation, setSelected } = useGame();
  if (!game) return null;
  const actorId = presentation.active ? presentation.playerId || game.currentPlayerId : game.currentPlayerId;
  const current = players.find(player => player.id === actorId);
  const position = presentation.movement?.to ?? presentation.positions[actorId] ?? current?.position;
  const space = getBoard(game || room.theme).find(item => item.id === position);
  return <button type="button" className="context-space" data-testid="context-space" disabled={!space || presentation.active} onClick={() => setSelected(space.id)}><i style={{ background: space?.color || current?.color }} /><span><small>{presentation.active ? 'MOVING TO' : 'CURRENT SPACE'}</small><strong>{space ? spaceName(space, room.theme) : 'Starting in the center'}</strong><span className="context-inspect"><BookOpen size={15} />View details{space?.price > 0 && <b>{money(space.price)}</b>}<ChevronRight size={14} /></span></span></button>;
}

export function ContextActions() {
  const { room, game, playerId, me, pending, connected, presentation, setSelected, setComposer } = useGame();
  const board = getBoard(game || room.theme);
  const allowed = game?.permittedActions?.[playerId] || [];
  const availableCash = (me?.cash || 0) - (game?.auction?.highestBidderId === playerId ? game.auction.currentBid : 0);
  const buildable = allowed.includes('build') && board.find(space => {
    const property = game.properties[space.id];
    if (space.type !== 'property' || property?.ownerId !== playerId || property.houses >= 5 || availableCash < space.houseCost) return false;
    const group = board.filter(item => item.group === space.group);
    return group.every(item => game.properties[item.id]?.ownerId === playerId && !game.properties[item.id]?.mortgaged && game.properties[item.id].houses >= property.houses)
      && (property.houses < 4 ? game.bank.houses > 0 : game.bank.hotels > 0);
  });
  if (!game || game.status !== 'playing') return null;
  const busy = Boolean(pending) || !connected || presentation.active;
  return <div className="context-actions" aria-label="Table actions"><button type="button" className="btn" aria-label="Request a contract" disabled={busy || me?.bankrupt} onClick={() => setComposer('contract')}><Handshake size={17} />Trade / contract</button><button type="button" className="btn" aria-label="Build on your color group" title={buildable ? `Manage ${spaceName(buildable, room.theme)}` : 'A complete unmortgaged color group, enough cash and bank buildings are required.'} disabled={busy || !buildable} onClick={() => setSelected(buildable.id)}><House size={17} />Build</button></div>;
}

export function GameTools({ openContracts, openVotes }) {
  const { room, game, playerId, panel, setPanel, setComposer, me, presentation } = useGame();
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  const [cameraOpen, setCameraOpen] = useState(false);
  useEffect(() => { if (panel) setCameraOpen(false); }, [panel]);
  useEffect(() => {
    if (!cameraOpen) return;
    const outside = event => { if (!event.target.closest('.scene-camera-bar,.scene-view-controls,.mobile-camera-trigger')) setCameraOpen(false); };
    const escape = event => { if (event.key === 'Escape') setCameraOpen(false); };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [cameraOpen]);
  const readKey = `monopoly-chat-read-${room.code}-${playerId}`;
  const [readId, setReadId] = useState(() => localStorage.getItem(readKey));
  useEffect(() => { setReadId(localStorage.getItem(readKey)); }, [readKey]);
  useEffect(() => {
    const change = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);
  useEffect(() => {
    if (panel !== 'chat' || !room.chat?.length) return;
    const id = room.chat.at(-1).id; setReadId(id); localStorage.setItem(readKey, id);
  }, [panel, room.chat, readKey]);
  const lastRead = room.chat?.findIndex(message => message.id === readId) ?? -1;
  const unread = (room.chat || []).slice(lastRead + 1).filter(message => message.playerId !== playerId).length;
  const proposals = room.contracts?.filter(contract => contract.status === 'proposed').length || 0;
  const toolsList = [
    ['properties', House, 'Properties', 0], ['contracts', Handshake, 'Contracts', proposals || openContracts],
    ['votes', Vote, 'Votes', openVotes], ['activity', Bell, 'Activity', 0], ['chat', MessageSquare, 'Chat', panel === 'chat' ? 0 : unread],
  ];
  const toggleFullscreen = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { /* Browser may deny fullscreen outside a gesture. */ }
  };
  return <div className={`game-tools ${cameraOpen ? 'camera-tools-open' : ''}`}><button className="mobile-camera-trigger" aria-label="Board camera controls" aria-expanded={cameraOpen} onClick={() => setCameraOpen(value => !value)}><Camera size={20} /><span>Camera</span></button><button className="mobile-player-trigger" data-testid="players-toggle" aria-label={`Players (${room.players.length})`} aria-expanded={panel === 'players'} onClick={() => setPanel(panel === 'players' ? null : 'players')}><Users size={20} /><span>{room.players.length}</span></button><button className="mobile-chat-trigger" aria-label={`Chat${unread ? ` (${unread})` : ''}`} onClick={() => setPanel('chat')}><MessageSquare size={21} />{unread > 0 && <b className="tool-badge">{unread}</b>}</button><button className="mobile-tools-trigger" aria-label="Open game tools" onClick={() => setPanel('menu')}><Menu size={21} /><span>Tools</span>{proposals > 0 && <b className="tool-badge">{proposals}</b>}</button><button className="emote-tools-button" aria-label="React" title="React to the table, a player or a property" onClick={() => setPanel('emotes')}><Smile size={20} /><span>React</span></button><nav className="drawer-tabs" role="tablist" aria-label="Game drawers">{toolsList.map(([id, Icon, label, count]) => <button role="tab" key={id} aria-selected={panel === id} aria-label={`${label}${count ? ` (${count})` : ''}`} className={panel === id ? 'active' : ''} onClick={() => setPanel(panel === id ? null : id)}><Icon size={18} /><span>{label}</span>{count > 0 && <b className="tool-badge">{count}</b>}</button>)}</nav><button className="new-contract-button" aria-label="Request a contract" disabled={!game || room.status !== 'playing' || me?.bankrupt || presentation.active} onClick={() => setComposer('contract')}><Plus size={15} /><Handshake size={18} /><span>New contract</span></button><button className="fullscreen-button icon-button" aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} onClick={toggleFullscreen}>{fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}</button></div>;
}

function MobileGameMenu() {
  const { room, game, playerId, me, pending, connected, presentation, setPanel, setComposer, setModal, copyInvite } = useGame();
  const openComposer = type => { setPanel(null); setComposer(type); };
  const canSend = game?.status === 'playing' && !me?.bankrupt && !pending && connected && !presentation.active && game.debt?.playerId !== playerId && (me?.cash || 0) - (game.auction?.highestBidderId === playerId ? game.auction.currentBid : 0) > 0;
  const proposalCount = room.contracts?.filter(contract => contract.status === 'proposed').length || 0;
  const entries = [['players', Users, 'Players'], ['properties', House, 'Properties & cards'], ['contracts', Handshake, 'Contracts', proposalCount], ['chat', MessageSquare, 'Chat'], ['emotes', Smile, 'React'], ['votes', Vote, 'Votes'], ['activity', Bell, 'Activity']];
  return <div className="mobile-game-menu"><div className="mobile-menu-grid">{entries.map(([id, Icon, label, count]) => <button type="button" key={id} onClick={() => setPanel(id)}><Icon size={25} /><span>{label}</span>{count > 0 && <b>{count} waiting</b>}</button>)}</div><div className="mobile-menu-actions"><button type="button" className="btn primary" aria-label="Request a contract" disabled={!game || room.status !== 'playing' || me?.bankrupt || presentation.active} onClick={() => openComposer('contract')}><Handshake size={20} />New contract</button><button type="button" className="btn" aria-label="Send money" disabled={!canSend} onClick={() => openComposer('money')}><Send size={20} />Send money</button><button type="button" className="btn ghost" onClick={copyInvite}><Users size={20} />Invite players</button><button type="button" className="btn ghost" onClick={() => { setPanel(null); setModal('rules'); }}><BookOpen size={20} />Game rules</button><button type="button" className="btn ghost" onClick={async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch {} setPanel(null); }}><Maximize size={19} />{document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen'}</button></div></div>;
}

export function GameDrawer({ children }) {
  const { panel, setPanel, room } = useGame();
  const ref = useRef(null);
  useEffect(() => {
    if (!panel) return;
    const previous = document.activeElement;
    const keydown = event => {
      if (document.querySelector('.modal-backdrop')) return;
      if (event.key === 'Escape') setPanel(null);
      if (event.key === 'Tab' && window.matchMedia('(max-width:600px),(max-width:1000px) and (max-height:500px) and (pointer:coarse)').matches) {
        const focusable = [...ref.current.closest('.game-drawer').querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')].filter(element => element.getClientRects().length);
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', keydown);
    ref.current?.focus();
    return () => { window.removeEventListener('keydown', keydown); if (previous?.isConnected && previous.getClientRects().length) previous.focus(); else document.querySelector('.mobile-tools-trigger')?.focus(); };
  }, [panel, setPanel]);
  if (!panel) return null;
  return <aside className={`game-drawer drawer-${panel}`} aria-label={`${panel[0].toUpperCase()}${panel.slice(1)} drawer`} data-testid="game-drawer"><header className="drawer-header"><span>{panel === 'contracts' ? 'Agreements & payments' : panel === 'menu' ? 'Game tools' : panel === 'emotes' ? 'React' : `Table ${panel}`}</span><button ref={ref} className="icon-button" aria-label="Close drawer" onClick={() => setPanel(null)}><X size={21} /></button></header><div className="drawer-body">{panel === 'emotes' ? <EmotePicker /> : panel === 'menu' ? <MobileGameMenu /> : panel === 'players' ? <PlayerRail seatLimit={room.theme === 'inland-empire' ? 6 : 8} /> : children}</div></aside>;
}

export function SharedEvents() {
  const { room, game, players, presentation, setPanel } = useGame();
  const [dismissedCard, setDismissedCard] = useState('');
  const [artwork, setArtwork] = useState({});
  useEffect(() => { let active = true; fetch('/assets/card-art/manifest.json').then(response => response.ok ? response.json() : null).then(manifest => { if (active && manifest) setArtwork(Object.fromEntries(manifest.assets.flatMap(asset => asset.cards.map(id => [id, asset.file])))); }).catch(() => {}); return () => { active = false; }; }, []);
  const card = game?.lastCard;
  const cardEvent = game?.log?.findLast(event => event.type === 'card');
  const cardKey = card ? `${card.id}-${cardEvent?.seq || game.turn}` : '';
  const actor = players.find(player => player.id === (presentation.playerId || game?.currentPlayerId));
  const moves = presentation.presentation?.moves || [];
  const segmentIndex = moves.findIndex((move, index) => presentation.serverTime < move.endsAt && (presentation.serverTime >= move.startedAt || (index > 0 && presentation.serverTime >= moves[index - 1].endsAt)));
  const segment = moves[segmentIndex];
  const moveEvents = (presentation.presentation?.events || []).filter(event => ['move', 'jail'].includes(event.type));
  const segmentEventIndex = presentation.presentation?.events?.indexOf(moveEvents[segmentIndex]) ?? -1;
  const moveCardEvent = segmentEventIndex >= 0 ? presentation.presentation.events.slice(0, segmentEventIndex).findLast(event => event.type === 'card') : null;
  const moveCard = moveCardEvent ? Object.values(getCardDecks(game || room.theme)).flat().find(item => item.id === moveCardEvent.cardId) : null;
  const destination = segment ? spaceName(getBoard(game || room.theme)[segment.to], room.theme) : null;
  const lastPublicEvent = game?.log?.findLast(event => !['roll', 'move', 'turn', 'card', 'start'].includes(event.type));
  const [resultKey, setResultKey] = useState(null);
  useEffect(() => {
    if (presentation.active || !lastPublicEvent) return;
    setResultKey(lastPublicEvent.id);
    const timer = setTimeout(() => setResultKey(null), 6500);
    return () => clearTimeout(timer);
  }, [lastPublicEvent?.id, presentation.active]);
  if (!game) return null;
  if (presentation.active) return <div className={`presentation-notice ${moveCard ? 'card-movement-notice' : ''}`} role="status" data-testid="shared-presentation"><span className="loading-ring" /><div><strong>{moveCard ? `${actor?.name} drew ${moveCard.title}` : `${actor?.name} ${presentation.rolling ? 'is rolling' : presentation.moving ? 'is moving' : 'is landing'}`}</strong><span>{presentation.rolling ? 'Dice are in play' : moveCard ? `Card instruction · move to ${destination}` : destination ? `Moving to ${destination}` : 'Finishing the shared move'}</span>{moveCard && <small data-testid="card-movement-reason">{moveCard.text}</small>}</div></div>;
  const decision = Boolean(game.pendingMortgage || ['buy', 'auction', 'debt'].includes(game.phase));
  return <>
    {card && dismissedCard !== cardKey && <article className={`shared-card-event ${decision ? 'alongside-decision' : ''}`} role="status" data-testid="shared-card"><button className="icon-button" onClick={() => setDismissedCard(cardKey)} aria-label="Dismiss card"><X size={16} /></button><span className="event-eyebrow"><Sparkles size={14} />{card.deck === 'chance' ? room.theme === 'inland-empire' ? 'CONTINGENCY' : 'CHANCE' : room.theme === 'inland-empire' ? 'BIG FUN' : 'COMMUNITY CHEST'}</span>{room.theme === 'classic' && artwork[card.id] && <img src={`/assets/card-art/${artwork[card.id]}`} alt="Drawn card illustration" />}<h3>{card.title}</h3><p>{card.text}</p><small>{players.find(player => player.id === card.playerId)?.name}{card.verification === 'classic-fallback-unverified' ? ' · Original card unavailable; compatible fallback' : ''}</small></article>}
    {resultKey === lastPublicEvent?.id && !card && !decision && <button className="shared-result" onClick={() => { setPanel('activity'); setResultKey(null); }} data-testid="shared-result"><CheckCheck size={18} /><span>{lastPublicEvent.message}</span><ChevronRight size={16} /></button>}
  </>;
}

export function ContractAnnouncements() {
  const { room, game, players, playerId, presentation, composer, panel, setPanel } = useGame();
  const [dismissed, setDismissed] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const proposals = (room.contracts || []).filter(contract => contract.status === 'proposed');
  const active = proposals.find(contract => contract.id === selectedId) || proposals.find(contract => !dismissed[`${contract.id}:${contract.revision}`]);
  const latestChange = useMemo(() => (room.contracts || []).filter(contract => ['active', 'completed', 'rejected', 'cancelled'].includes(contract.status)).sort((a, b) => new Date(b.executedAt || b.events?.at(-1)?.at || b.createdAt) - new Date(a.executedAt || a.events?.at(-1)?.at || a.createdAt))[0], [room.contracts]);
  const [completion, setCompletion] = useState(null);
  const seenChanges = useRef(new Set());
  const latestChangeKey = latestChange ? `${latestChange.id}:${latestChange.revision}:${latestChange.status}` : '';
  useEffect(() => {
    if (!latestChange) return;
    const key = `${latestChange.id}:${latestChange.revision}:${latestChange.status}`;
    if (seenChanges.current.has(key)) return;
    seenChanges.current.add(key);
    const at = new Date(latestChange.executedAt || latestChange.events?.at(-1)?.at || latestChange.createdAt).getTime();
    if (Date.now() - at > 15000) return;
    setCompletion(latestChange);
    const timer = setTimeout(() => setCompletion(null), 6500);
    return () => clearTimeout(timer);
  }, [latestChangeKey]);
  const dismiss = () => { if (active) setDismissed(current => ({ ...current, [`${active.id}:${active.revision}`]: true })); setSelectedId(null); };
  const decisionOpen = game && (game.pendingMortgage || ['buy', 'auction', 'debt'].includes(game.phase) || (['roll', 'end'].includes(game.phase) && game.players.find(player => player.id === game.currentPlayerId)?.inJail));
  const showNotice = active && !presentation.active && !decisionOpen && !composer && panel !== 'contracts';
  return <>
    {proposals.length > 0 && <div className="pending-agreements" data-testid="pending-agreements"><Handshake size={15} /><strong>{proposals.length} waiting agreement{proposals.length > 1 ? 's' : ''}</strong><button onClick={() => { const next = proposals.find(contract => contract.id !== active?.id) || proposals[0]; setSelectedId(next.id); }}>Review</button><button className="icon-button" aria-label="Open all waiting agreements" onClick={() => setPanel('contracts')}><ChevronRight size={16} /></button></div>}
    {showNotice && <section className="contract-announcement" role="region" aria-label="Contract proposal" data-testid="contract-announcement"><header><span className="event-eyebrow"><Handshake size={15} />CONTRACT PROPOSED{proposals.length > 1 && ` · ${proposals.length} WAITING`}</span><button className="icon-button" aria-label="Dismiss contract notice" onClick={dismiss}><X size={17} /></button></header><h2>{active.title}</h2><p className="announcement-parties">{active.partyIds.map(id => players.find(player => player.id === id)?.name).join(' & ')}<span>Revision {active.revision}</span></p><div className="announcement-scroll"><ContractDetails contract={active} compact /></div><div className="announcement-waiting"><Clock3 size={15} /><span>{waitingFor(active, players)}</span></div>{!active.partyIds.includes(playerId) && <p className="observer-note">The two players review and sign. Everyone can see this agreement.</p>}</section>}
    {completion && !showNotice && !presentation.active && <button className="agreement-result" onClick={() => { setPanel('contracts'); setCompletion(null); }} role="status"><CheckCheck size={18} /><span><strong>{completion.title}</strong>{completion.status === 'active' ? 'Both signed · transfers complete, future payments scheduled' : completion.status === 'completed' ? 'Agreement completed' : completion.status === 'rejected' ? 'Proposal declined' : 'Proposal cancelled'}</span></button>}
  </>;
}
