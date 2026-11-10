/** Structural reader for the original city.walk/city.rest pedestrian AI files.
 * Geometry is decoded; routing/spawn semantics of opaque fields remain unproven. */
export type PedestrianBox=[number,number,number,number,number,number];
export interface PedestrianRecord {kind:21|22|23;quad?:number[];id?:number;points?:number[][];directions?:number[][];child?:PedestrianRecord;links?:number[]}
export interface PedestrianWalk {id:number;box:PedestrianBox;origin:number[];width:number;tag:number;records:PedestrianRecord[];links:number[]}
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
function record(r:Reader,depth=0):PedestrianRecord {
  if(depth>8)throw Error('Pedestrian link nesting too deep');
  const kind=r.word();
  if(kind===21)return {kind,quad:r.floats(4)};
  if(kind===23){
    const count=r.word();if(count<3||count>6)throw Error('Invalid pedestrian waypoint count');
    const points:number[][]=[],directions:number[][]=[];
    for(let i=0;i<=count;i++){points.push(r.floats(3));directions.push(r.floats(3));}
    const quad=r.floats(4),ends=[points[0][0],points[0][2],points[count][0],points[count][2]];
    if(quad.some((v,i)=>Math.abs(v-ends[i])>.01))throw Error('Pedestrian sidewalk endpoints disagree');
    return {kind,points,directions,quad};
  }
  if(kind!==22)throw Error(`Unknown pedestrian record type ${kind}`);
  const quad=r.floats(4),id=r.word(),peek=r.at;r.word();r.at=peek;
  const type=r.view.getUint32(peek,true);
  if(type>=21&&type<=23)return {kind,quad,id,child:record(r,depth+1)};
  const links:number[]=[];while(r.at<r.bytes.length)links.push(r.word());
  if(links.length<4||links.length>6)throw Error('Invalid pedestrian leaf count');return {kind,quad,id,links};
}
export function parsePedestrianWalk(text:string):PedestrianWalk[]{
  const result=rows(text).map(line=>{
    const {box,id,payload}=header(line);
    if(payload.length%2||!/^[A-P]+$/.test(payload))throw Error('Invalid pedestrian nibble payload');
    const bytes=Uint8Array.from({length:payload.length/2},(_,i)=>(payload.charCodeAt(i*2)-65)*16+payload.charCodeAt(i*2+1)-65),r=new Reader(bytes);
    if(r.word()!==bytes.length-4)throw Error('Pedestrian payload length mismatch');
    const sections:Uint8Array[]=[];let start=4;
    for(let at=4;at+4<=bytes.length;at+=4)if(r.view.getUint32(at,true)===0xffffffff){sections.push(bytes.subarray(start,at));start=at+4;}
    if(!sections.length)throw Error('Pedestrian first record has no terminator');
    const first=new Reader(sections.shift()!),origin=first.floats(4),width=first.float(),tag=first.word();
    if(tag!==3&&tag!==4)throw Error('Invalid pedestrian first tag');
    const records=[record(first)];first.finish();
    for(const section of sections){const mid=new Reader(section);records.push(record(mid));mid.finish();}
    const tail=new Reader(bytes.subarray(start)),type=tail.word();tail.at=0;const links:number[]=[];
    if(type>=1&&type<=7&&tail.bytes.length===4+type*4){tail.word();for(let i=0;i<type;i++)links.push(tail.word());}
    else if(type===22)records.push(record(tail));else throw Error('Invalid pedestrian tail');tail.finish();
    const collect=(r:PedestrianRecord)=>{if(r.links)links.push(...r.links);if(r.child)collect(r.child);};records.forEach(collect);
    return {id,box,origin,width,tag,records,links};
  });
  const ids=new Set(result.map(r=>r.id));if(ids.size!==result.length)throw Error('Duplicate pedestrian walk ID');
  for(const row of result)if(row.links.some(id=>!ids.has(id)))throw Error('Pedestrian link outside walk table');return result;
}
export function parsePedestrianRest(text:string):PedestrianRest[]{
  const keys=new Set<string>();return rows(text).map(line=>{
    const {box,id:area,payload}=header(line),values=payload.split(',').map(Number);
    if(values.length!==2||values[0]!==1||!Number.isSafeInteger(values[1])||values[1]<0)throw Error('Invalid pedestrian rest payload');
    const key=`${area}:${values[1]}`;if(keys.has(key))throw Error('Duplicate pedestrian rest index');keys.add(key);
    return {area,index:values[1],flag:values[0],box};
  });
}
