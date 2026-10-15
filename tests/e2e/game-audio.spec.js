import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { createApp } from '../../server/app.js';
import { createGame } from '../../shared/engine.js';
import { decisionContext } from '../../src/action-gate.js';

test.use({ actionTimeout: 10000 });

// Counters exist only in this bundled test fixture, never in product modules.
const audioProbe = { name: 'audio-test-probe', setup(builder) {
  builder.onLoad({ filter: /game-audio-engine\.js$/ }, async args => ({ loader: 'js', contents: (await readFile(args.path, 'utf8')).replace('try { onPlay({ ...cue }); }', 'try { (globalThis.__soundPlayed ||= []).push({ ...cue }); onPlay({ ...cue }); }') }));
} };
async function bundle(options = {}) {
  const result = await build({ bundle: true, write: false, outdir: '.runtime/sound-browser-bundle', format: 'iife', external: ['/assets/*'], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent', plugins: [audioProbe], ...options });
  return { js: result.outputFiles.find(file => file.path.endsWith('.js')).text, css: result.outputFiles.find(file => file.path.endsWith('.css'))?.text || '' };
}
const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><script defer src="/fixture.js"></script></head><body><div id="root"></div></body></html>';
function serveBundle(server, compiled) {
  server.app.get('/', (_, response) => response.type('html').send(html));
  server.app.get('/fixture.js', (_, response) => response.type('js').send(compiled.js));
  server.app.get('/fixture.css', (_, response) => response.type('css').send(compiled.css));
  server.app.use(express.static('public'));
}
async function instrument(page) {
  await page.addInitScript(() => {
    const NativeAudio = window.AudioContext;
    window.__soundPlayed = []; window.__audioContexts = [];
    window.AudioContext = class extends NativeAudio { constructor(...args) { super(...args); window.__audioContexts.push(this); } };
  });
}

test('all synthesized effects have bounded audible energy and distinct signatures', async ({ page }) => {
  const compiled = await bundle({ stdin: { resolveDir: process.cwd(), contents: "import { synthesizeSound, SOUND_KINDS } from './src/game-audio-engine.js'; window.audioRecipes={synthesizeSound,SOUND_KINDS};" } });
  await page.route('http://sound.test/**', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('http://sound.test/'); await page.addScriptTag({ content: compiled.js });
  const measurements = await page.evaluate(async () => {
    const results = [];
    for (const kind of window.audioRecipes.SOUND_KINDS) {
      const context = new OfflineAudioContext(1, 44100, 44100);
      window.audioRecipes.synthesizeSound(context, context.destination, kind);
      const buffer = await context.startRendering(), data = buffer.getChannelData(0);
      let peak = 0, squares = 0, signature = 0;
      for (let i = 0; i < data.length; i += 1) { peak = Math.max(peak, Math.abs(data[i])); squares += data[i] ** 2; signature += Math.abs(data[i]) * (i % 137 + 1); }
      results.push({ kind, peak, rms: Math.sqrt(squares / data.length), signature: Math.round(signature) });
    }
    return results;
  });
  for (const sound of measurements) { expect(sound.peak, sound.kind).toBeGreaterThan(0.01); expect(sound.peak, sound.kind).toBeLessThan(0.5); expect(sound.rms, sound.kind).toBeGreaterThan(0.001); expect(sound.rms, sound.kind).toBeLessThan(0.1); }
  const core = ['dice', 'step', 'card', 'money-in', 'money-out', 'build', 'jail'];
  expect(new Set(measurements.filter(item => core.includes(item.kind)).map(item => item.signature)).size).toBe(core.length);
});

test('trusted gestures unlock real audio in StrictMode; mute, hide, remount and room switches never replay queues', async ({ page }) => {
  const compiled = await bundle({ define: { 'process.env.NODE_ENV': '"development"' }, stdin: { loader: 'jsx', resolveDir: process.cwd(), contents: `
    import React, { useEffect, useState } from 'react'; import { createRoot } from 'react-dom/client';
    import SoundControls, { useGameAudio } from './src/GameAudio.jsx'; import './src/styles.css';
    const initial = { code:'AUDIO1',version:1,serverNow:Date.now(),players:[{id:'a',name:'Alex'},{id:'b',name:'Blair'}],game:{edition:'classic',players:[{id:'a',name:'Alex'},{id:'b',name:'Blair'}],rules:{},log:[]},chat:[],contracts:[],votes:[] };
    function Sounds({room}) { const audio=useGameAudio({room,playerId:'a',connected:true,presentation:{serverTime:room.serverNow}}); return <SoundControls audio={audio}/>; }
    function Fixture(){ const [room,setRoom]=useState(initial),[key,setKey]=useState(0); useEffect(()=>{ window.feedSoundRoom=setRoom; window.currentSoundRoom=room; },[room]); return <div className="app"><header className="app-header" style={{justifyContent:'flex-end'}}><nav className="header-nav"><Sounds key={key} room={room}/></nav></header><button onClick={()=>setKey(value=>value+1)}>Remount sound view</button></div>; }
    createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);
  ` } });
  const server = createApp({ storePath: '', distPath: '' }); serveBundle(server, compiled); const address = await server.listen(0, '127.0.0.1');
  try {
    await instrument(page); await page.goto(`http://127.0.0.1:${address.port}`);
    await expect(page.getByRole('button', { name: 'Enable sound', exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__audioContexts.length)).toBe(0);
    await page.getByRole('button', { name: 'Enable sound', exact: true }).click();
    await expect(page.getByText('Sound is on for this device.')).toBeVisible();
    expect(await page.evaluate(() => window.__audioContexts.at(-1).state)).toBe('running');
    const feed = async (id, code) => page.evaluate(({ id, code }) => { const room=window.currentSoundRoom; window.feedSoundRoom({...room,code:code||room.code,version:room.version+1,serverNow:Date.now(),chat:[...room.chat,{id,text:'Message'}]}); }, { id, code });
    await feed('m1'); await expect.poll(() => page.evaluate(() => window.__soundPlayed.filter(item => item.kind === 'chat').length)).toBe(1);
    await page.evaluate(() => window.feedSoundRoom({...window.currentSoundRoom})); await page.waitForTimeout(180);
    expect(await page.evaluate(() => window.__soundPlayed.filter(item => item.kind === 'chat').length)).toBe(1);
    await page.getByRole('checkbox', { name: 'Sound effects' }).uncheck(); await feed('m2');
    await page.getByRole('checkbox', { name: 'Sound effects' }).check(); await page.waitForTimeout(180);
    expect(await page.evaluate(() => window.__soundPlayed.filter(item => item.kind === 'chat').length)).toBe(1);
    await page.getByRole('slider', { name: 'Sound volume' }).fill('25');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('monopoly-sound-v1')).volume)).toBe(0.25);
    await page.evaluate(() => { Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}); document.dispatchEvent(new Event('visibilitychange')); });
    await feed('m3'); await page.evaluate(() => { Object.defineProperty(document,'hidden',{configurable:true,get:()=>false}); document.dispatchEvent(new Event('visibilitychange')); });
    await page.getByRole('button', { name: 'Enable sound', exact: true }).first().click(); await page.waitForTimeout(180);
    expect(await page.evaluate(() => window.__soundPlayed.filter(item => item.kind === 'chat').length)).toBe(1);
    await feed('m4'); await expect.poll(() => page.evaluate(() => window.__soundPlayed.filter(item => item.kind === 'chat').length)).toBe(2);
    await page.getByRole('button', { name: 'Remount sound view' }).click();
    await expect(page.getByRole('button', { name: 'Enable sound', exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__audioContexts[0].state)).toBe('closed');
    await page.getByRole('button', { name: 'Enable sound', exact: true }).click(); await feed('m5','AUDIO2'); await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__soundPlayed.filter(item => item.kind === 'chat').length)).toBe(2);
    expect(await page.evaluate(() => window.__audioContexts.length)).toBe(2);
    await page.reload(); await expect(page.getByRole('button', { name: 'Enable sound', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Enable sound', exact: true }).click(); await expect(page.getByRole('slider', { name: 'Sound volume' })).toHaveValue('25');
  } finally { await server.close(); }
});

test('real App sounds confirmed payments exactly once without issuing commands; controls fit a 320px table', async ({ browser }) => {
  const compiled = await bundle({ entryPoints: ['src/main.jsx'] });
  const server = createApp({ storePath: '', distPath: '' }); serveBundle(server, compiled); const address = await server.listen(0, '127.0.0.1'); const origin = `http://127.0.0.1:${address.port}`;
  let context, socket; const commands = [];
  try {
    const post = async (path, body) => (await fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    const owner = await post('/api/rooms', { name: 'Audio Alex', theme: 'classic' }); const other = await post(`/api/rooms/${owner.room.code}/join`, { name: 'Audio Blair' });
    server.store.transaction(data => { const room=data.rooms[owner.room.code]; room.status='playing'; room.game=createGame(room.players,{seed:42,firstPlayerId:owner.playerId}); room.version++; room.decisionVersion++; });
    server.io.on('connection', client => client.on('action', command => commands.push(command.type)));
    context = await browser.newContext({ viewport: { width: 320, height: 740 } });
    const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message)); await instrument(page);
    await context.addInitScript(seat => { localStorage.setItem('monopoly-table-sessions-v2', JSON.stringify({ [seat.roomCode]: seat })); localStorage.setItem('monopoly-table-active-v2',seat.roomCode); }, { roomCode:owner.room.code,playerId:owner.playerId,sessionToken:owner.sessionToken,name:'Audio Alex',theme:'classic' });
    await page.goto(`${origin}/?room=${owner.room.code}`); await expect(page.locator('.connection')).toHaveText('CONNECTED');
    await expect(page.getByRole('button', { name: 'Enable sound', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Enable sound', exact: true }).click(); await expect(page.getByText('Sound is on for this device.')).toBeVisible();
    const bounds = await page.locator('.sound-settings').boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x+bounds.width).toBeLessThanOrEqual(320);
    await page.screenshot({ path: '.runtime/inspection/sound-controls-mobile-320.png' });
    // Keyboard activation has no outside pointerdown to dismiss the underlying
    // audio popover. Escape must still dismiss the visible topmost modal first.
    await page.getByRole('button', { name: 'Appearance', exact: true }).focus();
    await page.getByRole('button', { name: 'Appearance', exact: true }).press('Enter');
    await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Sound settings', exact: true })).toBeVisible();
    await page.keyboard.press('Escape'); await expect(page.locator('.sound-settings')).toHaveCount(0);
    // The drawer remains open underneath its composer until its own Escape.
    await page.getByRole('button', { name: 'Open game tools', exact: true }).click();
    await page.getByTestId('game-drawer').getByRole('button', { name: /^Contracts/ }).click();
    await page.getByTestId('game-drawer').getByRole('button', { name: 'New contract', exact: true }).click();
    await expect(page.locator('.contract-composer')).toBeVisible();
    await page.keyboard.press('Escape'); await expect(page.locator('.contract-composer')).toHaveCount(0);
    await expect(page.getByTestId('game-drawer')).toBeVisible();
    await page.keyboard.press('Escape'); await expect(page.getByTestId('game-drawer')).toHaveCount(0);
    socket=io(origin,{auth:{roomCode:owner.room.code,sessionToken:other.sessionToken},transports:['websocket'],reconnection:false,forceNew:true}); await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
    const current = (await (await fetch(`${origin}/api/rooms/${owner.room.code}`,{headers:{Authorization:`Bearer ${other.sessionToken}`}})).json()).room;
    const command={type:'money:send',toPlayerId:owner.playerId,amount:17,note:'Sound QA',commandId:randomUUID(),...decisionContext(current)};
    expect((await socket.timeout(5000).emitWithAck('action',command)).ok).toBe(true);
    await expect.poll(()=>page.evaluate(()=>window.__soundPlayed.filter(item=>item.kind==='money-in').length)).toBe(1);
    expect((await socket.timeout(5000).emitWithAck('action',command)).duplicate).toBe(true);
    server.io.to(owner.room.code).emit('room:state',(await (await fetch(`${origin}/api/rooms/${owner.room.code}`,{headers:{Authorization:`Bearer ${other.sessionToken}`}})).json()).room);
    await page.waitForTimeout(220); expect(await page.evaluate(()=>window.__soundPlayed.filter(item=>item.kind==='money-in').length)).toBe(1);
    expect(commands).toEqual(['money:send','money:send']); // Both came from the explicit QA peer, none from audio UI.
    await page.reload(); await expect(page.locator('.connection')).toHaveText('CONNECTED'); await page.getByRole('button',{name:'Enable sound',exact:true}).click(); await page.waitForTimeout(200);
    expect(await page.evaluate(()=>window.__soundPlayed.filter(item=>item.kind.startsWith('money')).length)).toBe(0);
    expect(server.store.data.rooms[owner.room.code].game.players.find(player=>player.id===owner.playerId).cash).toBe(1517);
    await page.getByRole('button',{name:'Close sound settings'}).click();
    await page.getByRole('button',{name:/Roll dice$/}).click();
    await expect.poll(()=>page.evaluate(()=>window.__soundPlayed.filter(item=>item.kind==='dice').length)).toBeGreaterThan(1);
    const timeline=server.store.data.rooms[owner.room.code].presentation;
    const expectedSteps=timeline.moves.filter(move=>!move.direct).reduce((total,move)=>total+move.path.length,0);
    await expect.poll(()=>page.evaluate(()=>window.__soundPlayed.filter(item=>item.kind==='step').length),{timeout:12000}).toBe(expectedSteps);
    expect(await page.evaluate(()=>window.__soundPlayed.filter(item=>item.kind==='clack').length)).toBeGreaterThanOrEqual(1);
    expect(commands).toEqual(['money:send','money:send','roll']); expect(errors).toEqual([]);
  } finally { socket?.disconnect(); await context?.close(); await server.close(); }
});
