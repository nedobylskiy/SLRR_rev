import {type BufferGeometry} from 'three';
import {mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';
import {SimplifyModifier} from 'three/addons/modifiers/SimplifyModifier.js';

/** Experimental reduction: always derive from the original, preserving material sections. */
export function simplifyPlaygroundGeometry(source:BufferGeometry,ratio:number):BufferGeometry{
  if(!Number.isFinite(ratio))throw Error('Invalid detail ratio');
  if(source.groups.length||Object.keys(source.morphAttributes).length||Object.keys(source.attributes).some(name=>!['position','normal','uv','tangent','color','slrrColor'].includes(name)))return source.clone();
  const prepared=source.clone();
  if(prepared.hasAttribute('slrrColor')){prepared.setAttribute('color',prepared.getAttribute('slrrColor'));prepared.deleteAttribute('slrrColor');}
  const welded=mergeVertices(prepared);prepared.dispose();
  try{
    const count=welded.getAttribute('position').count,remove=Math.min(count-3,Math.floor(count*(1-Math.max(.01,Math.min(1,ratio)))));
    const result=remove>0?new SimplifyModifier().modify(welded,remove):welded.clone();
    if(source.hasAttribute('slrrColor')&&result.hasAttribute('color')){result.setAttribute('slrrColor',result.getAttribute('color'));result.deleteAttribute('color');}
    result.computeBoundingBox();result.computeBoundingSphere();return result;
  }finally{welded.dispose();}
}
