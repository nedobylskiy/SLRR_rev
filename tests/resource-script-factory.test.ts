import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv } from 'slrr-jvm';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { ResourceCatalog } from '../src/runtime/resource-catalog';

test('GameRef.create constructs the Java class named by an RPK resource script', async () => {
  const source = 'package demo; class Scripted { int constructed; Scripted(int id) { constructed = id; } }';
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className === 'demo.Scripted'
    ? { path: 'Scripted.java', source } : null, selectMethods: () => ['Scripted'] });
  await jvm.loadClass('demo.Scripted');
  const resources = new GameTypeNative(jvm, () => {}, undefined, undefined,
    async (_script, id) => jvm.constructAsync('demo.Scripted', [jv('int', id)]));
  const template = jv('ResourceRef', { className: 'java.util.resource.ResourceRef', fields: new Map() });
  jvm.natives.invoke('java.util.resource.ResourceRef', 'newNative', template, []);
  const type = resources.getResource(template)!;
  type.typeId = 0x1000;
  type.resourceScript = 'cars/test/scripts/Scripted.class';
  const factory = jv('GameRef', { className: 'java.util.resource.GameRef', fields: new Map() });
  const created = await jvm.natives.invokeAsync('java.util.resource.GameRef', 'create', factory,
    [jv('GameRef', null), template, jv('String', null), jv('String', 'VehicleType')]);
  assert.equal(created?.type, 'Scripted');
  assert.equal(jvm.get(created!, 'constructed').value, 0x1000);
  assert.equal(resources.get(created!)?.typeId, 0x1000);
  assert.equal(resources.get(created!)?.resourceScript, type.resourceScript);
});

test('GameRef.create resolves a pack-qualified int and runs its scripted class', async () => {
  const source = 'package demo; class Scripted { int constructed; Scripted(int id) { constructed = id; } int init() { return constructed; } }';
  const jvm = new SlrrJvm({ resolveImport: ({ className }) => className === 'demo.Scripted'
    ? { path: 'Scripted.java', source } : null });
  await jvm.loadClass('demo.Scripted');
  const script = 'multibot\\maps\\Norisring\\data\\track_data.class';
  const pack = {
    version: 0x200, warnings: [], dependencies: [], entries: [{
      typeId: 0x102, superId: 0, type: 8, flags: 0, compatibility: 1,
      offset: 0, size: 0, alias: 'track_data', data: new TextEncoder().encode(`script ${script}`),
    }],
  };
  const catalog = new ResourceCatalog([]);
  const resources = new GameTypeNative(jvm, () => {}, undefined, catalog,
    async (_script, id) => jvm.constructAsync('demo.Scripted', [jv('int', id)]),
    async requested => {
      assert.equal(requested, 'multibot.maps.Norisring.t_data');
      catalog.addPack('multibot/maps/Norisring/t_data.rpk', pack);
    });
  const mapEntry = jv('ResourceRef', { className: 'java.util.resource.ResourceRef',
    fields: new Map([['typeID', jv('int', 0x102)]]) });
  const id = { ...jv('int', 0x102), resource: { pack: 'multibot.maps.Norisring.t_data', id: 0x102 } };
  jvm.natives.invoke('java.util.resource.ResourceRef', 'set', mapEntry, [id]);
  const fromMapStack = jvm.natives.invoke('java.util.resource.ResourceRef', 'id', mapEntry, [])!;
  assert.deepEqual(fromMapStack.resource, id.resource);
  const type = jv('GameRef', { className: 'java.util.resource.GameRef',
    fields: new Map([['typeID', jv('int', 0x102)]]) });
  jvm.natives.invoke('java.util.resource.ResourceRef', 'set', type, [fromMapStack]);
  assert.equal(resources.getResource(type)?.resourceScript, null);
  const factory = jv('GameRef', { className: 'java.util.resource.GameRef', fields: new Map() });
  const created = await jvm.natives.invokeAsync('java.util.resource.GameRef', 'create', factory,
    [jv('GameRef', null), type, jv('String', null), jv('String', 'track data')]);
  assert.equal(created?.type, 'Scripted');
  assert.equal(jvm.invoke(created!, 'init').value, 0x102);
  assert.equal(resources.get(created!)?.resourcePack, 'multibot/maps/norisring/t_data.rpk');
});

test('map texture type IDs remain distinct across t_data packs', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  new GameTypeNative(jvm, () => {});
  const makeTexture = (pack: string) => {
    const ref = jv('ResourceRef', { className: 'java.util.resource.ResourceRef',
      fields: new Map([['typeID', jv('int', 0x101)]]) });
    jvm.natives.invoke('java.util.resource.ResourceRef', 'set', ref,
      [{ ...jv('int', 0x101), resource: { pack, id: 0x101 } }]);
    return Number(jvm.get(ref, 'typeID').value);
  };
  const first = makeTexture('multibot/maps/aring/t_data.rpk');
  assert.equal(makeTexture('multibot/maps/aring/t_data.rpk'), first);
  assert.notEqual(makeTexture('multibot/maps/gateway/t_data.rpk'), first);
});
