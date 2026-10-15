import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { randomUUID } from 'node:crypto';

test('emote hook waits for the canonical event, bounds live reactions and clears without replay on hide/disconnect/scope change', async ({ page }) => {
  const bundle = await build({ stdin: { loader: 'jsx', resolveDir: process.cwd(), contents: `
    import React,{useEffect,useRef,useState} from 'react';import{createRoot}from'react-dom/client';import{useEmotes}from'./src/use-emotes.js';
    const listeners=new Set(); const socket={connected:true,on(name,fn){if(name==='room:emote')listeners.add(fn);},off(name,fn){listeners.delete(fn);},timeout(){return this;},emit(name,packet,callback){window.emotePackets.push({name,packet});window.ackEmote=callback;}};socket.volatile=socket;
    window.emotePackets=[];window.emoteSounds=[];window.deliverEmote=event=>listeners.forEach(fn=>fn(event));
    function Fixture(){const[room,setRoom]=useState({code:'EMOTE1',version:1,serverNow:Date.now(),players:[{id:'a',name:'Alex'},{id:'b',name:'Blair'}]}),[connected,setConnected]=useState(true),socketRef=useRef(socket);
      const emotes=useEmotes({room,playerId:'a',connected,socketRef,playEmote:event=>window.emoteSounds.push(event.id)});
      useEffect(()=>{window.emoteView={...emotes,room};window.changeEmoteRoom=code=>setRoom(previous=>({...previous,code,serverNow:Date.now()}));window.connectEmote=value=>{socket.connected=value;setConnected(value);};},[emotes,room]);
      return <><button onClick={()=>emotes.sendEmote('happy',{kind:'table'})}>Send happy</button><output data-testid='emote-count'>{emotes.emotes.length}</output><output data-testid='emote-pending'>{String(emotes.emoteStatus.pending)}</output><output data-testid='emote-error'>{emotes.emoteStatus.error}</output></>;
    }createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);
  ` }, bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  await page.route('http://emote.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="root"></div></body></html>' }));
  await page.goto('http://emote.test/'); await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const count=page.getByTestId('emote-count'), pending=page.getByTestId('emote-pending');
  await expect(count).toHaveText('0'); await page.getByRole('button',{name:'Send happy'}).click(); await expect(pending).toHaveText('true'); await expect(count).toHaveText('0');
  expect(await page.evaluate(()=>window.emotePackets.length)).toBe(1);
  await page.evaluate(()=>window.ackEmote(null,{ok:true,id:'canonical-accepted-id'})); await expect(pending).toHaveText('false'); await expect(count).toHaveText('0');
  const event={id:randomUUID(),roomCode:'EMOTE1',senderId:'a',kind:'happy',target:{kind:'table'}};
  const deliver=async event=>page.evaluate(event=>{const startedAt=Math.floor(window.emoteView.emoteServerNow());window.deliverEmote({...event,startedAt:event.startedAt??startedAt,endsAt:event.endsAt??startedAt+3000});},event);
  await deliver(event); await expect(count).toHaveText('1');
  await deliver(event); expect(await page.evaluate(()=>window.emoteSounds.length)).toBe(1);
  await page.getByRole('button',{name:'Send happy'}).click(); expect(await page.evaluate(()=>window.emotePackets.length)).toBe(1); await expect(page.getByTestId('emote-error')).toContainText('moment');
  for(let index=0;index<5;index++)await deliver({...event,id:randomUUID(),kind:'poop',target:{kind:'property',propertyId:index}});
  await expect(count).toHaveText('3');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));}); await expect(count).toHaveText('0');
  const hiddenEvent={...event,id:randomUUID()};
  const soundsBeforeHidden=await page.evaluate(()=>window.emoteSounds.length);
  await deliver(hiddenEvent); await expect(count).toHaveText('0');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});
  await deliver(hiddenEvent); await expect(count).toHaveText('0');
  expect(await page.evaluate(()=>window.emoteSounds.length)).toBe(soundsBeforeHidden);
  await deliver(event); await expect(count).toHaveText('0'); // Already seen before hide.
  await deliver({...event,id:randomUUID()}); await expect(count).toHaveText('1');
  await page.evaluate(()=>window.connectEmote(false)); await expect(count).toHaveText('0');
  await page.getByRole('button',{name:'Send happy'}).click(); expect(await page.evaluate(()=>window.emotePackets.length)).toBe(1);
  await page.evaluate(()=>window.connectEmote(true)); await expect(count).toHaveText('0'); await deliver(event); await expect(count).toHaveText('0');
  const beforeReconnect=await page.evaluate(()=>Math.floor(window.emoteView.emoteServerNow())-200);
  await deliver({...event,id:randomUUID(),startedAt:beforeReconnect,endsAt:beforeReconnect+3000}); await expect(count).toHaveText('0');
  await page.evaluate(()=>window.changeEmoteRoom('EMOTE2')); await deliver({...event,id:randomUUID()}); await expect(count).toHaveText('0');
  await deliver({...event,id:randomUUID(),roomCode:'EMOTE2'}); await expect(count).toHaveText('1'); await expect(count).toHaveText('0',{timeout:4500});
  const old=Date.now()-10000; await deliver({...event,id:randomUUID(),roomCode:'EMOTE2',startedAt:old,endsAt:old+3000}); await expect(count).toHaveText('0');
});
