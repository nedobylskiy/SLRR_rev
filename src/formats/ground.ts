import { BinaryReader } from '../binary';
import type { RpkEntry } from './rpk';
import type { ScxMesh, ScxModel } from './scx';
import type { MapObjectPlacement } from '../engine/map-objects';

export interface PackedGround { model: ScxModel; collision: ScxModel; placements: MapObjectPlacement[] }

/** Compiled GroundRef trees use absolute RPK offsets and POLY/PHYS chunks, not external SCX files. */
export function parsePackedGround(file: Uint8Array, root: RpkEntry, materials: ScxModel): PackedGround {
  const result: PackedGround={model:{version:3,meshes:[],warnings:[]},collision:{version:3,meshes:[],warnings:[]},placements:[]};
  const visited=new Set<number>();
  const emptyMesh=(name:string):ScxMesh=>({name,positions:new Float32Array(),normals:new Float32Array(),uv:new Float32Array(),
    indices:new Uint32Array(),diffuse:[1,1,1,1],textureIndex:0xffff});
  const walk=(offset:number,size:number,depth:number,placement=false)=>{
    if(depth>64)throw Error('Ground tree depth exceeded');
    if(visited.has(offset))throw Error('Ground tree contains repeated offsets');
    visited.add(offset);
    const bounds=new BinaryReader(file,'RPK ground');bounds.require(size,offset);
    const r=new BinaryReader(file.subarray(offset,offset+size),'Ground node');
    const links=r.count(r.u32(),4);r.skip(links*4);
    const count=r.count(r.u32(),23),children:{offset:number;size:number;placement:boolean}[]=[];
    for(let i=0;i<count;i++){
      r.u32();r.u32();const type=r.u8(),flags=r.u8();r.f32();
      const childOffset=r.u32(),childSize=r.u32();r.skip(r.u8());
      if(flags&1)r.skip(48);
      if(type===1)children.push({offset:childOffset,size:childSize,placement:!!(flags&0x20)});
    }
    while(r.remaining>=8){
      const tag=r.text(4),chunkSize=r.u32();
      if(tag==='\0\0\0\0'&&chunkSize===0)break;
      const bytes=r.take(chunkSize),c=new BinaryReader(bytes,`Ground ${tag}`);
      if(tag==='POLY'){
        c.u32();const sections=c.count(c.u32(),12);
        for(let section=0;section<sections;section++){
          const material=c.u32(),nv=c.u32(),nt=c.u32();
          c.require(nv*56+nt*12);
          const mesh={...emptyMesh(`ground_${offset}_${section}`),...materials.meshes[material]};
          mesh.name=`ground_${offset}_${section}`;
          mesh.positions=new Float32Array(nv*3);mesh.normals=new Float32Array(nv*3);
          mesh.colors=new Uint8Array(nv*3);mesh.uv=new Float32Array(nv*2);mesh.uv2=new Float32Array(nv*2);mesh.uv3=new Float32Array(nv*2);
          for(let v=0;v<nv;v++){
            for(let axis=0;axis<3;axis++){const value=c.f32();if(!Number.isFinite(value))throw Error('Non-finite ground position');mesh.positions[v*3+axis]=value*100;}
            for(let axis=0;axis<3;axis++)mesh.normals[v*3+axis]=c.f32();
            const color=c.u32();mesh.colors.set([(color>>>16)&255,(color>>>8)&255,color&255],v*3);c.skip(4);
            for(const uv of [mesh.uv,mesh.uv2,mesh.uv3]){uv[v*2]=c.f32();uv[v*2+1]=c.f32();}
          }
          mesh.indices=Uint32Array.from({length:nt*3},()=>{const index=c.u32();if(index>=nv)throw Error('Ground index outside vertex array');return index;});
          if(nv&&nt)result.model.meshes.push(mesh);
        }
      }else if(tag==='PHYS'){
        const faces=c.count(c.u32(),28),records=c.take(faces*28),nv=c.count(c.u32(),12);
        const mesh=emptyMesh(`collision_${offset}`);mesh.positions=Float32Array.from({length:nv*3},()=>c.f32()*100);
        mesh.normals=new Float32Array(nv*3);mesh.uv=new Float32Array(nv*2);
        const faceView=new DataView(records.buffer,records.byteOffset,records.byteLength);
        mesh.indices=Uint32Array.from({length:faces*3},(_,i)=>{
          const index=faceView.getUint32(Math.floor(i/3)*28+4+(i%3)*4,true);
          if(index>=nv)throw Error('Ground collision index outside vertex array');return index;
        });
        if(faces)result.collision.meshes.push(mesh);
      }else if(tag==='RSD\0'&&placement){
        const text=new TextDecoder('windows-1252').decode(bytes);
        const type=/gametype\s+0x([\da-f]+)/i.exec(text),params=/params\s+([^\r\n\0]+)/i.exec(text);
        const pose=params?.[1].split(',').map(Number);
        if(type&&pose&&pose.length>=6&&pose.every(Number.isFinite))result.placements.push({id:offset,alias:'',typeId:parseInt(type[1],16),
          pose:{position:pose.slice(0,3) as [number,number,number],rotation:pose.slice(3,6) as [number,number,number]},seed:pose[6]});
      }
    }
    for(const child of children)walk(child.offset,child.size,depth+1,child.placement);
  };
  walk(root.offset,root.size,0);
  return result;
}
