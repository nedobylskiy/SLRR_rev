import type {PaintStroke} from './paint-stroke';
import {normalizeResourcePackPath,normalizePath} from '../assets';
import type {SavedTextureIdentity} from '../runtime/texture-reference';

export interface PaintJob {version:1;baseTexture?:SavedTextureIdentity;color?:number;strokes:readonly PaintStroke[]}
const PREFIX='SLRR_PAINT_1\n';
export function encodePaintJob(job:PaintJob){return new TextEncoder().encode(PREFIX+JSON.stringify({...job,strokes:job.strokes.filter(stroke=>!stroke.temporary)}));}
export function decodePaintJob(bytes:Uint8Array):PaintJob {
  if(bytes.length>16*1024*1024)throw Error('Saved paint job is too large');
  const text=new TextDecoder().decode(bytes);if(!text.startsWith(PREFIX))throw Error('Unsupported embedded paint texture');
  const job=JSON.parse(text.slice(PREFIX.length));
  const resource=(value:any):SavedTextureIdentity=>{
    if(!value||typeof value.pack!=='string'||!Number.isInteger(value.id)||value.id<0||value.id>0xffff)throw Error('Invalid paint texture resource');
    if(value.source!==undefined&&(typeof value.source!=='string'||!value.source))throw Error('Invalid paint texture source');
    return {pack:normalizeResourcePackPath(value.pack),id:value.id,...(value.source?{source:normalizePath(value.source)}:{})};
  };
  const vector=(value:any):[number,number,number]=>{
    if(!Array.isArray(value)||value.length!==3||!value.every(n=>typeof n==='number'&&Number.isFinite(n)))throw Error('Invalid paint projection vector');
    return [...value] as [number,number,number];
  };
  const color=(value:any)=>{if(!Number.isInteger(value)||value<0||value>0xffffffff)throw Error('Invalid paint color');return value as number;};
  if(job.version!==1||!Array.isArray(job.strokes))throw Error('Invalid saved paint job');
  return {version:1,baseTexture:job.baseTexture===undefined?undefined:resource(job.baseTexture),color:job.color===undefined?undefined:color(job.color),
    strokes:job.strokes.map((stroke:any)=>{
      if(!stroke||!Number.isFinite(stroke.size)||stroke.size<=0||!Number.isFinite(stroke.rotation)||typeof stroke.flip!=='boolean'||stroke.temporary!==false)throw Error('Invalid paint stroke');
      return {position:vector(stroke.position),normal:vector(stroke.normal),tangent:stroke.tangent===undefined?undefined:vector(stroke.tangent),brush:resource(stroke.brush),
        color:color(stroke.color),size:stroke.size,rotation:stroke.rotation,flip:stroke.flip,temporary:false};
    })};
}
