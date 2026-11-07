import { BufferAttribute, BufferGeometry } from 'three';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';
import {mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';
import {acceptableLodShape,closedLodSurface} from './map-lod-quality';

export interface LodGeometryData {attributes:Record<string,{array:Float32Array;itemSize:number}>;index?:Uint32Array}

/** Unsupported extra UV channels are rejected, never silently discarded by SimplifyModifier. */
export function generateMapLod(data:LodGeometryData):LodGeometryData|undefined {
  const allowed=new Set(['position','normal','uv','tangent','slrrColor']);
  if(Object.keys(data.attributes).some(name=>!allowed.has(name)))return;
  const count=data.attributes.position?.array.length/3;
  if(!count||count<120||count>6000)return;
  if(Object.values(data.attributes).some(a=>a.itemSize<1||a.array.length/a.itemSize!==count||!a.array.every(Number.isFinite)))return;
  const geometry=new BufferGeometry();
  for(const [name,attribute] of Object.entries(data.attributes))geometry.setAttribute(name==='slrrColor'?'color':name,
    new BufferAttribute(attribute.array,attribute.itemSize));
  if(data.index)geometry.setIndex(new BufferAttribute(data.index,1));
  let reduced:BufferGeometry|undefined,welded:BufferGeometry|undefined;
  try {
    if(!closedLodSurface(geometry))return;
    welded=mergeVertices(geometry);
    reduced=new SimplifyModifier().modify(welded,Math.floor(welded.getAttribute('position').count*0.35));
    const before=data.index?.length??count,after=reduced.index?.count??reduced.getAttribute('position').count;
    if(!after||after>=before*0.8)return;
    if(!acceptableLodShape(geometry,reduced))return;
    const attributes:LodGeometryData['attributes']={};
    for(const [name,attribute] of Object.entries(reduced.attributes))attributes[name==='color'?'slrrColor':name]={array:new Float32Array(attribute.array),itemSize:attribute.itemSize};
    return {attributes,index:reduced.index?new Uint32Array(reduced.index.array):undefined};
  } finally {geometry.dispose();welded?.dispose();reduced?.dispose();}
}
