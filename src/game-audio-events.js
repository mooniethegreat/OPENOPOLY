import { committedPayment } from './payment-feedback.js';
import { EMOTE_IMPACT_FRACTION } from './emote-visual.js';

const MAX_CUES = 80;
const validSeq = event => Number.isSafeInteger(event.seq) && event.seq > 0;
const listIds = list => (list || []).map(item => item.id).filter(Boolean);
const contractState = contract => ({ revision: contract.revision, status: contract.status, signatures: (contract.signatures || []).map(item => item.playerId).sort().join(',') });
const voteState = vote => `${vote.status}:${Object.entries(vote.ballots || {}).sort().map(([id, choice]) => `${id}:${choice}`).join(',')}`;
const makeCue = (id, kind, at, extra = {}) => ({ id, kind, at, ...extra });

export function emoteSoundCue(event) {
  const tossed = event.kind === 'poop';
  return makeCue(`emote:${event.id}`, tossed ? 'splat' : 'reaction', event.startedAt + (tossed ? (event.endsAt - event.startedAt) * EMOTE_IMPACT_FRACTION : 0));
}

/** Times are server milliseconds, using the same move ordering as the board. */
export function presentationSoundCues(timeline) {
  if (!timeline?.id || !Number.isFinite(timeline.startedAt) || !Number.isFinite(timeline.endsAt)) return { cues: [], eventTimes: new Map() };
  const cues = [], eventTimes = new Map();
  const rollEndsAt = Number.isFinite(timeline.rollEndsAt) ? timeline.rollEndsAt : timeline.startedAt;
  if (Array.isArray(timeline.dice) && rollEndsAt > timeline.startedAt) {
    for (let at = timeline.startedAt, index = 0; at < rollEndsAt - 120 && index < 8; at += 220, index += 1) {
      cues.push(makeCue(`${timeline.id}:dice:${index}`, 'dice', at, { presentationId: timeline.id, variant: index }));
    }
    cues.push(makeCue(`${timeline.id}:clack`, 'clack', rollEndsAt, { presentationId: timeline.id }));
  }
  const moves = timeline.moves || [];
  for (let index = 0; index < moves.length; index += 1) {
    const move = moves[index];
    if (move.direct || !Number.isFinite(move.startedAt) || !Number.isFinite(move.endsAt)) continue;
    const steps = Math.min(40, Array.isArray(move.path) ? move.path.length : 0);
    for (let step = 0; step < steps; step += 1) {
      cues.push(makeCue(`${timeline.id}:move:${index}:${step}`, 'step', move.startedAt + (move.endsAt - move.startedAt) * (step + 1) / steps, { presentationId: timeline.id, variant: step }));
    }
  }
  let resolvedAt = rollEndsAt, moveIndex = 0;
  for (const event of timeline.events || []) {
    if (event.type === 'move' || event.type === 'jail') resolvedAt = moves[moveIndex++]?.endsAt ?? resolvedAt;
    if (event.id) eventTimes.set(event.id, resolvedAt);
  }
  return { cues: cues.slice(0, MAX_CUES), eventTimes };
}

export function eventSoundKinds(room, playerId, event) {
  const sounds = [];
  const payment = committedPayment(room, event);
  if (payment) sounds.push(payment.to === playerId ? 'money-in' : payment.from === playerId ? 'money-out' : 'money');
  if (event.type === 'card' || event.type === 'releaseJail' && event.deck) sounds.push('card');
  else if (event.type === 'purchase') sounds.push('purchase');
  else if (event.type === 'buildGroup' || event.type === 'build' && !event.groupBuildId) sounds.push('build');
  else if (event.type === 'jail' || event.type === 'jailAttempt') sounds.push('jail');
  else if (event.type === 'bankruptcy') sounds.push('bankruptcy');
  else if (event.type === 'win') sounds.push('win');
  else if (event.type === 'start') sounds.push('start');
  else if (event.type === 'turn') sounds.push('turn');
  else if (event.type === 'releaseJail') sounds.push('release');
  else if (event.type === 'bid') sounds.push('bid');
  else if (event.type === 'passAuction') sounds.push('click');
  else if (event.type === 'auctionClosed') sounds.push('signature');
  else if (event.type === 'auction' || event.type === 'debt') sounds.push('popup');
  else if (event.type === 'utilityRoll') sounds.push('clack');
  return sounds;
}

/** Consume public snapshots once. Hydration and older ACKs cannot replay history. */
export function advanceAudioFeed(cursor, room, playerId, now = room?.serverNow ?? Date.now()) {
  if (!room?.code || !playerId) return { cursor: null, cues: [], presentationId: null };
  const scope = `${room.code}:${playerId}`;
  const events = (room.game?.log || []).filter(validSeq);
  const seq = Math.max(0, ...events.map(event => event.seq));
  const contracts = Object.fromEntries((room.contracts || []).map(item => [item.id, contractState(item)]));
  const votes = Object.fromEntries((room.votes || []).map(item => [item.id, voteState(item)]));
  const next = { scope, seq: Math.max(seq, cursor?.scope === scope ? cursor.seq : 0), version: room.version ?? 0, serverNow: room.serverNow ?? 0, contracts, votes, chat: listIds(room.chat), presentations: [...(cursor?.scope === scope ? cursor.presentations || [] : [])] };
  const presentationId = room.presentation?.id || null;
  if (presentationId && !next.presentations.includes(presentationId)) next.presentations.push(presentationId);
  next.presentations = next.presentations.slice(-16);
  if (cursor?.scope !== scope) return { cursor: next, cues: [], presentationId };
  if ((room.version ?? 0) < cursor.version || seq < cursor.seq || (room.version ?? 0) === cursor.version && (room.serverNow ?? 0) < cursor.serverNow) return { cursor, cues: [], presentationId: cursor.presentationId ?? presentationId };
  const freshEvents = events.filter(event => event.seq > cursor.seq).sort((a, b) => a.seq - b.seq);
  const timeline = room.presentation;
  const freshTimeline = timeline && !cursor.presentations.includes(timeline.id) && freshEvents.some(event => (timeline.events || []).some(item => item.id === event.id));
  const timed = freshTimeline ? presentationSoundCues(timeline) : { cues: [], eventTimes: new Map() };
  const cues = [...timed.cues];
  for (const event of freshEvents) {
    const at = timed.eventTimes.get(event.id) ?? now;
    for (const kind of eventSoundKinds(room, playerId, event)) cues.push(makeCue(`${scope}:${event.id}:${kind}`, kind, at, { presentationId: timed.eventTimes.has(event.id) ? timeline.id : null }));
  }
  for (const contract of room.contracts || []) {
    const previous = cursor.contracts[contract.id], current = contracts[contract.id];
    if (!previous || current.revision !== previous.revision) cues.push(makeCue(`${scope}:contract:${contract.id}:${current.revision}:proposal`, 'proposal', now));
    else if (current.signatures !== previous.signatures || current.status !== previous.status) cues.push(makeCue(`${scope}:contract:${contract.id}:${current.revision}:${current.signatures}:${current.status}`, 'signature', now));
  }
  for (const vote of room.votes || []) {
    if (cursor.votes[vote.id] !== votes[vote.id]) cues.push(makeCue(`${scope}:vote:${vote.id}:${votes[vote.id]}`, 'vote', now));
  }
  // One soft notification for a chat burst, independent of its text or sender.
  const newChat = (room.chat || []).filter(item => !cursor.chat.includes(item.id));
  if (newChat.length) cues.push(makeCue(`${scope}:chat:${newChat.at(-1).id}`, 'chat', now));
  return { cursor: { ...next, presentationId }, cues: cues.sort((a, b) => a.at - b.at).slice(0, MAX_CUES), presentationId };
}
