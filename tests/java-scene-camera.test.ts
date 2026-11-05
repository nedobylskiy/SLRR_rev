import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv } from 'slrr-jvm';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { ResourceCatalog } from '../src/runtime/resource-catalog';
import { javaSceneCamera } from '../src/runtime/java-scene-camera';
import type { BootResult } from '../src/runtime/game-boot';
import { ControllerNative } from '../src/runtime/controller-native';
import { InputNative } from '../src/runtime/input-native';

test('shop camera consumes native creation pose and Java render/move/look/height/zoom commands', async () => {
  const source = 'package java.game; class GameLogic { static Object actualState; } class Track {}';
  const jvm = new SlrrJvm({ resolveImport: () => ({ path: 'GameLogic.java', source }) });
  await jvm.loadClass('java.game.GameLogic'); await jvm.globalAsync('java.game.GameLogic');
  await jvm.loadClass('java.game.Track');
  const catalog = new ResourceCatalog([['system.rpk', { version: 0x200, dependencies: [], warnings: [], entries: [{
    typeId: 0x33, superId: 0, type: 8, flags: 0, compatibility: 1, offset: 0, size: 13, alias: 'camera', data: new TextEncoder().encode('native camera'),
  }] }]]);
  const resources = new GameTypeNative(jvm, () => {}, undefined, catalog);
  const ref = (className: string) => jv('GameRef', { className, fields: new Map() });
  const map = ref('java.game.Scene'); jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', map, []);
  const template = ref('java.util.resource.GameRef'), id = jv('int', 0x33); id.resource = { pack: 'system.rpk', id: 0x33 };
  jvm.natives.invoke('java.util.resource.ResourceRef', 'set', template, [id]);
  const cam = ref('java.util.resource.GameRef');
  await jvm.natives.invokeAsync('java.util.resource.GameRef', 'create', cam,
    [map, template, jv('String', '10,2,-3,0,0,0,0x13,1.8,0,0.05'), jv('String', 'camera')]);
  assert.deepEqual(resources.get(cam)?.position, { x: 10, y: 2, z: -3 });
  const state = jv('CarMarket', { className: 'java.game.CarMarket', fields: new Map([['cam', cam]]) });
  jvm.set(jv('class', 'java.game.GameLogic'), 'actualState', state);
  const result = { jvm, gameTypes: resources } as unknown as BootResult;
  const command = async (text: string) => jvm.natives.invokeAsync('java.util.resource.GameRef', 'queueEvent', cam,
    [jv('ResourceRef', null), jv('int', 16), jv('String', text)]);
  assert.equal(javaSceneCamera(result), null);
  const car = ref('java.game.Vehicle'); jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', car, []);
  resources.get(car)!.setMatrix({ x: 100, y: 1, z: 50 }, { y: Math.PI / 2, p: 0, r: 0 });
  await command('render 123 0 0 1 3'); await command('dist 2.5 4.6'); await command('height 1.9');
  await command('zoom 60 5'); await command('farplane 200'); await command('smooth 0.05 0.5');
  await command(`move ${resources.get(car)!.resourceId} 0,0,0 4.5`);
  await command(`look ${resources.get(car)!.resourceId} 1,0,0 0,0,0`);
  const view = javaSceneCamera(result)!;
  assert.deepEqual(view.target.toArray().map(value => Math.round(value * 100) / 100), [100, 1, 49]);
  assert.ok(Math.abs(Math.hypot(view.position.x - 100, view.position.z - 50) - 4.6) < 1e-8);
  assert.equal(view.position.y, 2.9); assert.equal(view.fov, 60); assert.equal(view.far, 200);
  resources.get(car)!.position.x = 200;
  assert.equal(javaSceneCamera(result)!.target.x, 200, 'selection/target motion is read every frame');
  // The Java cursor controls this camera only; motion is consumed once and its
  // resulting native pose survives subsequent frames and Garage.exit().
  let motion = { x: 0.5, y: 0.25, zoom: 0 };
  result.input = { sceneCameraMotion: () => { const value = motion; motion = { x: 0, y: 0, zoom: 0 }; return value; } } as unknown as InputNative;
  const previous = javaSceneCamera({ ...result, input: undefined } as unknown as BootResult)!;
  const moved = javaSceneCamera(result)!;
  assert.ok(moved.position.distanceTo(previous.position) > 0.1);
  assert.deepEqual(moved.target, previous.target);
  assert.deepEqual(resources.get(cam)!.position, { x: moved.position.x, y: moved.position.y, z: moved.position.z });
  assert.ok(javaSceneCamera(result)!.position.distanceTo(moved.position) < 1e-10, 'released drag retains the camera pose');
  await command('hide 123'); assert.equal(javaSceneCamera(result), null);
  await command('render 123 0 0 1 3'); assert.ok(javaSceneCamera(result));
  const track = jvm.construct('java.game.Track', []); jvm.set(jv('class', 'java.game.GameLogic'), 'actualState', track);
  assert.equal(javaSceneCamera(result), null, 'driving cameras retain their existing path');
  jvm.set(jv('class', 'java.game.GameLogic'), 'actualState', state);
  jvm.natives.invoke('java.util.resource.ResourceRef', 'destroy', cam, []);
  assert.equal(javaSceneCamera(result), null);
});

test('scene camera input follows the Java cursor controller mappings and releases the mouse axes', async () => {
  const jvm = new SlrrJvm({ resolveImport: () => ({
    path: 'Input.java', source: 'package java.io; class Input { static Object cursor; }',
  }) });
  await jvm.loadClass('java.io.Input'); await jvm.globalAsync('java.io.Input');
  const resources = new GameTypeNative(jvm, () => {});
  let input: InputNative;
  const controllers = new ControllerNative(jvm, (d, a) => input.physicalAxis(d, a));
  input = new InputNative(jvm, controllers, resources);
  const ref = (name: string) => jv(name, { className: name, fields: new Map() });
  const camera = ref('GameRef'), other = ref('GameRef'), controller = ref('Controller');
  for (const cameraRef of [camera, other]) jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', cameraRef, []);
  const cursor = jv('MouseCursor', { className: 'MouseCursor', fields: new Map([
    ['controlledcam', camera], ['controller', controller],
  ]) });
  jvm.set(jv('class', 'java.io.Input'), 'cursor', cursor);
  input.setPhysicalAxis(1, 0, 0.5);
  assert.deepEqual(input.sceneCameraMotion(camera), { x: 0, y: 0, zoom: 0 });
  jvm.natives.invoke('java.io.Controller', 'user_Add', controller, [jv('int', 7), jv('int', 0), jv('int', 203),
    ...[0, 1, 0, 0.01].map(n => jv('float', n))]);
  input.setPhysicalAxis(0, 203, 1);
  assert.ok(Math.abs(input.sceneCameraMotion(camera)!.x - 0.05) < 1e-7, 'keyboard camera speed is five times its original mapped increment');
  input.setPhysicalAxis(0, 203, 0);
  assert.equal(input.physicalAxis(1, 0), 0.5, 'retain the first sample until the Java drag handler installs its mapping');
  for (const [axis, physical] of [[7, 0], [8, 1], [10, 2]])
    jvm.natives.invoke('java.io.Controller', 'user_Add', controller, [jv('int', axis), jv('int', 1), jv('int', physical),
      ...[-1, 1, -1, 1].map(n => jv('float', n))]);
  input.setPhysicalAxis(1, 0, 0.5); input.setPhysicalAxis(1, 1, -0.25); input.setPhysicalAxis(1, 2, 1);
  assert.equal(input.sceneCameraMotion(other), null);
  assert.deepEqual(input.sceneCameraMotion(camera), { x: 0.5, y: -0.25, zoom: 1 });
  assert.deepEqual(input.sceneCameraMotion(camera), { x: 0, y: 0, zoom: 0 });
  jvm.set(cursor, 'controlledcam', jv('GameRef', null));
  assert.equal(input.sceneCameraMotion(camera), null);
  resources.dispose();
});

test('destroyed RenderRefs notify the visual backend as removed before releasing the native handle', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const removed: number[] = [];
  const resources = new GameTypeNative(jvm, () => {}, undefined, undefined, undefined, undefined, undefined,
    node => { assert.equal(node.resourceType, 0); removed.push(node.id); });
  const ref = (className: string) => jv('ResourceRef', { className, fields: new Map() });
  const map = ref('java.util.resource.GroundRef'), render = ref('java.util.resource.RenderRef');
  jvm.natives.invoke('java.util.resource.ResourceRef', 'newNative', map, []);
  const node = resources.createRender(render, map, null, 'stuff')!;
  jvm.natives.invoke('java.util.resource.ResourceRef', 'destroy', render, []);
  jvm.natives.invoke('java.util.resource.ResourceRef', 'destroy', render, []);
  assert.deepEqual(removed, [node.id]); assert.equal(node.parent, null);
});
