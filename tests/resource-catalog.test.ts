import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RpkPack } from '../src/formats/rpk';
import { ResourceCatalog } from '../src/runtime/resource-catalog';

function pack(dependencies: RpkPack['dependencies'], entries: Array<readonly [number, number, string]>): RpkPack {
  return { version: 0x200, warnings: [], dependencies, entries: entries.map(([typeId, superId, alias]) => ({
    typeId, superId, alias, type: 8, flags: 0, compatibility: 1, offset: 0, size: 0, data: new Uint8Array(),
  })) };
}

test('resource catalog joins child types through an RPK dependency slot', () => {
  const catalog = new ResourceCatalog([['cars.rpk', pack([], [[0x1000, 8, 'vehicle']])]]);
  const racers = pack([{ id: 0x20000, path: 'cars.rpk', trailer: 0 }], [
    [0x15f, 0x21000, 'Baiern_VT'], [0x160, 0x15f, 'Baiern_model'],
  ]);
  racers.entries[0].data = new TextEncoder().encode('script cars\\racers\\Baiern_data\\scripts\\Baiern_VT.class');
  catalog.addPack('cars/racers/Baiern.rpk', racers);
  catalog.addPack('cars/racers/Baiern.rpk', racers);
  assert.deepEqual(catalog.childrenOf('cars', 0x1000), [{
    pack: 'cars/racers/baiern.rpk', id: 0x15f, type: 8, alias: 'Baiern_VT',
    script: 'cars\\racers\\Baiern_data\\scripts\\Baiern_VT.class',
  }]);
  assert.deepEqual(catalog.childrenOf('cars/racers/Baiern.rpk', 0x15f).map(item => item.alias), ['Baiern_model']);
  assert.equal(catalog.resolve('cars.racers.Baiern', 0x15f)?.script,
    'cars\\racers\\Baiern_data\\scripts\\Baiern_VT.class');
});
