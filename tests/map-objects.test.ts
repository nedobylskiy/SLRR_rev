import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mapObjectPlacements, parseIcfg } from '../src/engine/map-objects';
import type { RpkPack } from '../src/formats/rpk';

test('RDB instances retain original world pose and resolve dependency namespace', () => {
  const pack: RpkPack = { version: 0x200, dependencies: [{ id: 0x00060000, path: 'objects.rpk', trailer: 0 }], entries: [], warnings: [] };
  const rdb = `<FILE 0000074e.res >\ntypeof 1\nalias kont\n</FILE>\n<FILE 0000074e.rsd >\ngametype 0x00060527\nparams -241.218,1.431,-998.091,3.142,0.000,0.000\n</FILE>`;
  assert.deepEqual(mapObjectPlacements(rdb, pack), [{ id: 0x74e, alias: 'kont', typeId: 0x00060527,
    pose: { position: [-241.218, 1.431, -998.091], rotation: [3.142, 0, 0] } }]);
});

test('compiled ICFG exposes the original box body and render reference', () => {
  const config = 'bounds -2 -1 -1 2 1 1\nbody 0 0 0 0 0 0 0 box 2 1 1\nrender 0x522 0 0 0 0 0 0\neof\n';
  const bytes = new Uint8Array([...new TextEncoder().encode('ICFG'), 0, 0, 0, 0, ...new TextEncoder().encode('object\0'), ...new TextEncoder().encode(config)]);
  const parsed = parseIcfg(bytes);
  assert.deepEqual(parsed.bodies[0].shape, ['box', '2', '1', '1']);
  assert.equal(parsed.renders[0].resource, 0x522);
});
