import React from 'react';
import { Check, Moon, Sun } from 'lucide-react';

export const PALETTES = [
  { id: 'graphite', name: 'Graphite', color: '#4b4b4b' },
  { id: 'forest', name: 'Forest', color: '#779765' },
  { id: 'slate', name: 'Slate', color: '#7e8fad' },
  { id: 'ocean', name: 'Ocean', color: '#3e95b6' },
  { id: 'burgundy', name: 'Burgundy', color: '#a06581' },
];
export const DEFAULT_APPEARANCE = { palette: 'graphite', mode: 'dark' };
export function readAppearance() {
  try {
    const value = JSON.parse(localStorage.getItem('monopoly-appearance-v1') || 'null');
    return { palette: PALETTES.some(palette => palette.id === value?.palette) ? value.palette : DEFAULT_APPEARANCE.palette, mode: value?.mode === 'light' ? 'light' : 'dark' };
  } catch { return DEFAULT_APPEARANCE; }
}

export default function AppearanceControls({ appearance, onChange, disabled, inRoom, isHost }) {
  return <div className="appearance-controls">
    <p className="appearance-description">{inRoom ? isHost ? 'Changes apply to every player immediately. Game rules and property colors stay the same.' : 'The host controls the room’s appearance. Changes apply to every player.' : 'Saved in this browser and used when you create a room.'}</p>
    <fieldset className="appearance-fieldset"><legend>Color theme</legend><div className="palette-options">{PALETTES.map(palette => <button type="button" key={palette.id} aria-label={palette.name} aria-pressed={appearance.palette === palette.id} disabled={disabled} className={`palette-option ${appearance.palette === palette.id ? 'selected' : ''}`} onClick={() => onChange({ ...appearance, palette: palette.id })}><span style={{ background: palette.color }}>{appearance.palette === palette.id && <Check size={17} />}</span><b>{palette.name}</b></button>)}</div></fieldset>
    <fieldset className="appearance-fieldset"><legend>Display mode</legend><div className="mode-options"><button type="button" aria-pressed={appearance.mode === 'dark'} disabled={disabled} className={appearance.mode === 'dark' ? 'selected' : ''} onClick={() => onChange({ ...appearance, mode: 'dark' })}><Moon size={17} />Dark</button><button type="button" aria-pressed={appearance.mode === 'light'} disabled={disabled} className={appearance.mode === 'light' ? 'selected' : ''} onClick={() => onChange({ ...appearance, mode: 'light' })}><Sun size={18} />Light</button></div></fieldset>
    {inRoom && <p className="appearance-status">{isHost ? 'Shared room appearance · host control' : 'Shared room appearance · read only'}</p>}
  </div>;
}
