import test from 'node:test';
import assert from 'node:assert/strict';
import { Assets } from '../src/assets';
import { resourceSizeReader } from '../src/runtime/resource-size';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { SlrrJvm, jv } from 'slrr-jvm';

test('GII_SIZE measures centimetres from visual geometry lazily and caches only the result', async () => {
  const bytes = new Uint8Array(216), data = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('INVO'));
  data.setUint32(4, 3, true); data.setUint32(8, 56, true); data.setUint32(64, 3, true);
  data.setFloat32(68 + 44, 250, true); data.setFloat32(68 + 88 + 8, 100, true);
  data.setUint32(200, 1, true); data.setUint32(208, 1, true); data.setUint32(212, 2, true);
  let reads = 0;
  const assets = new Assets([{ path: 'mesh.scx', size: bytes.length }, { path: 'part.cfg', size: 10 }], async path => {
    reads++; return path === 'part.cfg' ? new TextEncoder().encode('render 0x1') : bytes;
  });
  assets.modelForResource = async () => ({ path: 'mesh.scx', textures: [] });
  const resource = { resourcePack: 'parts.rpk', typeId: 1 };
  const host = { getResource: () => resource, catalogResource: () => ({ cfgPath: 'part.cfg' }) } as unknown as GameTypeNative;
  const read = resourceSizeReader(assets, () => host);
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const native = new GameTypeNative(jvm, () => {}, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, read);
  const receiver = jv('GameRef', {});
  assert.equal(reads, 0);
  const query = () => jvm.natives.invokeAsync('java.util.resource.GameRef', 'getInfo', receiver, [jv('int', 11), jv('int', 0)]);
  assert.equal((await query())!.value, 250);
  assert.equal((await query())!.value, 250); assert.equal(reads, 2);
  native.dispose();
});
