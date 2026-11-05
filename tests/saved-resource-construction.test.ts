import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jv, SlrrJvm } from 'slrr-jvm';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { ResourceCatalog } from '../src/runtime/resource-catalog';
import type { RpkPack } from '../src/formats/rpk';

for (const lazy of [false, true]) test(`saved chassis resource retains its original CFG identity (${lazy ? 'lazy' : 'loaded'} pack)`, async () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const pack: RpkPack = { version: 0x200, dependencies: [], warnings: [], entries: [{
    typeId: 0x126, superId: 0, type: 8, flags: 0, compatibility: 1, offset: 0, size: 0, alias: 'test_car',
    data: new TextEncoder().encode('script cars/test/Car.class\nnative car cars/test/chassis.cfg\n'),
  }] };
  const catalog = new ResourceCatalog(lazy ? [] : [['cars/test.rpk', pack]]);
  let invoked = 0;
  const resources: GameTypeNative = new GameTypeNative(jvm, () => {}, undefined, catalog, async (script, id, path) => {
    invoked++;
    assert.equal(script, 'cars/test/Car.class');
    // The native constructor receives a remounted ID; CFG lookup must use the saved local entry.
    assert.equal(resources.catalogResource(path!, id)?.cfgPath, 'cars/test/chassis.cfg');
    return jv('Car', { className: 'java.game.cars.TestCar', fields: new Map() });
  }, async path => { catalog.addPack(path, pack); });
  const saved = resources.remountSavedResource('cars/test.rpk', 0x126);
  const template = jv('GameRef', { className: 'java.util.resource.GameRef', fields: new Map() });
  // Java stores readResID() in a plain int field, discarding JavaValue metadata.
  jvm.natives.invoke('java.util.resource.ResourceRef', 'set', template, [jv('int', Number(saved.value))]);
  const factory = jv('GameRef', { className: 'java.util.resource.GameRef', fields: new Map() });
  await jvm.natives.invokeAsync('java.util.resource.GameRef', 'create', factory,
    [jv('GameRef', null), template, jv('String', '0,0,0,0,0,0'), jv('String', 'Vehicle')]);
  assert.equal(invoked, 1, 'a saved car must instantiate its original Java class');
  resources.dispose();
});
