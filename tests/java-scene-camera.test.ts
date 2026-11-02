import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv } from 'slrr-jvm';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { ResourceCatalog } from '../src/runtime/resource-catalog';
import { javaSceneCamera } from '../src/runtime/java-scene-camera';
import type { BootResult } from '../src/runtime/game-boot';

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
  await command('hide 123'); assert.equal(javaSceneCamera(result), null);
  await command('render 123 0 0 1 3'); assert.ok(javaSceneCamera(result));
  const track = jvm.construct('java.game.Track', []); jvm.set(jv('class', 'java.game.GameLogic'), 'actualState', track);
  assert.equal(javaSceneCamera(result), null, 'driving cameras retain their existing path');
  jvm.set(jv('class', 'java.game.GameLogic'), 'actualState', state);
  jvm.natives.invoke('java.util.resource.ResourceRef', 'destroy', cam, []);
  assert.equal(javaSceneCamera(result), null);
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
