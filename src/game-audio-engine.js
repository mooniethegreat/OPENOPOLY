export const AUDIO_SETTINGS_KEY = 'monopoly-sound-v1';
export const DEFAULT_AUDIO_SETTINGS = Object.freeze({ muted: false, volume: 0.45 });
export const SOUND_KINDS = Object.freeze(['click', 'popup', 'dice', 'clack', 'step', 'card', 'money-in', 'money-out', 'money', 'purchase', 'build', 'proposal', 'signature', 'start', 'turn', 'chat', 'vote', 'bid', 'jail', 'release', 'bankruptcy', 'win', 'reaction', 'splat']);
const clamp = value => Math.min(1, Math.max(0, Number.isFinite(value) ? value : DEFAULT_AUDIO_SETTINGS.volume));

export function readAudioSettings(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(AUDIO_SETTINGS_KEY) || 'null');
    return { muted: saved?.muted === true, volume: clamp(saved?.volume) };
  } catch { return { ...DEFAULT_AUDIO_SETTINGS }; }
}

export function saveAudioSettings(storage, settings) {
  try { storage?.setItem(AUDIO_SETTINGS_KEY, JSON.stringify({ muted: settings.muted === true, volume: clamp(settings.volume) })); } catch { /* Sound preferences never block the table. */ }
}

const noiseBuffers = new WeakMap();
function noiseBuffer(context) {
  if (!noiseBuffers.has(context)) {
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.25), context.sampleRate);
    const samples = buffer.getChannelData(0); let seed = 8917;
    for (let i = 0; i < samples.length; i += 1) { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; samples[i] = (seed >>> 0) / 2147483648 - 1; }
    noiseBuffers.set(context, buffer);
  }
  return noiseBuffers.get(context);
}

/** Original short synthesized effects; no network, assets, or game commands. */
export function synthesizeSound(context, destination, kind, { variant = 0 } = {}) {
  const nodes = [], sources = [];
  let duration = 0;
  const disconnect = () => { for (const node of nodes) { try { node.disconnect(); } catch {} } };
  const stop = () => { for (const source of sources) { try { source.stop(); } catch {} } disconnect(); };
  try {
    if (!SOUND_KINDS.includes(kind)) return { duration: 0, stop };
    const origin = context.currentTime + 0.003;
    const envelope = (delay, length, peak) => {
      const gain = context.createGain(); nodes.push(gain);
      const at = origin + delay;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + Math.min(0.008, length / 4));
      gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
      gain.connect(destination); duration = Math.max(duration, delay + length + 0.015);
      return { gain, at };
    };
    const tone = (frequency, delay = 0, length = 0.09, peak = 0.1, type = 'sine', end = frequency * 0.85) => {
      const oscillator = context.createOscillator(); nodes.push(oscillator); sources.push(oscillator);
      const { gain, at } = envelope(delay, length, peak);
      oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, at);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(25, end), at + length);
      oscillator.connect(gain); oscillator.start(at); oscillator.stop(at + length + 0.005);
    };
    const paper = (delay = 0, length = 0.12, frequency = 1800, peak = 0.15, type = 'bandpass') => {
      const source = context.createBufferSource(), filter = context.createBiquadFilter();
      nodes.push(source, filter); sources.push(source);
      const { gain, at } = envelope(delay, length, peak);
      source.buffer = noiseBuffer(context); filter.type = type; filter.frequency.setValueAtTime(frequency, at); filter.Q.value = 0.7;
      source.connect(filter); filter.connect(gain); source.start(at); source.stop(at + length + 0.005);
    };
    const notes = (frequencies, spacing = 0.07, peak = 0.1, length = 0.15) => frequencies.forEach((frequency, index) => tone(frequency, index * spacing, length, peak, 'sine', frequency));
    if (kind === 'click') tone(1350, 0, 0.026, 0.065, 'triangle', 750);
    else if (kind === 'popup') notes([440, 660], 0.06, 0.065, 0.13);
    else if (kind === 'dice') { paper(0, 0.045, 1250 + variant % 4 * 350, 0.23); tone(290 + variant % 3 * 65, 0.005, 0.04, 0.075, 'triangle', 170); }
    else if (kind === 'clack') { paper(0, 0.035, 2300, 0.27); tone(760, 0.005, 0.065, 0.09, 'triangle', 240); paper(0.035, 0.025, 1750, 0.13); }
    else if (kind === 'step') { tone(230 + variant % 3 * 24, 0, 0.04, 0.09, 'triangle', 110); paper(0, 0.02, 850, 0.08); }
    else if (kind === 'card') { paper(0, 0.15, 2600, 0.22, 'highpass'); paper(0.065, 0.09, 1150, 0.14); }
    else if (kind === 'money-in') notes([1175, 1568, 2093], 0.055, 0.085, 0.16);
    else if (kind === 'money-out') notes([880, 659, 440], 0.055, 0.08, 0.14);
    else if (kind === 'money') notes([1046, 1318], 0.06, 0.07, 0.13);
    else if (kind === 'purchase') { paper(0, 0.06, 900, 0.22); tone(330, 0.015, 0.1, 0.12, 'triangle', 180); tone(659, 0.07, 0.09, 0.05); }
    else if (kind === 'build') for (let i = 0; i < 3; i += 1) { paper(i * 0.065, 0.035, 650 + i * 200, 0.2); tone(190 + i * 45, i * 0.065, 0.065, 0.11, 'triangle', 80); }
    else if (kind === 'proposal') { paper(0, 0.12, 2100, 0.16, 'highpass'); notes([523, 784], 0.08, 0.055, 0.12); }
    else if (kind === 'signature') { paper(0, 0.09, 3100, 0.14, 'highpass'); tone(180, 0.06, 0.08, 0.12, 'triangle', 95); }
    else if (kind === 'turn') notes([523, 659], 0.09, 0.055, 0.18);
    else if (kind === 'start') notes([392, 523, 784], 0.09, 0.055, 0.19);
    else if (kind === 'chat') tone(988, 0, 0.09, 0.055, 'sine', 1318);
    else if (kind === 'vote') notes([659, 880], 0.075, 0.06, 0.1);
    else if (kind === 'bid') { tone(490, 0, 0.04, 0.085, 'triangle', 240); tone(760, 0.045, 0.05, 0.07, 'triangle', 380); }
    else if (kind === 'jail') { notes([196, 147, 98], 0.06, 0.08, 0.12); paper(0, 0.05, 2700, 0.13); }
    else if (kind === 'release') notes([196, 294, 392], 0.07, 0.07, 0.14);
    else if (kind === 'bankruptcy') notes([392, 330, 261, 196], 0.11, 0.065, 0.22);
    else if (kind === 'win') notes([523, 659, 784, 1046, 1318], 0.085, 0.065, 0.24);
    else if (kind === 'reaction') { tone(520, 0, 0.075, 0.065, 'sine', 780); tone(780, 0.045, 0.06, 0.045, 'sine', 1040); }
    else if (kind === 'splat') { tone(260, 0, 0.1, 0.11, 'sine', 65); paper(0.025, 0.085, 450, 0.18, 'lowpass'); }
    return { duration, stop };
  } catch { stop(); return { duration: 0, stop }; }
}

/** One bounded timer and at most eight effect voices. All public methods are safe. */
export function createAudioEngine({ contextFactory, now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout, onState = () => {}, onPlay = () => {} } = {}) {
  let context = null, output = null, disposed = false, hidden = false, scope = null, presentationId = null, timer = null, queue = [], voices = [];
  let settings = { ...DEFAULT_AUDIO_SETTINGS }, status = 'locked';
  const seen = new Set(), recent = [], lastKind = new Map();
  const state = () => ({ status, ...settings, pendingCount: queue.length, activeVoices: voices.length });
  const report = () => { if (disposed) return; try { onState(state()); } catch {} };
  const stopVoices = () => { for (const voice of voices) voice.stop(); voices = []; };
  const cancel = () => { if (timer !== null) clearTimer(timer); timer = null; queue = []; stopVoices(); };
  const audible = () => !disposed && !hidden && !settings.muted && settings.volume > 0 && context?.state === 'running';
  const cleanVoices = stamp => { voices = voices.filter(voice => { if (voice.until > stamp) return true; voice.stop(); return false; }); };
  const schedulePump = () => {
    if (timer !== null) clearTimer(timer); timer = null;
    const next = Math.min(queue[0]?.due ?? Infinity, ...voices.map(voice => voice.until));
    if (Number.isFinite(next)) timer = setTimer(pump, Math.max(1, next - now()));
  };
  const play = cue => {
    if (!audible() || !SOUND_KINDS.includes(cue.kind)) return false;
    const stamp = now(); cleanVoices(stamp);
    while (recent.length && stamp - recent[0] > 1000) recent.shift();
    const throttle = cue.kind === 'step' ? 60 : cue.kind === 'dice' ? 100 : cue.kind === 'click' ? 55 : 140;
    if (recent.length >= 18 || stamp - (lastKind.get(cue.kind) ?? -Infinity) < throttle) return false;
    if (voices.length >= 8) voices.shift().stop();
    const voice = synthesizeSound(context, output, cue.kind, cue);
    if (!voice.duration) return false;
    voices.push({ ...voice, presentationId: cue.presentationId, until: stamp + voice.duration * 1000 }); recent.push(stamp); lastKind.set(cue.kind, stamp);
    try { onPlay({ ...cue }); } catch {}
    schedulePump();
    return true;
  };
  const pump = () => {
    timer = null;
    if (!audible()) { cancel(); return; }
    const stamp = now(); cleanVoices(stamp);
    while (queue.length && queue[0].due <= stamp + 3) {
      const cue = queue.shift();
      if (stamp - cue.due <= (cue.kind === 'step' || cue.kind === 'dice' ? 180 : 450)) play(cue);
    }
    schedulePump();
  };
  const api = {
    getState: state,
    setSettings(value) {
      try {
        settings = { muted: value?.muted === true, volume: clamp(value?.volume) };
        if (output && context) output.gain.setTargetAtTime(settings.muted ? 0 : settings.volume * 0.6, context.currentTime, 0.015);
        if (settings.muted || !settings.volume) cancel(); report();
      } catch { cancel(); }
    },
    async unlock() {
      try {
        if (disposed || hidden) return false;
        if (!context) {
          const factory = contextFactory || (() => { const Audio = globalThis.AudioContext || globalThis.webkitAudioContext; return Audio ? new Audio() : null; });
          context = factory();
          if (!context) { status = 'unavailable'; report(); return false; }
          output = context.createGain(); output.gain.value = settings.muted ? 0 : settings.volume * 0.6;
          const limiter = context.createDynamicsCompressor(); limiter.threshold.value = -12; limiter.knee.value = 9; limiter.ratio.value = 8; limiter.attack.value = 0.003; limiter.release.value = 0.12;
          output.connect(limiter); limiter.connect(context.destination);
          context.onstatechange = () => {
            if (disposed) return;
            if (context.state !== 'running') cancel();
            status = context.state === 'running' ? 'ready' : context.state === 'closed' ? 'unavailable' : 'locked'; report();
          };
        }
        if (context.state === 'closed') { status = 'unavailable'; report(); return false; }
        if (context.state !== 'running') await context.resume();
        if (disposed) return false;
        status = context.state === 'running' ? 'ready' : 'locked'; report(); return status === 'ready';
      } catch { status = 'unavailable'; cancel(); report(); return false; }
    },
    gesture(kind = 'click') { try { if (audible()) return play({ kind }); } catch {} return false; },
    enqueue(cues, serverNow) {
      try {
        const stamp = now();
        for (const cue of cues || []) {
          if (!cue?.id || seen.has(cue.id)) continue;
          seen.add(cue.id); if (seen.size > 512) seen.delete(seen.values().next().value);
          if (!audible() || !Number.isFinite(cue.at) || cue.at < serverNow - 250 || cue.at > serverNow + 12000) continue;
          if (cue.presentationId && cue.presentationId !== presentationId) continue;
          if (queue.some(item => item.kind === cue.kind && Math.abs(item.at - cue.at) < 70)) continue;
          queue.push({ ...cue, due: stamp + Math.max(0, cue.at - serverNow) });
        }
        queue.sort((first, second) => first.due - second.due); queue = queue.slice(0, 80);
        if (timer !== null) clearTimer(timer); timer = null;
        if (queue.length) pump(); else schedulePump();
      } catch { cancel(); }
    },
    setScope(nextScope) { try { if (scope !== nextScope) { scope = nextScope; presentationId = null; cancel(); seen.clear(); lastKind.clear(); recent.length = 0; } } catch {} },
    setPresentation(nextId) {
      try {
        if (presentationId !== nextId) {
          presentationId = nextId;
          queue = queue.filter(cue => !cue.presentationId || cue.presentationId === nextId);
          voices = voices.filter(voice => { if (!voice.presentationId || voice.presentationId === nextId) return true; voice.stop(); return false; });
          if (timer !== null) clearTimer(timer); timer = null;
          if (queue.length) pump(); else schedulePump();
        }
      } catch { cancel(); }
    },
    setHidden(value) { try { hidden = Boolean(value); if (hidden) { cancel(); if (context?.state === 'running') Promise.resolve(context.suspend()).catch(() => {}); } } catch { cancel(); } },
    cancel,
    dispose() {
      if (disposed) return; disposed = true; cancel();
      try { if (context) { context.onstatechange = null; Promise.resolve(context.close()).catch(() => {}); } } catch {}
      context = null; output = null;
    },
  };
  return api;
}
