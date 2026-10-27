import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jv, SlrrJvm, type JavaValue } from 'slrr-jvm';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { ViewportNative } from '../src/runtime/viewport-native';
import { CameraNative } from '../src/runtime/camera-native';
import { RenderRefNative } from '../src/runtime/render-ref-native';

const ref = (name: string): JavaValue => jv(name.split('.').at(-1)!, { className: name, fields: new Map() });
const vector = (x: number, y: number, z: number): JavaValue => jv('Vector3', { className: 'java.lang.Vector3',
  fields: new Map([['x', jv('float', x)], ['y', jv('float', y)], ['z', jv('float', z)]]) });

test('Java viewport reads live canvas aspect and retains normalized OSD bounds', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const resources = new GameTypeNative(jvm, () => {});
  let size = { width: 1600, height: 900 };
  const viewports = new ViewportNative(jvm, resources, () => size);
  const viewport = ref('java.render.Viewport');
  jvm.natives.invoke('java.util.resource.ResourceRef', 'newNative', viewport, []);
  jvm.natives.invoke('java.render.Viewport', 'create', viewport,
    [jv('int', 127), jv('float', 0), jv('float', 0), jv('float', 1), jv('float', 1)]);
  assert.equal(resources.getResource(viewport)?.resourceType, 18);
  assert.equal(jvm.natives.invoke('java.render.Viewport', 'getWidth', viewport, [])?.value, 1);
  assert.equal(jvm.natives.invoke('java.render.Viewport', 'getAspect', viewport, [])?.value, 1600 / 900);
  size = { width: 900, height: 900 };
  assert.equal(jvm.natives.invoke('java.render.Viewport', 'getAspect', viewport, [])?.value, 1);
  jvm.natives.invoke('java.render.Viewport', 'resize', viewport,
    [jv('float', 0.25), jv('float', 0), jv('float', 0.5), jv('float', 1)]);
  assert.equal(jvm.natives.invoke('java.render.Viewport', 'getLeft', viewport, [])?.value, 0.25);
  assert.equal(jvm.natives.invoke('java.render.Viewport', 'getAspect', viewport, [])?.value, 0.5);
  assert.equal(viewports.get(viewport)?.priority, 127);
  jvm.natives.invoke('java.render.Viewport', 'destroy', viewport, []);
  assert.equal(resources.getResource(viewport)?.resourceId, 0);
});

test('Camera.create links its render resource to the Java parent and viewport', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const resources = new GameTypeNative(jvm, () => {});
  const viewports = new ViewportNative(jvm, resources, () => ({ width: 800, height: 600 }));
  new RenderRefNative(jvm, resources);
  const cameras = new CameraNative(jvm, resources, viewports);
  const parent = ref('java.game.MouseCursor'), viewport = ref('java.render.Viewport'), camera = ref('java.render.Camera');
  jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', parent, []);
  for (const item of [viewport, camera]) jvm.natives.invoke('java.util.resource.ResourceRef', 'newNative', item, []);
  jvm.natives.invoke('java.render.Viewport', 'create', viewport,
    [jv('int', 127), jv('float', 0), jv('float', 0), jv('float', 1), jv('float', 1)]);
  jvm.natives.invoke('java.render.Camera', 'create', camera, [jv('ResourceRef', parent.value), viewport, jv('int', 0),
    jv('float', 16.7), jv('float', 0.1), jv('float', 100), jv('float', 1), jv('float', 1), jv('int', 1), jv('int', 0)]);
  assert.equal(resources.getResource(camera)?.parent, resources.getResource(parent));
  assert.equal(cameras.get(camera)?.viewport.value, viewport.value);
  assert.equal(cameras.get(camera)?.halfAov, 16.7);
  jvm.natives.invoke('java.util.resource.RenderRef', 'setMatrix', camera, [vector(0, 0, 10), jv('Ypr', null)]);
  assert.deepEqual(resources.getRender(camera)?.position, { x: 0, y: 0, z: 10 });
});
