import test from 'node:test';
import assert from 'node:assert/strict';
import { SlrrJvm, jv } from 'slrr-jvm';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { ResourceCatalog } from '../src/runtime/resource-catalog';
import type { RpkPack } from '../src/formats/rpk';

test('MapObject create_native/load preserves the resource pack, CFG and existing instance', async () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const catalog = new ResourceCatalog([]);
  const pack: RpkPack = { version: 0x200, dependencies: [], warnings: [], entries: [{
    typeId: 0x45, superId: 0, type: 8, flags: 0, compatibility: 1, offset: 0, size: 0,
    alias: 'map_object', data: new TextEncoder().encode('script MapObject.class\nnative part map-object.cfg'),
  }] };
  let configured = 0;
  const resources = new GameTypeNative(jvm, () => {}, undefined, catalog,
    async () => { throw new Error('load must not run the resource script constructor'); },
    async path => catalog.addPack(path, pack), undefined, undefined,
    async (_, path) => { assert.equal(path, 'map-object.cfg'); configured++; });
  const handle = () => jv('GameRef', { className: 'java.util.resource.GameRef', fields: new Map() });
  const template = handle(), parent = handle(), object = handle();
  jvm.natives.invoke('java.util.resource.ResourceRef', 'set', template,
    [resources.remountSavedResource('misc/dealer.rpk', 0x45)]);
  jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', parent, []);
  await jvm.natives.invokeAsync('java.util.resource.GameRef', 'create_native', object,
    [parent, template, jv('String', '0,0,0,0,0,0'), jv('String', 'mapObject')]);
  const node = resources.getResource(object)!;
  assert.equal(node.resourcePack, 'misc/dealer.rpk');
  assert.equal(configured, 1);
  for (let i = 0; i < 2; i++) await jvm.natives.invokeAsync('java.util.resource.ResourceRef', 'load', object, []);
  assert.equal(resources.getResource(object), node);
  assert.equal(node.parent, resources.getResource(parent));
  assert.equal(node.resourceScript, 'MapObject.class');
  assert.equal(configured, 1, 'load does not reset an already configured object');
  await jvm.natives.invokeAsync('java.util.resource.ResourceRef', 'load', template, []);
  assert.equal(resources.getResource(template)!.resourceType, 8);
  resources.dispose();
});
