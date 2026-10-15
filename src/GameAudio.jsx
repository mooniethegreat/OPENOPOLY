import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX, X } from 'lucide-react';
import { advanceAudioFeed, emoteSoundCue } from './game-audio-events.js';
import { createAudioEngine, readAudioSettings, saveAudioSettings } from './game-audio-engine.js';
import './game-audio.css';

const localStorageOrNull = () => { try { return window.localStorage; } catch { return null; } };

export function useGameAudio({ room, playerId, connected, presentation, panel, composer, modal, selected, toast }) {
  const [settings, setSettings] = useState(() => readAudioSettings(localStorageOrNull()));
  const [status, setStatus] = useState('locked');
  const engine = useRef(null), cursor = useRef(null), settingsRef = useRef(settings), overlays = useRef(null);
  settingsRef.current = settings;

  useEffect(() => {
    // Create during setup, rather than in a ref initializer: StrictMode's second
    // setup must receive a fresh engine after the first cleanup disposed it.
    const audio = createAudioEngine({ onState: state => setStatus(state.status) });
    engine.current = audio; audio.setSettings(settingsRef.current); audio.setHidden(document.hidden);
    const visibility = () => audio.setHidden(document.hidden);
    const click = event => {
      if (!event.isTrusted || document.hidden || event.button > 0) return;
      const control = event.target?.closest?.('button,a,[role="button"],input[type="checkbox"],select');
      if (!control || control.disabled || control.getAttribute('aria-disabled') === 'true' || control.closest('[data-audio-control]')) return;
      // The context is created/resumed in this trusted gesture. Nothing heard
      // before activation is retained for later playback.
      audio.unlock().then(ready => { if (ready) audio.gesture('click'); }).catch(() => {});
    };
    document.addEventListener('click', click, true);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('click', click, true); document.removeEventListener('visibilitychange', visibility);
      audio.dispose(); if (engine.current === audio) engine.current = null;
    };
  }, []);

  useEffect(() => { engine.current?.setSettings(settings); saveAudioSettings(localStorageOrNull(), settings); }, [settings]);

  useEffect(() => {
    const audio = engine.current;
    if (!audio) return;
    audio.setScope(room?.code && playerId ? `${room.code}:${playerId}` : 'home');
    const now = presentation?.serverTime ?? room?.serverNow ?? Date.now();
    try {
      const planned = advanceAudioFeed(cursor.current, room, playerId, now);
      cursor.current = planned.cursor;
      audio.setPresentation(planned.presentationId);
      if (!connected) { audio.cancel(); return; }
      audio.enqueue(planned.cues, now);
    } catch { audio.cancel(); /* A cosmetic sound failure cannot interrupt the table. */ }
  }, [room, playerId, connected]);

  useEffect(() => {
    const current = { panel, composer, modal, selected, toast };
    const previous = overlays.current; overlays.current = current;
    if (!previous) return;
    if (Object.entries(current).some(([key, value]) => value !== null && value !== undefined && value !== false && value !== previous[key])) engine.current?.gesture('popup');
  }, [panel, composer, modal, selected, toast]);

  const activate = useCallback(async () => {
    try { return await engine.current?.unlock() || false; } catch { return false; }
  }, []);
  const changeSettings = useCallback(value => {
    // Update immediately so a mute click cannot allow a queued cue through
    // while React is rendering the preference change.
    const next = { ...settingsRef.current, ...value }; settingsRef.current = next;
    engine.current?.setSettings(next); saveAudioSettings(localStorageOrNull(), next); setSettings(next);
  }, []);
  const playEmote = useCallback((event, now) => {
    try { engine.current?.enqueue([emoteSoundCue(event)], now); } catch {}
  }, []);
  return { status, ...settings, activate, changeSettings, playEmote };
}

export default function SoundControls({ audio }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null), trigger = useRef(null);
  const muted = audio.muted || audio.volume === 0;
  const needsActivation = audio.status !== 'ready' && !muted;
  const label = muted ? 'Sound muted' : audio.status === 'unavailable' ? 'Sound unavailable' : needsActivation ? 'Enable sound' : 'Sound settings';
  useEffect(() => {
    if (!open) return;
    const outside = event => { if (!ref.current?.contains(event.target)) setOpen(false); };
    const keyboard = event => { if (event.key === 'Escape' && !document.querySelector('.modal-backdrop')) { event.stopPropagation(); setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keyboard); };
  }, [open]);
  return <div className="game-audio-controls" data-audio-control ref={ref}>
    <button ref={trigger} type="button" className={`icon-button sound-button ${needsActivation ? 'needs-activation' : ''}`} aria-label={label} title={label} aria-expanded={open} aria-controls="game-sound-settings" onClick={() => { audio.activate(); setOpen(value => !value); }}>
      {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}<span>{needsActivation ? 'Enable sound' : 'Sound'}</span>{needsActivation && <i aria-hidden="true" />}
    </button>
    {open && <section id="game-sound-settings" className="sound-settings" role="dialog" aria-label="Sound settings">
      <header><strong>Game sounds</strong><button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="Close sound settings"><X size={17} /></button></header>
      <p role="status">{audio.status === 'unavailable' ? 'Sound is unavailable in this browser. The table works normally.' : muted ? 'Muted on this device.' : audio.status === 'ready' ? 'Sound is on for this device.' : 'Select Enable sound or any game button to activate audio.'}</p>
      <label className="sound-mute"><input type="checkbox" checked={!audio.muted} onChange={event => { audio.changeSettings({ muted: !event.target.checked }); if (event.target.checked) audio.activate(); }} />Sound effects</label>
      <label className="sound-volume">Volume <output>{Math.round(audio.volume * 100)}%</output><input aria-label="Sound volume" type="range" min="0" max="100" step="5" value={Math.round(audio.volume * 100)} onChange={event => audio.changeSettings({ volume: Number(event.target.value) / 100 })} /></label>
      {audio.status !== 'ready' && !audio.muted && <button type="button" className="btn sound-activate" onClick={() => audio.activate()}>Enable sound</button>}
      <small>Saved in this browser.</small>
    </section>}
  </div>;
}
