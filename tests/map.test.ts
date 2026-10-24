import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mapRenderIds } from '../src/engine/map';
import type { RpkEntry, RpkPack } from '../src/formats/rpk';

function entry(typeId: number, superId: number, type: number, body = ''): RpkEntry {
  const data = new TextEncoder().encode(body);
  return { typeId, superId, type, flags: 0, compatibility: 0, offset: 0, size: data.length, alias: '', data };
}

test('map renderer selects child meshes, excluding minimap and binary root', () => {
  const pack: RpkPack = { version: 0x200, dependencies: [], warnings: [], entries: [
    entry(1, 0x10004, 1), entry(20, 0x40003, 14),
    entry(26, 0x40003, 14, 'mesh 0x0000001b'), entry(27, 0, 5),
    entry(51, 20, 14, 'mesh 0x00000032'), entry(50, 0, 5),
    entry(54, 20, 14, 'mesh 0x00000035'), entry(53, 0, 5),
  ] };
  assert.deepEqual(mapRenderIds(pack), [51, 54]);
});
