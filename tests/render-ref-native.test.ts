import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jv, SlrrJvm, type JavaValue } from 'slrr-jvm';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { RenderRefNative } from '../src/runtime/render-ref-native';
import { RenderObject } from '../src/runtime/render-object';

const ref = (name: string): JavaValue => jv(name.split('.').at(-1)!, { className: name, fields: new Map() });
const vector = (x: number, y: number, z: number) => jv('Vector3', { className: 'java.lang.Vector3',
  fields: new Map([['x', jv('float', x)], ['y', jv('float', y)], ['z', jv('float', z)]]) });
const ypr = (y: number, p: number, r: number) => jv('Ypr', { className: 'java.lang.Ypr',
  fields: new Map([['y', jv('float', y)], ['p', jv('float', p)], ['r', jv('float', r)]]) });

test('RenderRef.create makes a typed visual child and setMatrix moves that instance', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const changes: string[] = [];
  const resources = new GameTypeNative(jvm, () => {}, node => changes.push(`${node.alias}:${node.position.x}`));
  new RenderRefNative(jvm, resources);
  const osd = ref('java.render.Osd'), type = ref('java.util.resource.RenderRef');
  const instance = ref('java.util.resource.RenderRef');
  jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', osd, []);
  for (const item of [type, instance]) jvm.natives.invoke('java.util.resource.ResourceRef', 'newNative', item, []);
  jvm.natives.invoke('java.util.resource.ResourceRef', 'set', type, [jv('int', 0xd7)]);
  jvm.natives.invoke('java.util.resource.RenderRef', 'create', instance,
    [jv('ResourceRef', osd.value), type, jv('String', 'Rectangle')]);
  const node = resources.getRender(instance)!;
  assert.ok(node instanceof RenderObject);
  assert.equal(node.parent, resources.getResource(osd));
  assert.equal(node.renderType, resources.getResource(type));
  assert.equal(node.alias, 'Rectangle');
  assert.equal(node.resourceType, 3);
  assert.equal(jvm.natives.invoke('java.util.resource.RenderRef', 'getTypeID', instance, [])?.value, 0xd7);
  jvm.natives.invoke('java.util.resource.RenderRef', 'setMatrix', instance,
    [vector(1, 2, 3), ypr(0.2, 0.3, 0.4)]);
  assert.deepEqual(node.position, { x: 1, y: 2, z: 3 });
  assert.deepEqual(node.orientation, { y: 0.2, p: 0.3, r: 0.4 });
  assert.equal(resources.getResource(type)?.parent, null);
  assert.deepEqual(changes, ['Rectangle:0', 'Rectangle:1']);
});

test('RenderRef.setType changes the instance type without moving it', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const resources = new GameTypeNative(jvm, () => {});
  new RenderRefNative(jvm, resources);
  const parent = ref('java.util.resource.GameRef'), first = ref('java.util.resource.RenderRef');
  const second = ref('java.util.resource.RenderRef'), instance = ref('java.util.resource.RenderRef');
  jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', parent, []);
  for (const item of [first, second, instance]) jvm.natives.invoke('java.util.resource.ResourceRef', 'newNative', item, []);
  jvm.natives.invoke('java.util.resource.ResourceRef', 'set', first, [jv('int', 10)]);
  jvm.natives.invoke('java.util.resource.ResourceRef', 'set', second, [jv('int', 20)]);
  jvm.natives.invoke('java.util.resource.RenderRef', 'create', instance,
    [jv('ResourceRef', parent.value), first, jv('String', null)]);
  jvm.natives.invoke('java.util.resource.RenderRef', 'setType', instance, [jv('ResourceRef', second.value)]);
  assert.equal(resources.getRender(instance)?.typeId, 20);
  assert.equal(resources.getRender(instance)?.alias, '_renderinst');
  assert.equal(resources.getRender(instance)?.parent, resources.getResource(parent));
});

test('RenderRef.setLight forwards all three source colors from a light resource', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const resources = new GameTypeNative(jvm, () => {});
  const colors: { diffuse: number; ambient: number; specular: number }[] = [];
  new RenderRefNative(jvm, resources, undefined, settings => colors.push(settings));
  const sun = ref('java.util.resource.RenderRef');
  jvm.natives.invoke('java.util.resource.ResourceRef', 'newNative', sun, []);
  assert.equal(jvm.natives.invoke('java.util.resource.RenderRef', 'setLight', sun,
    [jv('int', 0x00d8d4b0), jv('int', 0x00375070), jv('int', 0x00d8d4b0)])?.type, 'void');
  assert.deepEqual(colors, [{ diffuse: 0xd8d4b0, ambient: 0x375070, specular: 0xd8d4b0 }]);
});

test('mock SkidMark line is a releasable resource without a visual instance', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const resources = new GameTypeNative(jvm, () => {});
  new RenderRefNative(jvm, resources);
  const parent = ref('java.util.resource.GameRef');
  const line = ref('java.render.SkidMark');
  jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', parent, []);
  jvm.natives.invoke('java.util.resource.ResourceRef', 'newNative', line, []);
  const result = jvm.natives.invoke('java.util.resource.RenderRef', 'lineCreate', line,
    [jv('ResourceRef', parent.value), jv('ResourceRef', null)]);
  assert.equal(result?.value, 1);
  assert.equal(resources.getResource(line)?.parent, resources.getResource(parent));
  assert.equal(resources.getRender(line), undefined);
  jvm.natives.invoke('java.util.resource.RenderRef', 'lineAdd', line,
    [vector(1, 2, 3), vector(0, 1, 0), jv('int', 0xffffffff), jv('float', 1)]);
  jvm.natives.invoke('java.util.resource.ResourceRef', 'destroy', line, []);
  assert.equal(resources.getResource(line), undefined);
});
