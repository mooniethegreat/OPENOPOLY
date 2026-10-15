import { randomUUID } from 'node:crypto';
import { assert, integer, text } from './validation.js';

export function expireVotes(room, now = Date.now()) {
  for (const vote of room.votes) {
    if (vote.status === 'open' && Date.parse(vote.expiresAt) <= now) {
      vote.status = 'expired';
      vote.closedAt = new Date(now).toISOString();
    }
  }
}

export function handleVote(room, actorId, action) {
  expireVotes(room);
  if (action.type === 'vote:propose') {
    assert(room.votes.filter(v => v.status === 'open').length < 20, 'There are already 20 open proposals');
    assert(['majority', 'unanimous'].includes(action.rule), 'Choose majority or unanimous approval');
    const duration = integer(action.durationMinutes ?? 15, 'Vote duration', 1, 1440);
    const eligibleIds = room.players.filter(p => !room.game?.players.find(g => g.id === p.id)?.bankrupt).map(p => p.id);
    assert(eligibleIds.includes(actorId), 'Only active players can propose a vote');
    // Votes record room decisions. The host retains the exclusive theme control.
    assert(!action.action, 'Votes record proposals; the host applies agreed room changes');
    room.votes.unshift({
      id: randomUUID(), proposerId: actorId,
      title: text(action.title, 'Proposal title', 1, 100),
      details: text(action.details ?? '', 'Proposal details', 0, 2000),
      rule: action.rule, eligibleIds, ballots: {}, status: 'open',
      threshold: action.rule === 'unanimous' ? eligibleIds.length : Math.floor(eligibleIds.length / 2) + 1,
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + duration * 60000).toISOString(),
    });
    return;
  }
  const vote = room.votes.find(v => v.id === action.voteId);
  assert(vote, 'Proposal not found');
  assert(vote.status === 'open', 'This vote has closed');
  if (action.type === 'vote:cancel') {
    assert(vote.proposerId === actorId, 'Only the proposer can withdraw this vote');
    vote.status = 'cancelled';
  } else {
    assert(action.type === 'vote:cast', 'Unknown voting action');
    assert(vote.eligibleIds.includes(actorId), 'You are not eligible for this vote');
    assert(!vote.ballots[actorId], 'You have already voted');
    assert(action.choice === 'yes' || action.choice === 'no', 'Vote yes or no');
    vote.ballots[actorId] = action.choice;
    const yes = Object.values(vote.ballots).filter(v => v === 'yes').length;
    const no = Object.values(vote.ballots).filter(v => v === 'no').length;
    if (yes >= vote.threshold) vote.status = 'approved';
    else if (vote.eligibleIds.length - no < vote.threshold) vote.status = 'rejected';
  }
  if (vote.status !== 'open') vote.closedAt = new Date().toISOString();
}
