import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jv, SlrrJvm } from 'slrr-jvm';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { ResourceCatalog } from '../src/runtime/resource-catalog';
import type { RpkPack } from '../src/formats/rpk';

test('catalog isScripted checks original Java inheritance without constructing a resource', async () => {
  const source = 'package test; class Part {} class Panel extends Part {} class BodyPanel extends Panel {} class Set {}';
  const jvm = new SlrrJvm({ resolveImport: () => ({ path: 'BodyPanel.java', source }) });
  const pack: RpkPack = { version: 0x200, dependencies: [], warnings: [], entries: [
    { typeId: 0x126, script: 'BodyPanel' }, { typeId: 0x127, script: 'Set' }, { typeId: 0x128 },
  ].map(entry => ({ typeId: entry.typeId, superId: 0, type: 8, flags: 0, compatibility: 1,
    offset: 0, size: 0, alias: 'node', data: new TextEncoder().encode(entry.script ? `script ${entry.script}` : '') })) };
  const catalog = new ResourceCatalog([]);
  let checks = 0;
  const resources = new GameTypeNative(jvm, () => {}, undefined, catalog,
    async () => { throw new Error('isScripted must not run resource constructors'); },
    async path => { catalog.addPack(path, pack); }, undefined, undefined, undefined,
    async (script, _, base) => {
      checks++; await jvm.loadClass(`test.${script}`);
      return jvm.isInstance(jv(script, { className: `test.${script}`, fields: new Map() }), base);
    });
  const ref = (id: number) => {
    const value = jv('GameRef', { className: 'java.util.resource.GameRef', fields: new Map() });
    jvm.natives.invoke('java.util.resource.ResourceRef', 'set', value, [resources.remountSavedResource('test.rpk', id)]);
    return value;
  };
  const check = async (value: ReturnType<typeof ref>, base: string | null) =>
    (await jvm.natives.invokeAsync('java.util.resource.GameRef', 'isScripted', value, [jv('String', base)]))!.value;
  const part = ref(0x126);
  assert.equal((await jvm.natives.invokeAsync('java.util.resource.ResourceRef', 'isScripted', part, []))!.value, 1);
  assert.equal((await jvm.natives.invokeAsync('java.util.resource.ResourceRef', 'isScripted', ref(0x128), []))!.value, 0);
  assert.equal(await check(part, null), 1); assert.equal(checks, 0);
  assert.equal(await check(part, 'test.Part'), 1);
  assert.equal(await check(part, 'test.Set'), 0);
  assert.equal(await check(ref(0x127), 'test.Set'), 1);
  assert.equal(await check(ref(0x128), null), 0);
  assert.equal(await check(ref(0x128), 'test.Part'), 0);
  resources.dispose();
});
