import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { createApp } from '../../server/app.js';
import { createGame, applyAction } from '../../shared/engine.js';

let bundle;
test.beforeAll(async()=>{const result=await build({entryPoints:['src/main.jsx'],bundle:true,write:false,outdir:'.runtime/emote-visual-bundle',format:'iife',external:['/assets/*'],define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});bundle={js:result.outputFiles.find(file=>file.path.endsWith('.js')).text,css:result.outputFiles.find(file=>file.path.endsWith('.css')).text};});

async function fixture(browser,{mobile=false}={}){
  const server=createApp({storePath:'',distPath:''});
  server.app.get('/',(req,res)=>res.type('html').send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/qa.css"><script defer src="/qa.js"></script></head><body><div id="root"></div></body></html>'));
  server.app.get('/qa.js',(req,res)=>res.type('js').send(bundle.js));server.app.get('/qa.css',(req,res)=>res.type('css').send(bundle.css));server.app.use(express.static('public'));
  const address=await server.listen(0,'127.0.0.1'),origin=`http://127.0.0.1:${address.port}`,contexts=[],users=[],errors=[],sent=[],events=[];
  let control;
  try{
    const post=async(path,input)=>{const response=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});expect(response.status).toBe(201);return response.json();};
    const host=await post('/api/rooms',{name:'Alex Morgan',token:'hat',theme:'classic'}),guest=await post(`/api/rooms/${host.room.code}/join`,{name:'Blair',token:'dog'}),observer=await post(`/api/rooms/${host.room.code}/join`,{name:'Casey',token:'duck'});
    server.store.transaction(data=>{const room=data.rooms[host.room.code];room.status='playing';room.game=createGame(room.players,{seed:42,firstPlayerId:host.playerId});applyAction(room.game,host.playerId,{type:'roll'},{dice:[1,2]});room.version++;room.decisionVersion++;});
    for(const [index,user]of[host,guest,observer].entries()){
      const context=await browser.newContext({viewport:mobile&&index===0?{width:390,height:844}:{width:1366,height:768},isMobile:mobile&&index===0,hasTouch:mobile&&index===0});contexts.push(context);
      await context.addInitScript(seat=>{localStorage.setItem('monopoly-table-sessions-v2',JSON.stringify({[seat.roomCode]:seat}));localStorage.setItem('monopoly-table-active-v2',seat.roomCode);},{roomCode:host.room.code,playerId:user.playerId,sessionToken:user.sessionToken});
      const page=await context.newPage();users.push({...user,page});page.on('pageerror',error=>errors.push(error.message));page.on('crash',()=>errors.push('Page crashed'));
      page.on('websocket',socket=>socket.on('framesent',frame=>{const match=String(frame.payload).match(/^42\d*(\[.*\])$/s);if(match)try{const [name,packet]=JSON.parse(match[1]);if(['action','emote:send'].includes(name))sent.push({name,packet});}catch{}}));
      await page.goto(`${origin}/?room=${host.room.code}`);await expect(page.locator('.connection')).toHaveText('CONNECTED');
    }
    control=io(origin,{auth:{roomCode:host.room.code,sessionToken:host.sessionToken},transports:['websocket'],forceNew:true,reconnection:false});control.on('room:emote',event=>{if(!events.some(item=>item.id===event.id))events.push(event);});await new Promise((resolve,reject)=>{control.once('connect',resolve);control.once('connect_error',reject);});
    const read=()=>server.store.data.rooms[host.room.code];
    return{server,users,control,read,sent,events,errors,close:async()=>{control.disconnect();await Promise.all(contexts.map(context=>context.close()));await server.close();}};
  }catch(error){control?.disconnect();await Promise.all(contexts.map(context=>context.close()));await server.close();throw error;}
}
async function openPicker(page){const trigger=page.getByRole('button',{name:'React',exact:true});if(await trigger.isVisible())await trigger.click();else{await page.getByRole('button',{name:'Open game tools',exact:true}).click();await page.getByRole('button',{name:'React',exact:true}).click();}await expect(page.getByTestId('emote-picker')).toBeVisible();}
async function pose(page,progress){await page.locator('.emote-layer').evaluate((root,fraction)=>{for(const animation of root.getAnimations({subtree:true})){animation.pause();animation.currentTime=Number(animation.effect.getTiming().duration)*fraction;}},progress);}
const state=f=>JSON.stringify({game:f.read().game,contracts:f.read().contracts,version:f.read().version,decisionVersion:f.read().decisionVersion});

test('three clients share reactions and a visible property toss resumes after picker close without any game mutation',async({browser},info)=>{
  const f=await fixture(browser);try{
    const [sender,other,observer]=f.users,baseline=state(f);
    await openPicker(sender.page);await expect(sender.page.getByTestId('emote-picker').locator('.emote-options button')).toHaveCount(6);await sender.page.getByRole('button',{name:'Happy',exact:true}).click();
    for(const user of f.users){await expect(user.page.getByTestId('shared-emote')).toHaveCount(1);await expect(user.page.getByTestId('shared-emote')).toContainText('Happy → Everyone');}
    await expect.poll(()=>f.events.length).toBe(1);const happy=f.events[0];
    for(const user of f.users)await expect(user.page.getByTestId('shared-emote')).toHaveAttribute('data-emote-id',happy.id);
    f.server.io.to(f.read().code).emit('room:emote',happy);
    for(const user of f.users)await expect(user.page.getByTestId('shared-emote')).toHaveCount(1);
    for(const user of f.users)await expect(user.page.getByTestId('shared-emote')).toHaveCount(0);
    await openPicker(sender.page);await sender.page.getByRole('button',{name:'Poop toss',exact:true}).click();await sender.page.getByRole('button',{name:'A property…',exact:true}).click();await sender.page.getByRole('textbox',{name:'Search reaction properties'}).fill('Boardwalk');await sender.page.getByRole('button',{name:'Target Boardwalk',exact:true}).click();await expect(sender.page.getByTestId('emote-review')).toContainText('Poop toss');await expect(sender.page.getByTestId('emote-review')).toContainText('Boardwalk');
    expect(f.events).toHaveLength(1);await sender.page.getByRole('button',{name:'Toss',exact:true}).click();await expect(sender.page.getByTestId('emote-picker')).toHaveCount(0);
    for(const user of f.users){const burst=user.page.getByTestId('shared-emote');await expect(burst).toHaveAttribute('data-emote-kind','poop');await expect(burst).toHaveAttribute('data-geometry-pass','1');await expect(burst).toHaveAttribute('data-target-fallback','false');await expect(burst).toContainText('Poop toss → Boardwalk');await pose(user.page,.42);
      const geometry=await burst.evaluate(root=>{const sticker=root.querySelector('.emote-sticker'),frames=sticker.getAnimations()[0].effect.getKeyframes(),impact=frames.find(frame=>Math.abs(frame.offset-.26)<.001),matrix=new DOMMatrix(impact.transform),tile=document.querySelector('[data-space-id="39"]').getBoundingClientRect();return{x:matrix.m41+30,y:matrix.m42+30,tx:tile.x+tile.width/2,ty:tile.y+tile.height/2,rotation:frames.find(frame=>frame.offset===.36).transform};});expect(Math.hypot(geometry.x-geometry.tx,geometry.y-geometry.ty)).toBeLessThan(2);expect(geometry.rotation).toContain('rotate(360deg)');}
    await sender.page.screenshot({path:info.outputPath('emote-property-sender.png')});await observer.page.screenshot({path:info.outputPath('emote-property-observer.png')});
    expect(f.events).toHaveLength(2);const canonical=f.events[1],packet=f.sent.findLast(item=>item.name==='emote:send').packet;
    expect((await f.control.timeout(5000).emitWithAck('emote:send',packet)).duplicate).toBe(true);
    for(const user of f.users)await expect(user.page.getByTestId('shared-emote')).toHaveCount(0);
    expect(state(f)).toBe(baseline);expect(f.sent.filter(item=>item.name==='action')).toEqual([]);
    await sender.page.reload();await expect(sender.page.locator('.connection')).toHaveText('CONNECTED');f.server.io.to(f.read().code).emit('room:emote',canonical);await expect(sender.page.getByTestId('shared-emote')).toHaveCount(0);
    expect(f.errors).toEqual([]);
  }finally{await f.close();}
});

test('offscreen properties use an explicit named badge and all emote handles expire',async({browser},info)=>{
  const f=await fixture(browser);try{
    const page=f.users[0].page,baseline=state(f);await page.getByRole('button',{name:'Zoom in',exact:true}).click();await page.mouse.move(600,370);await page.mouse.down();await page.mouse.move(660,420);await page.mouse.move(100000,100000);await page.mouse.up();await page.waitForTimeout(100);
    const target=await page.locator('.scene-tile').evaluateAll(tiles=>{const candidate=tiles.find(tile=>{const r=tile.getBoundingClientRect();return r.right<0||r.bottom<0||r.left>innerWidth||r.top>innerHeight;});return Number(candidate.dataset.spaceId);});
    const result=await f.control.timeout(5000).emitWithAck('emote:send',{clientId:randomUUID(),kind:'poop',target:{kind:'property',propertyId:target}});expect(result.ok).toBe(true);
    const burst=page.getByTestId('shared-emote');await expect(burst).toHaveAttribute('data-target-fallback','true');await expect(burst.locator('.emote-caption')).toContainText('Poop toss');await pose(page,.45);await page.screenshot({path:info.outputPath('emote-named-offscreen-property.png')});
    for(const user of f.users){await expect(user.page.getByTestId('shared-emote')).toHaveCount(0);expect(await user.page.evaluate(()=>document.querySelector('.emote-layer')?.getAnimations({subtree:true}).length||0)).toBe(0);}
    expect(state(f)).toBe(baseline);expect(f.errors).toEqual([]);
  }finally{await f.close();}
});

test('the six reactions, player review and reduced-motion sticker remain usable at390,320 and landscape',async({browser},info)=>{
  const f=await fixture(browser,{mobile:true});try{
    const page=f.users[0].page;await page.emulateMedia({reducedMotion:'reduce'});
    for(const viewport of [{width:390,height:844},{width:320,height:568},{width:844,height:390}]){
      await page.setViewportSize(viewport);await openPicker(page);await page.getByRole('button',{name:'Middle finger',exact:true}).click();await page.getByRole('button',{name:'Target Blair',exact:true}).click();const send=page.getByRole('button',{name:'Send reaction',exact:true});await send.scrollIntoViewIfNeeded();await expect(send).toBeEnabled();
      const hit=await send.evaluate(node=>{const r=node.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});expect(hit).toBe(true);await page.screenshot({path:info.outputPath(`emote-player-review-${viewport.width}.png`)});await send.click();
      const burst=page.getByTestId('shared-emote');await expect(burst).toHaveAttribute('data-emote-kind','middle-finger');await expect(burst).toContainText('Middle finger → Blair');await pose(page,.35);const first=await burst.locator('.emote-sticker').evaluate(node=>getComputedStyle(node).transform);await pose(page,.70);expect(await burst.locator('.emote-sticker').evaluate(node=>getComputedStyle(node).transform)).toBe(first);
      await page.screenshot({path:info.outputPath(`emote-reduced-${viewport.width}.png`)});for(const user of f.users)await expect(user.page.getByTestId('shared-emote')).toHaveCount(0);
    }
    expect(f.sent.filter(item=>item.name==='action')).toEqual([]);expect(f.errors).toEqual([]);
  }finally{await f.close();}
});
