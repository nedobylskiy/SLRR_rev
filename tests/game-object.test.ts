import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jv, SlrrJvm, type JavaValue } from 'slrr-jvm';
import { GameObject } from '../src/runtime/game-object';
import { GameTypeNative } from '../src/runtime/game-type-native';

const ref = (name: string): JavaValue => jv(name, { className: name, fields: new Map() });
const vector = (x: number, y: number, z: number) => jv('Vector3', { className: 'java.lang.Vector3', fields: new Map([
  ['x', jv('float', x)], ['y', jv('float', y)], ['z', jv('float', z)],
]) });
const orientation = (y: number, p: number, r: number) => jv('Ypr', { className: 'java.lang.Ypr', fields: new Map([
  ['y', jv('float', y)], ['p', jv('float', p)], ['r', jv('float', r)],
]) });

test('game objects form a guarded tree and retain flags, pose, velocity, and queued events', () => {
  const root = new GameObject(1, 'java.game.Scene', 10, null, 'scene');
  const car = new GameObject(2, 'java.game.Vehicle', 20, 'stock', 'car');
  root.resourceId = 1;
  car.resourceId = 2;
  car.setParent(root);
  assert.equal(car.parentId, 1);
  assert.ok(root.children.has(car));
  assert.throws(() => root.setParent(car), /parent cycle/);
  car.setFlags(0x10 | 0x40);
  car.clearFlags(0x40);
  assert.equal(car.flags, 0x10);
  assert.equal(car.worldTreeRoot, true);
  car.setState({ x: 1, y: 2, z: 3 }, { y: 4, p: 5, r: 6 }, { x: 7, y: 8, z: 9 }, { x: 10, y: 11, z: 12 });
  assert.deepEqual(car.velocity, { x: 7, y: 8, z: 9 });
  car.setMatrix({ x: 5, y: 0, z: 0 }, { y: 0, p: 0, r: 0 });
  assert.deepEqual(car.velocity, { x: 0, y: 0, z: 0 });
  car.queueEvent({ sourceId: 1, type: 16, payload: 'start' });
  assert.deepEqual(car.events, [{ sourceId: 1, type: 16, payload: 'start' }]);
  car.setEventMask(0x80);
  car.setEventMask(0x10000);
  assert.equal(car.acceptsEvent(0x80), true);
  car.clearEventMask(0x80);
  assert.equal(car.acceptsEvent(0x80), false);
  assert.equal(car.acceptsEvent(0x10000), true);
  assert.equal(car.events.length, 1);
  car.requestActiveCollision(); car.requestActiveCollision();
  assert.equal(car.collisionActivationQueued, true);
  assert.ok(car.flags & 0x10000000);
  assert.equal(car.consumeCollisionActivation(), true);
  assert.equal(car.collisionEnabled, true);
  assert.equal(car.flags & 0x10000000, 0);
  assert.equal(car.consumeCollisionActivation(), false);
});

test('GameRef native calls update the same object created by GameType', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const host = new GameTypeNative(jvm, () => {});
  const root = ref('java.game.Scene'), child = ref('java.game.Vehicle');
  const native = (owner: string, method: string, receiver: JavaValue, args: JavaValue[] = []) => {
    const result = jvm.natives.invoke(owner, method, receiver, args);
    assert.ok(result, `${owner}.${method}`);
    return result;
  };
  native('java.lang.GameType', 'createNativeInstance', root);
  native('java.lang.GameType', 'createNativeInstance', child,
    [jv('GameRef', root.value), jv('int', 42), jv('String', '1,2,3'), jv('String', 'player car')]);
  assert.equal(host.get(child)?.parentId, host.get(root)?.resourceId);
  const byId = ref('java.util.resource.GameRef');
  native('java.util.resource.ResourceRef', 'set', byId, [jv('int', host.get(child)!.resourceId)]);
  assert.equal(host.getResource(byId), host.get(child));
  const copied = ref('java.util.resource.GameRef');
  native('java.util.resource.ResourceRef', 'set', copied, [jv('ResourceRef', byId.value)]);
  assert.equal(host.getResource(copied), host.get(child));
  assert.equal(host.getById(2)?.alias, 'player car');
  assert.equal(host.roots().length, 1);
  native('java.util.resource.GameRef', 'setFlags', child, [jv('int', 0x10)]);
  assert.equal(native('java.util.resource.GameRef', 'getFlags', child).value, 0x10);
  native('java.util.resource.GameRef', 'setState', child,
    [vector(1, 2, 3), orientation(4, 5, 6), vector(7, 8, 9), vector(10, 11, 12)]);
  assert.equal(jvm.get(native('java.util.resource.GameRef', 'getPos', child), 'x').value, 1);
  assert.equal(jvm.get(native('java.util.resource.GameRef', 'getVel', child), 'z').value, 9);
  const out = vector(0, 0, 0);
  assert.equal(native('java.util.resource.GameRef', 'getPos', child, [out]).value, out.value);
  assert.equal(jvm.get(out, 'y').value, 2);
  native('java.util.resource.GameRef', 'queueEvent', child, [jv('ResourceRef', root.value), jv('int', 16), jv('String', 'start')]);
  assert.deepEqual(host.get(child)?.events, [{ sourceId: 1, type: 16, payload: 'start' }]);
  native('java.util.resource.GameRef', 'setActiveCollision', child);
  assert.equal(host.get(child)?.collisionActivationQueued, true);
  native('java.lang.GameType', 'setEventMask', child, [jv('int', 0x10000)]);
  native('java.lang.GameType', 'setEventMask', child, [jv('int', 0x80)]);
  assert.equal(host.get(child)?.eventMask, 0x10080);
  native('java.lang.GameType', 'clearEventMask', child, [jv('int', 0x80)]);
  assert.equal(host.get(child)?.eventMask, 0x10000);
});

test('GroundRef(int) binds the map resource to a game object for Track commands', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const host = new GameTypeNative(jvm, () => {});
  const ground = ref('java.util.resource.GroundRef');
  jvm.natives.invoke('java.util.resource.ResourceRef', 'newNative', ground, []);
  jvm.natives.invoke('java.util.resource.ResourceRef', 'set', ground, [jv('int', 0x1234)]);
  assert.equal(host.get(ground)?.resourceId, 0x1234);
  assert.equal(jvm.natives.invoke('java.util.resource.ResourceRef', 'id', ground, [])?.value, 0x1234);
  jvm.natives.invoke('java.util.resource.GameRef', 'queueEvent', ground,
    [jv('ResourceRef', null), jv('int', 16), jv('String', 'obs_rem 42')]);
  assert.deepEqual(host.get(ground)?.events, [{ sourceId: null, type: 16, payload: 'obs_rem 42' }]);
  const generic = ref('java.util.resource.GameRef');
  jvm.natives.invoke('java.util.resource.ResourceRef', 'newNative', generic, []);
  jvm.natives.invoke('java.util.resource.ResourceRef', 'set', generic, [jv('int', 0x5678)]);
  assert.equal(host.get(generic), undefined);
});

test('destroy tolerates an uninitialized render reference after a partial Track.enter', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  new GameTypeNative(jvm, () => {});
  assert.equal(jvm.natives.invoke('java.util.resource.ResourceRef', 'destroy',
    jv('RenderRef', null), [])?.type, 'void');
  assert.throws(() => jvm.natives.invoke('java.util.resource.ResourceRef', 'destroy',
    jv('RenderRef', { id: 1 }), []), /not a Java object/);
});

test('GameRef.create uses its last string argument as the tree alias', async () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const host = new GameTypeNative(jvm, () => {});
  const resource = jv('GameRef', { className: 'java.util.resource.GameRef', fields: new Map([['typeID', jv('int', 27)]]) });
  const receiver = ref('java.util.resource.GameRef');
  const created = await jvm.natives.invokeAsync('java.util.resource.GameRef', 'create', receiver,
    [jv('GameRef', null), resource, jv('String', '0,0,0'), jv('String', 'menu scene')]);
  assert.equal(created?.value, receiver.value);
  assert.equal(host.get(receiver)?.typeId, 27);
  assert.equal(host.get(receiver)?.params, '0,0,0');
  assert.equal(host.get(receiver)?.alias, 'menu scene');
});

test('ResourceRef owns the tree before a GameRef gains game state', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const host = new GameTypeNative(jvm, () => {});
  const parent = ref('java.util.resource.ResourceRef');
  const child = ref('java.util.resource.GameRef');
  const call = (owner: string, method: string, receiver: JavaValue, args: JavaValue[] = []) => {
    const result = jvm.natives.invoke(owner, method, receiver, args);
    assert.ok(result);
    return result;
  };
  call('java.util.resource.ResourceRef', 'newNative', parent);
  call('java.util.resource.ResourceRef', 'newNative', child);
  call('java.util.resource.ResourceRef', 'set', child, [jv('int', 0x32)]);
  const parentNode = host.getResource(parent)!, childNode = host.getResource(child)!;
  assert.equal(childNode.typeId, 0x32);
  assert.equal(call('java.util.resource.ResourceRef', 'id', child).value, 0x32);
  assert.equal(call('java.util.resource.ResourceRef', 'id', parent).value, 0);
  assert.equal(host.get(child), undefined);
  childNode.setParent(parentNode);
  assert.equal(call('java.util.resource.ResourceRef', 'getParentID', child).value, 0);
  assert.equal(call('java.util.resource.ResourceRef', 'getFirstChild', parent).value, child.value);
  call('java.lang.GameType', 'createNativeInstance', child,
    [jv('GameRef', parent.value), jv('int', 0x32), jv('String', null), jv('String', 'controller')]);
  assert.equal(host.get(child)?.id, childNode.id);
  assert.equal(host.get(child)?.parentId, 0);
  assert.equal(call('java.util.resource.ResourceRef', 'getWTRoot', child).value, null);
});

test('ResourceRef keeps its resource ID separate from the host object ID', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const host = new GameTypeNative(jvm, () => {});
  const handle = ref('java.util.resource.ResourceRef');
  jvm.natives.invoke('java.util.resource.ResourceRef', 'newNative', handle, []);
  assert.equal(jvm.natives.invoke('java.util.resource.ResourceRef', 'id', handle, [])?.value, 0);
  jvm.natives.invoke('java.util.resource.ResourceRef', 'set', handle,
    [jv('ResourceRef', { pack: 'frontend', id: 1003 })]);
  assert.equal(jvm.natives.invoke('java.util.resource.ResourceRef', 'id', handle, [])?.value, 1003);
  assert.notEqual(host.getResource(handle)?.id, 1003);
  jvm.natives.invoke('java.util.resource.ResourceRef', 'set', handle, [jv('ResourceRef', null)]);
  assert.equal(jvm.natives.invoke('java.util.resource.ResourceRef', 'id', handle, [])?.value, 0);
});

test('ResourceRef.duplicate copies a resource binding into a separate tree node', () => {
  const jvm = new SlrrJvm({ resolveImport: () => null });
  const host = new GameTypeNative(jvm, () => {});
  const parent = ref('java.util.resource.ResourceRef');
  const source = ref('java.util.resource.RenderRef');
  const target = ref('java.util.resource.RenderRef');
  for (const item of [parent, source, target]) jvm.natives.invoke('java.util.resource.ResourceRef', 'newNative', item, []);
  jvm.natives.invoke('java.util.resource.ResourceRef', 'set', source, [jv('int', 0xd7)]);
  host.getResource(source)!.setParent(host.getResource(parent)!);
  jvm.natives.invoke('java.util.resource.ResourceRef', 'duplicate', target, [jv('ResourceRef', source.value)]);
  const copy = host.getResource(target)!;
  assert.notEqual(copy.id, host.getResource(source)?.id);
  assert.equal(copy.parent, host.getResource(parent));
  assert.equal(copy.copiedFromResourceId, 0xd7);
  assert.notEqual(copy.resourceId, 0xd7);
  assert.equal(host.getResource(source)?.resourceId, 0xd7);
  const texture = ref('java.util.resource.ResourceRef');
  jvm.natives.invoke('java.util.resource.ResourceRef', 'newNative', texture, []);
  jvm.natives.invoke('java.util.resource.ResourceRef', 'set', texture, [jv('int', 0xaf)]);
  jvm.natives.invoke('java.util.resource.RenderRef', 'changeResource', target,
    [jv('ResourceRef', source.value), jv('ResourceRef', texture.value)]);
  assert.equal(copy.resourceReplacements.get(0xd7), 0xaf);
  jvm.natives.invoke('java.util.resource.ResourceRef', 'scaleMesh', target,
    [jv('float', 2), jv('float', 3), jv('float', 1)]);
  assert.deepEqual(copy.meshScale, { x: 2, y: 3, z: 1 });
  assert.deepEqual(host.getResource(source)?.meshScale, { x: 1, y: 1, z: 1 });
});
