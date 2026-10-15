import React, { useEffect, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, X } from 'lucide-react';
import { advancePaymentFeed, enqueuePayments } from './payment-feedback.js';
import { money } from './themes.js';
import './payment-feedback.css';

export default function PaymentFeedback({ room, playerId, presentation }) {
  const cursor = useRef(null);
  const [queue, setQueue] = useState([]);
  useEffect(() => {
    const previousScope = cursor.current?.scope;
    const update = advancePaymentFeed(cursor.current, room, playerId);
    cursor.current = update.cursor;
    if (update.cursor?.scope !== previousScope) setQueue([]);
    if (update.payments.length) setQueue(current => enqueuePayments(current, update.payments));
  }, [room, playerId]);
  const current = queue[0];
  const paused = Boolean(presentation?.active);
  useEffect(() => {
    if (!current || paused) return;
    const timer = setTimeout(() => setQueue(items => items[0]?.id === current.id ? items.slice(1) : items), 5500);
    return () => clearTimeout(timer);
  }, [current?.id, paused]);
  if (!current || paused || cursor.current?.scope !== `${room?.code}:${playerId}`) return null;
  const incoming = current.direction === 'incoming';
  const parties = current.parties.join(', ');
  return <aside className={`payment-feedback ${current.direction}`} data-testid="payment-feedback" data-payment-id={current.id} data-payment-direction={current.direction} role="status" aria-live="polite" aria-atomic="true" key={current.id}>
    <div className="payment-feedback-symbol">{incoming ? <ArrowDownLeft size={28} /> : <ArrowUpRight size={28} />}</div>
    <div className="payment-feedback-copy">
      <span className="payment-feedback-label">{incoming ? 'Money received' : 'Money paid'}</span>
      <strong className="payment-feedback-amount">{incoming ? '+' : '−'}{money(current.amount)}</strong>
      <p className="payment-feedback-party">{incoming ? 'Paid by' : 'Paid to'} {parties}</p>
      {current.items.map(item => <p className="payment-feedback-reason" key={item.id}>{current.count > 1 && <b>{money(item.amount)} · </b>}{item.reason}</p>)}
      {current.count > current.items.length && <small>+{current.count - current.items.length} more payment{current.count - current.items.length === 1 ? '' : 's'} · details in Activity</small>}
      {queue.length > 1 && <small>{queue.length - 1} more payment update{queue.length === 2 ? '' : 's'} waiting</small>}
    </div>
    <button type="button" className="payment-feedback-dismiss" aria-label="Dismiss payment notification" onClick={() => setQueue(items => items.slice(1))}><X size={18} /></button>
  </aside>;
}
