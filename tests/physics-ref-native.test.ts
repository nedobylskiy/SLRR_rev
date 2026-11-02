import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlrrJvm, jv, type JavaValue } from 'slrr-jvm';
import { Vector3 } from 'three';
import { MapCollision } from '../src/engine/map-collision';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { PhysicsRefNative } from '../src/runtime/physics-ref-native';
import { OsdButtonNative } from '../src/runtime/osd-button-native';

const object = (className: string, values: Record<string, number> = {}) => jv(className.split('.').at(-1)!, {
  className, fields: new Map(Object.entries(values).map(([name, value]) => [name, jv('float', value)])),
});
const vector = (x: number, y: number, z: number) => object('java.lang.Vector3', { x, y, z });
const ypr = (y: number, p = 0, r = 0) => object('java.lang.Ypr', { y, p, r });

test('Java world createBox uses full dimensions, supports wheels and contacts, follows poses, and cleans up', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null }), resources = new GameTypeNative(jvm, () => {});
  const osd = new OsdButtonNative(jvm), physics = new PhysicsRefNative(jvm, resources); osd.setWorldPhysics(physics);
  const owner = 'java.util.resource.PhysicsRef';
  const call = (method: string, ref: JavaValue, ...args: JavaValue[]) => jvm.natives.invoke(owner, method, ref, args)!;
  const allocate = (className: string) => {
    const ref = object(className);
    jvm.natives.invoke('java.util.resource.ResourceRef', 'newNative', ref, []);
    return ref;
  };
  const map = allocate('java.util.resource.GroundRef'), otherMap = allocate('java.util.resource.GroundRef');
  const box = allocate(owner), other = allocate(owner);
  const collision = new MapCollision(), binding = physics.bindCollision(map, collision);
  call('createBox', box, jv('ResourceRef', map.value), jv('float', 2), jv('float', 0.05), jv('float', 5), jv('String', 'aknafedel'));
  call('setMatrix', box, vector(0, -0.035, 0), jv('Ypr', null));
  call('createBox', other, jv('ResourceRef', otherMap.value), jv('float', 10), jv('float', 10), jv('float', 10), jv('String', 'other'));
  assert.equal(collision.boxes, 1, 'another map must not leak into this collision world');
  assert.ok(Math.abs(collision.support(0, 0, 1)!.height + 0.01) < 1e-9);
  assert.equal(collision.support(1.1, 0, 1), undefined, 'Java width is full size, not half extent');
  assert.ok(collision.contact(new Vector3(0, -0.035, 0)));
  const snapshot = call('getPos', box); assert.equal(jvm.get(snapshot, 'y').value, -0.035);
  call('setMatrix', box, vector(-20, 2, -20), ypr(Math.PI / 2));
  assert.equal(jvm.get(snapshot, 'y').value, -0.035, 'getPos returns a copy');
  assert.equal(jvm.get(call('getOri', box), 'y').value, Math.PI / 2);
  assert.equal(collision.boxes, 1, 'moving a box replaces its spatial index entry');
  assert.equal(collision.support(0, 0, 1), undefined);
  assert.equal(collision.contact(new Vector3(0, -0.035, 0)), undefined);
  assert.ok(collision.support(-18, -20, 4), 'yaw rotates the 5 metre axis');
  assert.equal(collision.support(-20, -18, 4), undefined);
  call('setMatrix', box, jv('Vector3', null), jv('Ypr', null));
  assert.ok(collision.support(0, 0, 1));
  assert.equal(collision.support(-20, -20, 4), undefined);
  call('destroy', box); call('destroy', box);
  assert.equal(collision.boxes, 0);
  assert.equal(collision.support(0, 0, 1), undefined);
  assert.equal(resources.getResource(box), undefined);
  binding.dispose(); physics.dispose(); resources.dispose(); osd.dispose();
});

test('world boxes validate input, compose parent transforms and refresh parent ownership', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null }), resources = new GameTypeNative(jvm, () => {});
  const osd = new OsdButtonNative(jvm), physics = new PhysicsRefNative(jvm, resources); osd.setWorldPhysics(physics);
  const owner = 'java.util.resource.PhysicsRef', map = object('java.game.Scene'), box = object(owner);
  jvm.natives.invoke('java.lang.GameType', 'createNativeInstance', map, []);
  jvm.natives.invoke('java.util.resource.ResourceRef', 'newNative', box, []);
  const create = (width: number) => jvm.natives.invoke(owner, 'createBox', box,
    [jv('ResourceRef', map.value), jv('float', width), jv('float', 2), jv('float', 2), jv('String', 'box')]);
  assert.throws(() => create(NaN), /positive finite/); assert.throws(() => create(-1), /positive finite/);
  create(2);
  const node = resources.get(map)!; node.setMatrix({ x: 20, y: 3, z: -20 }, { y: 0, p: 0, r: 0 });
  const collision = new MapCollision(), binding = physics.bindCollision(map, collision);
  assert.equal(collision.support(20, -20, 10)?.height, 4);
  node.position.x = 40; binding.sync();
  assert.equal(collision.support(20, -20, 10), undefined);
  assert.equal(collision.support(40, -20, 10)?.height, 4);
  assert.throws(() => jvm.natives.invoke(owner, 'setMatrix', box, [vector(Infinity, 0, 0), ypr(0)]), /finite pose/);
  assert.equal(collision.support(40, -20, 10)?.height, 4, 'a rejected pose leaves the old collider intact');
  jvm.natives.invoke('java.util.resource.ResourceRef', 'destroy', box, []); binding.sync();
  assert.equal(collision.boxes, 0, 'base ResourceRef cleanup is detected too');
  binding.dispose(); binding.dispose(); physics.dispose(); resources.dispose(); osd.dispose();
});
