import test from 'node:test';
import assert from 'node:assert/strict';
import { Assets } from '../src/assets';
import { parsePartConfig } from '../src/formats/cfg';
import { loadPartCollision } from '../src/engine/part-collision';

test('CFG physical meshes use body poses and centimetres, excluding nocollision water bodies', async () => {
  const bytes = new Uint8Array(216), data = new DataView(bytes.buffer); bytes.set(new TextEncoder().encode('INVO'));
  data.setUint32(4, 3, true); data.setUint32(8, 56, true); data.setUint32(64, 3, true);
  data.setFloat32(68 + 44, 100, true); data.setFloat32(68 + 88 + 8, 100, true);
  data.setUint32(200, 1, true); data.setUint32(208, 1, true); data.setUint32(212, 2, true);
  let reads = 0; const assets = new Assets([{ path: 'mesh.scx', size: bytes.length }], async () => { reads++; return bytes; });
  const config = parsePartConfig('body 1 2 3 0 0 0 10 mesh.scx\nbody 9 9 9 0 0 0 1 mesh.scx\nnocollision');
  const triangles = await loadPartCollision(assets, { key: { pack: 'test.rpk', id: 1 }, alias: 'test', cfgPath: 'test.cfg', config });
  assert.deepEqual(triangles, [1, 2, 3, 2, 2, 3, 1, 2, 4]); assert.equal(reads, 1); assert.equal(config.bodies[1].collision, false);
});
