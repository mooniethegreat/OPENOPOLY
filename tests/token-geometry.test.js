import test from 'node:test';
import assert from 'node:assert/strict';
import { TOKEN_MESHES, normalizeTokenId, projectTokenMesh, tokenMeshCacheSize } from '../src/token-geometry.js';

test('all existing token identities have distinct original finite 3D meshes with bounded faces',()=>{
  assert.deepEqual(Object.keys(TOKEN_MESHES),['hat','car','dog','ship','cat','penguin','thimble','duck']);
  const identities=new Set();
  for(const [id,mesh] of Object.entries(TOKEN_MESHES)){
    assert(mesh.length>50&&mesh.length<=256,id);identities.add(JSON.stringify(mesh));
    for(const face of mesh){assert(face.points.length>=3);assert(face.points.flat().every(Number.isFinite));assert(Math.abs(Math.hypot(...face.normal)-1)<1e-8);}
  }
  assert.equal(identities.size,8);assert.equal(normalizeTokenId('battleship'),'ship');assert.equal(normalizeTokenId({id:'raceCar'}),'car');
});

test('portraits, board turns and winner gold project the same model without invalid geometry',()=>{
  for(const id of Object.keys(TOKEN_MESHES))for(const tilt of [0,30,34,58])for(const yaw of [0,90,180,270,358]){
    const view=projectTokenMesh(id,{tilt,yaw});assert.equal(view.id,id);assert(view.faces.length>8&&view.faces.length<=256);
    for(const face of view.faces){assert(!/NaN|Infinity/.test(face.points));for(const pair of face.points.split(' '))for(const value of pair.split(',').map(Number))assert(value>=5.99&&value<=94.01);}
    const gold=projectTokenMesh(id,{tilt,yaw,material:'gold'});assert.deepEqual(gold.faces.map(face=>face.points),view.faces.map(face=>face.points));assert.notDeepEqual(gold.faces.map(face=>face.fill),view.faces.map(face=>face.fill));
  }
  assert.equal(projectTokenMesh('unknown').id,'hat');assert(tokenMeshCacheSize()<=96);
});
