import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePackedGround } from '../src/formats/ground';
import type { RpkEntry } from '../src/formats/rpk';
import type { ScxModel } from '../src/formats/scx';
import { MapTerrain } from '../src/engine/map-terrain';

const u32=(...values:number[])=>{const b=Buffer.alloc(values.length*4);values.forEach((n,i)=>b.writeUInt32LE(n,i*4));return b;};
const chunk=(tag:string,data:Buffer)=>Buffer.concat([Buffer.from(tag,'latin1'),u32(data.length),data]);
function fixture(){
  const vertices=Buffer.alloc(3*56);
  [[0,2,0],[0,2,1],[1,2,0]].forEach((p,i)=>{
    p.forEach((n,j)=>vertices.writeFloatLE(n,i*56+j*4));vertices.writeFloatLE(1,i*56+16);
    vertices.writeUInt32LE(0xff123456,i*56+24);vertices.writeFloatLE(.25,i*56+32);
    vertices.writeFloatLE(.5,i*56+40);vertices.writeFloatLE(.75,i*56+48);
  });
  const poly=Buffer.concat([u32(0,0),chunk('POLY',Buffer.concat([u32(0,1,0,3,1),vertices,u32(0,1,2)]))]);
  const placed=Buffer.concat([u32(0,0),chunk('RSD\0',Buffer.from('gametype 0x00010002\r\nparams 1,2,3,0,0,0\r\n'))]);
  const physics=Buffer.alloc(4+28+4+36);physics.writeUInt32LE(1);physics.writeUInt32LE(1,12);physics.writeUInt32LE(2,16);physics.writeUInt32LE(3,32);
  [0,2,0,0,2,1,1,2,0].forEach((n,i)=>physics.writeFloatLE(n,36+i*4));
  const rootSize=8+2*23+8+physics.length;
  const record=(offset:number,size:number,flags:number)=>{const b=Buffer.alloc(23);b[8]=1;b[9]=flags;b.writeUInt32LE(offset,14);b.writeUInt32LE(size,18);return b;};
  const root=Buffer.concat([u32(0,2),record(rootSize,poly.length,0),record(rootSize+poly.length,placed.length,0x20),chunk('PHYS',physics)]);
  const file=Buffer.concat([root,poly,placed]);
  const entry:RpkEntry={typeId:1,superId:0,type:1,flags:0,compatibility:0,offset:0,size:root.length,alias:'test',data:root};
  const materials:ScxModel={version:3,warnings:[],meshes:[{name:'road',positions:new Float32Array(),normals:new Float32Array(),uv:new Float32Array(),indices:new Uint32Array(),diffuse:[.5,.6,.7,1],textureIndex:7,textureChannel:1}]};
  return {file,entry,materials,rootSize};
}

test('compiled ground reads nested polygons, collision, materials and placements using RPK offsets',()=>{
  const {file,entry,materials}=fixture(),result=parsePackedGround(file,entry,materials),mesh=result.model.meshes[0];
  assert.equal(result.model.meshes.length,1);assert.equal(result.collision.meshes.length,1);
  assert.deepEqual(Array.from(mesh.positions),[0,200,0,0,200,100,100,200,0]);
  assert.deepEqual(Array.from(mesh.colors!.slice(0,3)),[0x12,0x34,0x56]);
  assert.equal(mesh.textureIndex,7);assert.equal(mesh.textureChannel,1);
  assert.equal(mesh.uv[0],.25);assert.equal(mesh.uv2![0],.5);assert.equal(mesh.uv3![0],.75);
  assert.deepEqual(result.placements[0].pose.position,[1,2,3]);assert.equal(result.placements[0].typeId,0x10002);
  const terrain=new MapTerrain();terrain.add(result.model);
  assert.equal(terrain.height(.2,.2),2,'decoded metres survive the SCX centimetre pipeline');
});

test('compiled ground rejects invalid offsets and polygon indices',()=>{
  const {file,entry,materials,rootSize}=fixture();
  assert.throws(()=>parsePackedGround(file.subarray(0,file.length-1),entry,materials),/out of bounds/);
  const invalid=Buffer.from(file);invalid.writeUInt32LE(99,rootSize+8+8+20+3*56);
  assert.throws(()=>parsePackedGround(invalid,entry,materials),/index outside/);
  const cycle=Buffer.from(file);cycle.writeUInt32LE(0,8+14);
  assert.throws(()=>parsePackedGround(cycle,entry,materials),/repeated offsets/);
});
