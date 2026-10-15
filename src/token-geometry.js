// Original, dependency-free polygon meshes. Units are tabletop token heights;
// one cached model is shared by the live board, portraits, and winner sculpture.
const sub = (a,b) => a.map((value,index)=>value-b[index]);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const normalize = vector => { const length=Math.hypot(...vector)||1; return vector.map(value=>value/length); };
const aliases = { topHat:'hat','top-hat':'hat',racecar:'car',raceCar:'car',battleship:'ship',scottie:'dog',rubberDuck:'duck','rubber-duck':'duck' };
export const normalizeTokenId = value => aliases[typeof value === 'object' ? value.id : value] || (typeof value === 'object' ? value.id : value) || 'hat';

function face(mesh, points, material='silver') {
  const unique=points.filter((point,index)=>index===0||Math.hypot(...sub(point,points[index-1]))>1e-8);
  if(unique.length<3)return;
  let normal=[0,0,0];
  for(let index=1;index<unique.length-1;index++){normal=cross(sub(unique[index],unique[0]),sub(unique[index+1],unique[0]));if(Math.hypot(...normal)>1e-8)break;}
  if(Math.hypot(...normal)<1e-8)return;
  mesh.push({points:unique,normal:normalize(normal),material});
}

function box(mesh,x,y,z,w,d,h,material='silver') {
  const p=[[x-w/2,y-d/2,z],[x+w/2,y-d/2,z],[x+w/2,y+d/2,z],[x-w/2,y+d/2,z],[x-w/2,y-d/2,z+h],[x+w/2,y-d/2,z+h],[x+w/2,y+d/2,z+h],[x-w/2,y+d/2,z+h]];
  for(const indices of [[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7],[4,5,6,7],[3,2,1,0]])face(mesh,indices.map(index=>p[index]),material);
}

function lathe(mesh,profile,{x=0,y=0,z=0,segments=12,material='silver',axis='z'}={}) {
  const convert=([a,b,c])=>axis==='y'?[x+a,y+c,z+b]:[x+a,y+b,z+c];
  const rings=profile.map(([radius,height])=>Array.from({length:segments},(_,index)=>{const angle=index*Math.PI*2/segments;return convert([Math.cos(angle)*radius,Math.sin(angle)*radius,height]);}));
  for(let ring=0;ring<rings.length-1;ring++)for(let index=0;index<segments;index++)face(mesh,[rings[ring][index],rings[ring][(index+1)%segments],rings[ring+1][(index+1)%segments],rings[ring+1][index]],material);
  face(mesh,[...rings[0]].reverse(),material);face(mesh,rings.at(-1),material);
}

function silhouette(mesh,outline,depth=.3,{x=0,y=0,z=0,material='silver',bevel=.025}={}) {
  const center=outline.reduce((sum,point)=>[sum[0]+point[0]/outline.length,sum[1]+point[1]/outline.length],[0,0]);
  const ring=(side,inner)=>outline.map(([px,pz])=>[x+(inner?center[0]+(px-center[0])*.94:px),y+side*(depth/2-(inner?0:bevel)),z+(inner?center[1]+(pz-center[1])*.94:pz)]);
  const front=ring(-1,true),outerFront=ring(-1,false),back=ring(1,true),outerBack=ring(1,false);
  face(mesh,front,material);face(mesh,[...back].reverse(),material);
  for(let index=0;index<outline.length;index++){const next=(index+1)%outline.length;face(mesh,[outerFront[index],outerBack[index],outerBack[next],outerFront[next]],material);face(mesh,[front[index],outerFront[index],outerFront[next],front[next]],material);face(mesh,[outerBack[index],back[index],back[next],outerBack[next]],material);}
}

function ellipsoid(mesh,x,y,z,rx,ry,rz,segments=10,rings=5) {
  const temporary=[],profile=Array.from({length:rings+1},(_,index)=>{const height=-1+index*2/rings;return [Math.sqrt(Math.max(0,1-height*height)),height];});
  lathe(temporary,profile,{segments});
  for(const item of temporary)face(mesh,item.points.map(([px,py,pz])=>[x+px*rx,y+py*ry,z+pz*rz]));
}

function curvedTail(mesh,points,radius=.055,segments=8) {
  const rings=points.map((point,index)=>{const before=points[Math.max(0,index-1)],after=points[Math.min(points.length-1,index+1)],tangent=normalize(sub(after,before)),normal=[tangent[2],0,-tangent[0]];return Array.from({length:segments},(_,part)=>{const angle=part*Math.PI*2/segments;return [point[0]+normal[0]*Math.cos(angle)*radius,point[1]+Math.sin(angle)*radius,point[2]+normal[2]*Math.cos(angle)*radius];});});
  for(let ring=0;ring<rings.length-1;ring++)for(let part=0;part<segments;part++)face(mesh,[rings[ring][part],rings[ring][(part+1)%segments],rings[ring+1][(part+1)%segments],rings[ring+1][part]]);
  face(mesh,[...rings[0]].reverse());face(mesh,rings.at(-1));
}

function model(id) {
  const mesh=[];
  if(id==='hat') {
    lathe(mesh,[[.43,.01],[.46,.05],[.44,.09],[.29,.11],[.265,.72],[.31,.77],[.30,.82]],{segments:24});
    lathe(mesh,[[.284,.17],[.281,.26]],{segments:24,material:'band'});
  } else if(id==='thimble') {
    lathe(mesh,[[.36,.02],[.38,.07],[.35,.12],[.29,.73],[.27,.84],[.18,.91],[0,.93]],{segments:24});
    lathe(mesh,[[.36,.11],[.35,.18]],{segments:24,material:'band'});
    for(let row=0;row<3;row++)for(let index=0;index<8;index++){const angle=(index+row%2*.5)*Math.PI/4,radius=.342-row*.018,z=.29+row*.16;const tangent=[-Math.sin(angle)*.027,Math.cos(angle)*.027,0],center=[Math.cos(angle)*radius,Math.sin(angle)*radius,z];face(mesh,[[center[0]+tangent[0],center[1]+tangent[1],z-.025],[center[0]-tangent[0],center[1]-tangent[1],z-.025],[center[0]-tangent[0],center[1]-tangent[1],z+.025],[center[0]+tangent[0],center[1]+tangent[1],z+.025]].reverse(),'dimple');}
  } else if(id==='car') {
    silhouette(mesh,[[-.78,.17],[.68,.16],[.82,.24],[.73,.34],[.10,.35],[-.02,.37],[-.48,.36],[-.78,.30]],.43);
    box(mesh,-.28,0,.36,.34,.32,.08,'band');box(mesh,-.48,0,.36,.08,.36,.18);box(mesh,-.04,0,.36,.035,.36,.18,'glass');box(mesh,.42,0,.34,.45,.36,.025);box(mesh,.78,0,.22,.025,.31,.10,'band');
    for(const x of [-.50,.50])for(const y of [-.32,.22]){lathe(mesh,[[.15,0],[.165,.025],[.165,.10],[.13,.12]],{x,y,z:.16,axis:'y',segments:10,material:'wheel'});lathe(mesh,[[.085,0],[.085,.014]],{x,y:y+.125,z:.16,axis:'y',segments:8});}
  } else if(id==='ship') {
    silhouette(mesh,[[-.65,.11],[.44,.09],[.70,.36],[-.62,.39]],.37);
    box(mesh,-.13,0,.39,.61,.29,.17);box(mesh,.07,0,.56,.26,.24,.16);box(mesh,.08,-.13,.59,.18,.015,.06,'glass');
    for(const x of [-.33,-.13])lathe(mesh,[[.062,0],[.062,.22],[.075,.25]],{x,y:.02,z:.56,segments:10});
    box(mesh,.33,0,.39,.06,.06,.53);box(mesh,.33,0,.73,.27,.03,.025);box(mesh,.48,0,.40,.22,.05,.045);
  } else if(id==='dog') {
    ellipsoid(mesh,-.08,0,.48,.39,.20,.23,12,5);
    for(const x of [-.32,.18])for(const y of [-.12,.12])box(mesh,x,y,.04,.13,.12,.34);
    box(mesh,.31,0,.56,.30,.29,.27);box(mesh,.53,0,.63,.31,.25,.15);box(mesh,.68,0,.65,.045,.25,.09,'band');
    for(const y of [-.10,.10])silhouette(mesh,[[.20,.82],[.23,1.06],[.37,.82]],.075,{y,bevel:.01});
    silhouette(mesh,[[-.43,.58],[-.59,.89],[-.65,.85],[-.52,.50]],.075,{bevel:.01});
    for(const y of [-.153,.153])box(mesh,.36,y,.74,.045,.015,.045,'glass');
  } else if(id==='cat') {
    ellipsoid(mesh,-.12,0,.37,.30,.22,.34);ellipsoid(mesh,.10,0,.64,.18,.17,.28,8,4);ellipsoid(mesh,.15,0,.94,.25,.21,.22);
    for(const x of [-.04,.29])silhouette(mesh,[[x-.09,1.06],[x,1.27],[x+.085,1.06]],.15,{bevel:.012});
    for(const y of [-.12,.12])box(mesh,.20,y,.025,.17,.13,.25);
    curvedTail(mesh,[[-.28,.03,.10],[-.54,.03,.12],[-.64,.03,.32],[-.61,.03,.58],[-.50,.03,.68],[-.43,.03,.59]],.055,8);
    for(const y of [-.205,.205])box(mesh,.25,y,.96,.045,.015,.045,'glass');box(mesh,.39,0,.88,.045,.10,.045,'band');
  } else if(id==='penguin') {
    lathe(mesh,[[.18,.03],[.29,.11],[.33,.31],[.30,.56],[.23,.67],[.28,.79],[.26,.94],[.14,1.04],[0,1.06]],{segments:16});
    for(const sign of [-1,1])silhouette(mesh,[[sign*.20,.68],[sign*.44,.26],[sign*.36,.23],[sign*.23,.48]],.12);
    box(mesh,-.14,-.08,.025,.20,.34,.055);box(mesh,.14,-.08,.025,.20,.34,.055);
    silhouette(mesh,[[-.11,.83],[.11,.83],[.06,.75],[-.06,.75]],.25,{y:.34,bevel:.012});
    box(mesh,-.095,.29,.88,.045,.02,.045,'glass');box(mesh,.095,.29,.88,.045,.02,.045,'glass');
  } else if(id==='duck') {
    ellipsoid(mesh,0,.10,.30,.37,.46,.27,12,5);ellipsoid(mesh,0,-.22,.55,.15,.16,.22,8,4);ellipsoid(mesh,0,-.28,.76,.235,.22,.22,12,5);
    box(mesh,0,-.52,.72,.34,.28,.07);silhouette(mesh,[[-.13,.29],[.13,.29],[.08,.52],[-.08,.52]],.20,{y:.48});
    box(mesh,-.20,-.36,.83,.035,.035,.04,'glass');box(mesh,.20,-.36,.83,.035,.035,.04,'glass');
    for(const item of mesh){item.points=item.points.map(([x,y,z])=>{const a=-Math.PI/3;return [x*Math.cos(a)-y*Math.sin(a),x*Math.sin(a)+y*Math.cos(a),z];});item.normal=normalize(cross(sub(item.points[1],item.points[0]),sub(item.points[2],item.points[0])));}
  }
  return mesh;
}

export const TOKEN_MESHES = Object.freeze(Object.fromEntries(['hat','car','dog','ship','cat','penguin','thimble','duck'].map(id=>[id,Object.freeze(model(id))])));
const viewCache=new Map();
function rotate([x,y,z],tilt,yaw) {const a=yaw*Math.PI/180,b=tilt*Math.PI/180,rx=x*Math.cos(a)-y*Math.sin(a),ry=x*Math.sin(a)+y*Math.cos(a);return [rx,ry*Math.cos(b)-z*Math.sin(b),ry*Math.sin(b)+z*Math.cos(b)];}

export function projectTokenMesh(token,{tilt=58,yaw=-24,material='silver'}={}) {
  const id=TOKEN_MESHES[normalizeTokenId(token)]?normalizeTokenId(token):'hat';
  const angle=Math.round((((yaw%360)+360)%360)*10)/10,pitch=Math.round(tilt*10)/10,key=`${id}:${pitch}:${angle}:${material}`;
  if(viewCache.has(key))return viewCache.get(key);
  const projected=TOKEN_MESHES[id].map(item=>{const points=item.points.map(point=>rotate(point,pitch,angle)),normal=rotate(item.normal,pitch,angle);return {...item,points,normal,depth:points.reduce((sum,point)=>sum+point[2]/points.length,0)};}).filter(item=>item.normal[2]>-.005).sort((a,b)=>a.depth-b.depth);
  const all=projected.flatMap(item=>item.points),left=Math.min(...all.map(point=>point[0])),right=Math.max(...all.map(point=>point[0])),top=Math.min(...all.map(point=>point[1])),bottom=Math.max(...all.map(point=>point[1]));
  const scale=88/Math.max(right-left,bottom-top),cx=(left+right)/2,cy=(top+bottom)/2;
  const faces=projected.map(item=>{
    const [nx,ny,nz]=item.normal,diffuse=Math.max(0,-nx*.52-ny*.45+nz*.73),reflection=Math.pow(Math.max(0,-nx*.35-ny*.30+nz*.88),16);
    const environment=Math.pow(Math.max(0,Math.cos(nx*3.2+ny*1.1+nz*.4)),10)*65;
    let value=74+diffuse*120+reflection*50+environment;if(item.material==='band'||item.material==='wheel')value*=.5;if(item.material==='glass'||item.material==='dimple')value*=.36;
    const channel=number=>Math.round(Math.min(255,Math.max(0,number)));
    const fill=material==='gold'?`rgb(${channel(value*1.1)},${channel(value*.83)},${channel(value*.40)})`:`rgb(${channel(value*.96)},${channel(value)},${channel(value*1.025)})`;
    return {points:item.points.map(([x,y])=>`${((x-cx)*scale+50).toFixed(2)},${((y-cy)*scale+50).toFixed(2)}`).join(' '),fill};
  });
  const result={id,faces};viewCache.set(key,result);if(viewCache.size>96)viewCache.delete(viewCache.keys().next().value);return result;
}

export function tokenMeshCacheSize(){return viewCache.size;}
