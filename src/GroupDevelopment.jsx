import React, { useMemo, useState } from 'react';
import { Check, House } from 'lucide-react';
import { getBoard } from '../shared/board.js';
import { quoteGroupBuild } from '../shared/engine.js';
import { useGame } from './game-context.jsx';
import { money, spaceName } from './themes.js';
import './group-development.css';

export default function GroupDevelopment({ propertyId }) {
  const { room, playerId, action, pending, connected, presentation, notify } = useGame();
  const game = room.game, board = getBoard(game);
  const selected = board[propertyId];
  const group = board.filter(space => space.type === 'property' && space.group === selected.group);
  const minimum = Math.min(...group.map(space => game.properties[space.id].houses));
  const nextLevel = Math.min(5, minimum + 1);
  const [chosenLevel, setChosenLevel] = useState(nextLevel);
  const [review, setReview] = useState(null);
  const targetLevel = Math.max(nextLevel, chosenLevel);
  const complete = minimum === 5;
  const inland = game.edition === 'inland';
  const levelText = level => level === 5 ? inland ? 'Key to the City' : 'Hotel' : `${level} ${inland ? 'City Block' : 'house'}${level === 1 ? '' : 's'}`;
  const total = group.reduce((sum, space) => sum + Math.max(0, targetLevel - game.properties[space.id].houses) * space.houseCost, 0);
  const { quote, error } = useMemo(() => {
    if (complete) return { quote: null, error: '' };
    try { return { quote: quoteGroupBuild(game, playerId, propertyId, targetLevel), error: '' }; }
    catch (failure) { return { quote: null, error: failure.message }; }
  }, [game, playerId, propertyId, targetLevel, complete]);
  const allowed = game.permittedActions?.[playerId]?.includes('buildGroup');
  const busy = Boolean(pending) || !connected || presentation.active;
  const reviewCurrent = review && review.roomCode === room.code && review.decisionVersion === room.decisionVersion && review.propertyId === propertyId && review.targetLevel === targetLevel && review.cost === quote?.cost;
  const confirm = async () => {
    if (busy || !allowed || !reviewCurrent) return;
    if (await action({ type: 'buildGroup', propertyId: review.propertyId, targetLevel: review.targetLevel })) {
      setReview(null);
      notify(`Color group developed for ${money(review.cost)}.`);
    }
  };
  return <section className="group-development" aria-label="Build across color group" data-testid="group-development">
    <h4><House size={18} />Develop the whole color group</h4>
    <ul className="group-building-levels">{group.map(space => <li key={space.id} data-space-id={space.id}><span><i style={{ background: space.color }} />{spaceName(space, room.theme)}</span><strong>{levelText(game.properties[space.id].houses)}</strong></li>)}</ul>
    {complete ? <p className="group-build-complete"><Check size={16} />This group is fully developed.</p> : <>
      <label className="form-label">Build every property to<select aria-label="Color group building level" value={targetLevel} disabled={busy || Boolean(review)} onChange={event => setChosenLevel(Number(event.target.value))}>{Array.from({ length: 6 - nextLevel }, (_, index) => nextLevel + index).map(level => <option key={level} value={level}>{levelText(level)} each{level === nextLevel ? ' · next balanced level' : ''}</option>)}</select></label>
      <div className="group-build-cost"><span>Total for this group</span><strong>{money(quote?.cost ?? total)}</strong></div>
      {review ? <div className="group-build-review" data-testid="group-build-review"><strong>Review group development</strong><p>{review.propertyNames.join(' + ')} will each have {levelText(review.targetLevel)}. You pay {money(review.cost)} once.</p>{!reviewCurrent && <p className="group-build-error" role="status">The table changed. Go back and review the current price and buildings.</p>}<div><button className="btn ghost" disabled={busy} onClick={() => setReview(null)}>Back</button><button className="btn primary" disabled={busy || !allowed || !reviewCurrent} onClick={confirm}>{pending === 'buildGroup' ? 'Building…' : `Confirm group build · ${money(review.cost)}`}</button></div></div> : <>
        {error && <p className="group-build-error" role="status">{error}</p>}
        {quote && <p className="group-build-stock">Bank after building: {quote.bankAfter.houses} {inland ? 'City Blocks' : 'houses'} · {quote.bankAfter.hotels} {inland ? 'Keys' : 'hotels'}.</p>}
        <button className="btn primary group-build-button" disabled={busy || !allowed || !quote} onClick={() => setReview({ roomCode: room.code, decisionVersion: room.decisionVersion, propertyId, targetLevel, cost: quote.cost, propertyNames: group.map(space => spaceName(space, room.theme)) })}>Review group build · {money(quote?.cost ?? total)}</button>
      </>}
    </>}
  </section>;
}
