import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv } from 'slrr-jvm';
import { GameTypeNative } from '../src/runtime/game-type-native';

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
