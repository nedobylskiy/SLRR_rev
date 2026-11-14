import test from 'node:test';
import assert from 'node:assert/strict';
import { Assets } from '../src/assets';
import type { RpkPack } from '../src/formats/rpk';

test('texture resources without a source retain their slot in the render material table', async () => {
  const pack: RpkPack = { version: 0x200, dependencies: [], warnings: [], entries: [
    [1,14,'mesh 0x2\ntexture 0x3\ntexture 0x4\ntexture 0x5'],
    [2,5,'sourcefile track.scy'],[3,7,'sourcefile road.dds'],[4,7,''],[5,7,'sourcefile windows.dds'],
  ].map(([id,type,text]) => ({typeId:Number(id),type:Number(type),superId:0,flags:0,compatibility:0,offset:0,size:0,alias:'',data:new TextEncoder().encode(String(text))})) };
  const assets = new Assets([],async()=>{ throw new Error('Unexpected file read'); });
  assets.pack = async()=>pack;
  assert.deepEqual((await assets.modelForResource('map.rpk',1)).textures,['road.dds','','windows.dds']);
});
