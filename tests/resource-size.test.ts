import test from 'node:test';
import assert from 'node:assert/strict';
import { Assets } from '../src/assets';
import { resourceBoundsReader, resourceSizeReader } from '../src/runtime/resource-size';
import { ChassisNative } from '../src/runtime/chassis-native';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { SlrrJvm, jv } from 'slrr-jvm';
import type { RpkEntry } from '../src/formats/rpk';

test('GII_SIZE measures centimetres from visual geometry lazily and caches only the result', async () => {
  const bytes = new Uint8Array(216), data = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('INVO'));
  data.setUint32(4, 3, true); data.setUint32(8, 56, true); data.setUint32(64, 3, true);
  data.setFloat32(68 + 44, 250, true); data.setFloat32(68 + 88 + 8, 100, true);
  data.setUint32(200, 1, true); data.setUint32(208, 1, true); data.setUint32(212, 2, true);
  let reads = 0;
  const assets = new Assets([{ path: 'mesh.scx', size: bytes.length }, { path: 'part.cfg', size: 10 }], async path => {
    reads++; return path === 'part.cfg' ? new TextEncoder().encode('render 0x1 1 2 3 1.5707963267948966 0 0\nrender 0x20011 1000 1000 1000') : bytes;
  });
  assets.resource = async (pack, id) => ({packPath:id===0x20011?'cars/racers.rpk':pack,
    entry:{type:id===0x20011?13:14} as RpkEntry});
  assets.modelForResource = async (_pack,id) => {
    assert.equal(id,1,'cross-pack tail light must never be opened as SCX');
    return { path: 'mesh.scx', textures: [] };
  };
  const resource = { resourcePack: 'parts.rpk', typeId: 1 };
  const host = { getResource: () => resource, catalogResource: () => ({ cfgPath: 'part.cfg' }) } as unknown as GameTypeNative;
  const bounds = resourceBoundsReader(assets, () => host);
  const read = resourceSizeReader(assets, () => host, bounds);
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const native = new GameTypeNative(jvm, () => {}, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, read);
  new ChassisNative(jvm, native, bounds);
  const receiver = jv('GameRef', {});
  assert.equal(reads, 0);
  const query = () => jvm.natives.invokeAsync('java.util.resource.GameRef', 'getInfo', receiver, [jv('int', 11), jv('int', 0)]);
  assert.equal((await query())!.value, 250);
  assert.equal((await query())!.value, 250); assert.equal(reads, 2);
  const vector = async (method: string) => {
    const result = await jvm.natives.invokeAsync('java.game.parts.bodypart.Chassis', method, receiver, []);
    return ['x', 'y', 'z'].map(axis => Number((result!.value as { fields: Map<string, { value: number }> }).fields.get(axis)!.value));
  };
  assert.deepEqual(await vector('getMin'), [1, 2, 0.5]);
  assert.deepEqual(await vector('getMax'), [2, 2, 3]);
  assert.equal(reads, 2, 'size and both bounds share one mesh read');
  const copy = await bounds(receiver); copy!.min.set(99, 99, 99);
  assert.deepEqual(await vector('getMin'), [1, 2, 0.5], 'callers cannot mutate cached bounds');
  native.dispose();
});

test('light-only bounds retain the size fallback while actual missing geometry still reports errors', async () => {
  const assets = new Assets([{path:'part.cfg',size:0}],async () => new TextEncoder().encode('render 0x11'));
  let type = 13;
  assets.resource = async () => ({packPath:'cars/racers.rpk',entry:{type} as RpkEntry});
  assets.modelForResource = async () => {throw new Error('Missing real mesh');};
  const host = {getResource:()=>({resourcePack:'cars/racers.rpk',typeId:1}),catalogResource:()=>({cfgPath:'part.cfg'})} as unknown as GameTypeNative;
  const bounds = resourceBoundsReader(assets,()=>host);
  assert.equal(await bounds(jv('Part',{})),null);
  assert.equal(await resourceSizeReader(assets,()=>host,bounds)(jv('Part',{})),100);
  type = 14;
  await assert.rejects(resourceBoundsReader(assets,()=>host)(jv('Part',{})),/Missing real mesh/);
});
