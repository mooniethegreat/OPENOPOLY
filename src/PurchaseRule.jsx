import React, { useId } from 'react';
import './purchase-rule.css';

export default function PurchaseRule({ checked = false, disabled = false, onChange, locked = false }) {
  const description = useId();
  return <label className="purchase-rule"><input type="checkbox" checked={checked} disabled={disabled || locked} onChange={event => onChange?.(event.target.checked)} aria-label="Allow passing on unowned properties" aria-describedby={description} /><span><strong>Allow passing on unowned properties</strong><small id={description}>{locked ? 'Fixed for this game. ' : ''}Players may leave a deed with the bank without an auction.{!locked && ' Locks when the game starts.'}</small></span></label>;
}
