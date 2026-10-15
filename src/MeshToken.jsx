import React, { memo } from 'react';
import { projectTokenMesh } from './token-geometry.js';

const MeshToken = memo(function MeshToken({ token, size=38, className='', material='silver', finish, tilt=58, yaw=-24, label='Metal token' }) {
  const projection=projectTokenMesh(token,{tilt,yaw,material:finish||material});
  return <span className={`token-mesh ${className}`} style={{width:size,height:size,display:'inline-flex',flexShrink:0}} role="img" aria-label={label} data-token-model={projection.id} data-token-material={finish||material}><svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true" focusable="false" style={{overflow:'visible',filter:'drop-shadow(0 2px 1px #10171570)'}}>{projection.faces.map((face,index)=><polygon key={index} points={face.points} fill={face.fill} stroke={face.fill} strokeWidth=".28" strokeLinejoin="round" />)}</svg></span>;
});
export default MeshToken;
