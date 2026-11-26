/** Structural reader for the original city.walk/city.rest pedestrian AI files.
 * Geometry is decoded; routing/spawn semantics of opaque fields remain unproven. */
export type PedestrianBox=[number,number,number,number,number,number];
export interface PedestrianRecord {kind:21|22|23;quad?:number[];id?:number;points?:number[][];directions?:number[][];child?:PedestrianRecord;links?:number[]}
export interface PedestrianWalk {id:number;box:PedestrianBox;origin:number[];height?:number;slopeX?:number;slopeZ?:number;recordCount?:number;/** Legacy fixture aliases; not a corridor width. */width?:number;tag?:number;records:PedestrianRecord[];links:number[]}
export interface PedestrianRest {area:number;index:number;flag:number;box:PedestrianBox}
const rows=(text:string)=>text.replace(/^\uFEFF/,'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
function header(line:string){
  const match=/^(\S+)\s+(\d+);(.+)$/.exec(line);if(!match)throw Error('Invalid pedestrian line header');
  const box=match[1].split(',').map(Number);if(box.length!==6||box.some(v=>!Number.isFinite(v))||box[0]>box[3]||box[2]>box[5])throw Error('Invalid pedestrian bounds');
  const id=Number(match[2]);if(!Number.isSafeInteger(id)||id<1)throw Error('Invalid pedestrian record ID');
  return {box:box as PedestrianBox,id,payload:match[3]};
}
class Reader {
  at=0;view:DataView;
  constructor(readonly bytes:Uint8Array){this.view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);}
  word(){if(this.at+4>this.bytes.length)throw Error('Truncated pedestrian record');const v=this.view.getUint32(this.at,true);this.at+=4;return v;}
  float(){if(this.at+4>this.bytes.length)throw Error('Truncated pedestrian record');const v=this.view.getFloat32(this.at,true);this.at+=4;if(!Number.isFinite(v))throw Error('Non-finite pedestrian coordinate');return v;}
  floats(n:number){return Array.from({length:n},()=>this.float());}
  finish(){if(this.at!==this.bytes.length)throw Error('Unexplained pedestrian record bytes');}
}
function record(r:Reader):PedestrianRecord {
  const kind=r.word();if(kind!==21&&kind!==22&&kind!==23)throw Error(`Unknown pedestrian record type ${kind}`);
  let points:number[][]|undefined,directions:number[][]|undefined;
  if(kind===23){
    const count=r.word();if(count<1||count>64)throw Error('Invalid pedestrian waypoint count');
    points=[];directions=[];for(let i=0;i<=count;i++){points.push(r.floats(3));directions.push(r.floats(3));}
  }
  const quad=r.floats(4),id=r.word()|0;
  return {kind,quad,id,points,directions};
}
/** Reader layout from 0x00586580; a row contains sequential edges, not child records. */
export function parsePedestrianWalk(text:string):PedestrianWalk[]{
  const result=rows(text).map(line=>{
    const {box,id,payload}=header(line);
    if(payload.length%2||!/^[A-P]+$/.test(payload))throw Error('Invalid pedestrian nibble payload');
    const bytes=Uint8Array.from({length:payload.length/2},(_,i)=>(payload.charCodeAt(i*2)-65)*16+payload.charCodeAt(i*2+1)-65),r=new Reader(bytes);
    if(r.word()!==bytes.length-4)throw Error('Pedestrian payload length mismatch');
    const origin=r.floats(2),slopeX=r.float(),slopeZ=r.float(),height=r.float(),recordCount=r.word();
    if(recordCount>64)throw Error('Invalid pedestrian record count');
    const records=Array.from({length:recordCount},()=>record(r));
    const count=r.word();if(count>64)throw Error('Invalid pedestrian link count');
    const links=Array.from({length:count},()=>r.word());r.finish();
    return {id,box,origin,slopeX,slopeZ,height,recordCount,records,links};
  });
  const ids=new Set(result.map(r=>r.id));if(ids.size!==result.length)throw Error('Duplicate pedestrian walk ID');
  for(const row of result)if(row.links.some(id=>!ids.has(id)))throw Error('Pedestrian link outside walk table');return result;
}
export function pedestrianFloor(row:PedestrianWalk,x:number,z:number){return (row.height??row.width??0)+(row.slopeX??0)*(x-row.origin[0])+(row.slopeZ??0)*(z-row.origin[1]);}

export function parsePedestrianRest(text:string):PedestrianRest[]{
  const keys=new Set<string>();return rows(text).map(line=>{
    const {box,id:area,payload}=header(line),values=payload.split(',').map(Number);
    if(values.length!==2||values[0]!==1||!Number.isSafeInteger(values[1])||values[1]<0)throw Error('Invalid pedestrian rest payload');
    const key=`${area}:${values[1]}`;if(keys.has(key))throw Error('Duplicate pedestrian rest index');keys.add(key);
    return {area,index:values[1],flag:values[0],box};
  });
}
