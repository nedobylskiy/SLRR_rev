import test from 'node:test';
import assert from 'node:assert/strict';
import {Assets} from '../src/assets';
import {assetReadBatch} from '../src/render/asset-read-batch';

test('compiled ground sections share in-flight and completed texture reads within one assembly',async()=>{
  let reads=0;const bytes=new Uint8Array([1,2,3]);
  const assets=new Assets([{path:'Maps/Textures/road.dds',size:3}],async()=>{reads++;return bytes;});
  const read=assetReadBatch(assets);
  const textures=await Promise.all(Array.from({length:1000},(_,i)=>read(i%2?'maps/textures/road.dds':'Maps\\Textures\\ROAD.DDS')));
  assert.equal(reads,1);assert.ok(textures.every(t=>t===bytes));
  await read('maps/textures/road.dds');assert.equal(reads,1);
  await assetReadBatch(assets)('maps/textures/road.dds');assert.equal(reads,2,'a new assembly can read updated files');
});
test('failed reads can retry and separate asset collections never share bytes',async()=>{
  const files=[{path:'road.dds',size:1}];let attempts=0;
  const a=assetReadBatch(new Assets(files,async()=>{if(++attempts===1)throw Error('read failed');return new Uint8Array([1]);}));
  const b=assetReadBatch(new Assets(files,async()=>new Uint8Array([2])));
  await assert.rejects(a('road.dds'),/read failed/);
  assert.equal((await a('road.dds'))[0],1);assert.equal((await b('road.dds'))[0],2);
});
