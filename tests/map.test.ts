import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { groundRenderDefinition, groundRenderIsRoom, groundRoomRenderIds, isStockMapCollisionShell, mapRenderIds } from '../src/engine/map';
import type { RpkEntry, RpkPack } from '../src/formats/rpk';
import type {ScxModel} from '../src/formats/scx';

test('City ground parameters retain their pose before SCM/TRC paths and a trailing EXTP chunk', () => {
  const text=Buffer.from('gametype 0x00010035\r\nparams 0x00000010,1,2,3,0,0,0,maps\\city\\meshes\\city.scm,maps\\city\\ai\\city.trc\r\n');
  const header=Buffer.alloc(8);header.write('RSD\0','latin1');header.writeUInt32LE(text.length,4);
  const extra=Buffer.alloc(12);extra.write('EXTP');extra.writeUInt32LE(4,4);extra.writeUInt32LE(3,8);
  const data=Buffer.concat([Buffer.alloc(8),header,text,extra]);
  const root:RpkEntry={typeId:1,superId:0,type:1,flags:0,compatibility:0,offset:0,size:data.length,alias:'City',data};
  assert.deepEqual(groundRenderDefinition(root),{gameType:0x10035,renderId:16,pose:{position:[1,2,3],rotation:[0,0,0]}});
  // Standalone TestTrack-style RSD retains the original one-argument default pose.
  const simple=Buffer.from('gametype 0x00010035\r\nparams 0x00000014\r\n');
  header.writeUInt32LE(simple.length,4);root.data=Buffer.concat([header,simple]);
  assert.deepEqual(groundRenderDefinition(root),{gameType:0x10035,renderId:20,pose:{position:[0,0,0],rotation:[0,0,0]}});
  header.writeUInt32LE(text.length+1000,4);root.data=Buffer.concat([header,text,extra]);
  assert.equal(groundRenderDefinition(root),undefined,'truncated RSD must not read following bytes as parameters');
});

test('identified City collision shell stays distinct from visible untextured map meshes',()=>{
  const model:ScxModel={version:3,warnings:[],meshes:[{name:'_picsasag',positions:new Float32Array(),
    normals:new Float32Array(),uv:new Float32Array(),indices:new Uint32Array(),diffuse:[.58,.58,.58,1],textureIndex:0xffff,layer2Index:0xffff}]};
  assert.ok(isStockMapCollisionShell('maps/city.rpk','maps\\city\\meshes\\c1_phys.SCX','c1_phys',model));
  assert.equal(isStockMapCollisionShell('maps/city.rpk','maps/city/meshes/Wall_10.scx','Wall_10',model),false);
  assert.equal(isStockMapCollisionShell('maps/custom.rpk','maps/city/meshes/c1_phys.scx','c1_phys',model),false);
  model.meshes[0].textureIndex=0;
  assert.equal(isStockMapCollisionShell('maps/city.rpk','maps/city/meshes/c1_phys.scx','c1_phys',model),false);
});

function entry(typeId: number, superId: number, type: number, body = ''): RpkEntry {
  const data = new TextEncoder().encode(body);
  return { typeId, superId, type, flags: 0, compatibility: 0, offset: 0, size: data.length, alias: '', data };
}

test('a dealer floor does not hide the sibling building under its render root',()=>{
  const pack:RpkPack={version:0x200,dependencies:[],warnings:[],entries:[
    entry(0x44,0x10003,14),entry(2,0x44,14,'mesh 0x4'),entry(4,0,5),
    entry(13,0x44,14,'mesh 0xe'),entry(14,0,5),
  ]};
  const model:ScxModel={version:3,warnings:[],meshes:[{name:'floor',positions:new Float32Array(9),
    normals:new Float32Array(9),uv:new Float32Array(6),indices:new Uint32Array([0,1,2]),diffuse:[1,1,1,1],textureIndex:0}]};
  assert.equal(groundRenderIsRoom(pack,2,model),true);
  assert.deepEqual(groundRoomRenderIds(pack,2),[2,13]);
  assert.deepEqual(mapRenderIds(pack),[2,13]);
  pack.entries=pack.entries.filter(entry=>entry.typeId!==13);
  assert.equal(groundRenderIsRoom(pack,2,model),true,'a standalone room still loads only its ground mesh');
  pack.entries.push(entry(0x55,0x10003,14),entry(20,0x55,14,'mesh 0x16'),entry(22,0,5));
  assert.deepEqual(groundRoomRenderIds(pack,2),[2],'other garages under a separate root stay excluded');
});

test('map renderer selects child meshes, excluding minimap and binary root', () => {
  const pack: RpkPack = { version: 0x200, dependencies: [], warnings: [], entries: [
    entry(1, 0x10004, 1), entry(20, 0x40003, 14, 'mesh 0x00000015\0'), entry(21, 0, 5),
    entry(26, 0x40003, 14, 'mesh 0x0000001b'), entry(27, 0, 5),
    entry(51, 20, 14, 'mesh 0x00000032'), entry(50, 0, 5),
    entry(54, 20, 14, 'mesh 0x00000035'), entry(53, 0, 5),
  ] };
  assert.deepEqual(mapRenderIds(pack), [20, 51, 54]);
});
