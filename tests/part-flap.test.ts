import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Matrix4, Vector3 } from 'three';
import { SlrrJvm, jv } from 'slrr-jvm';
import { parsePartConfig } from '../src/formats/cfg';
import { EngineWorld } from '../src/engine/world';
import { advancePartFlap } from '../src/engine/part-flap';
import { GameTypeNative } from '../src/runtime/game-type-native';
import { PartNative } from '../src/runtime/part-native';

test('CFG hinge moves the whole door assembly around its pivot and closes back to its exact mount', () => {
  const world = new EngineWorld();
  const make = (id: number, cfg: string) => world.create({ key: { pack: 'car.rpk', id }, alias: 'part', cfgPath: 'part.cfg', config: parsePartConfig(cfg) });
  const root = make(1, 'slot 0 0 0 0 0 0 10\nflap 1 0 0 0 2 0 0 0 1 0 1.5707963267948966');
  const door = make(2, 'slot 0 0 0 0 0 0 1'), glass = make(3, '');
  world.install(root, 10, door, 1);
  glass.parent = door; glass.local.makeTranslation(2, 1, 0);
  const closed = door.local.clone();
  for (let i = 0; i < 30; i++) advancePartFlap(door, true, 1 / 60);
  const pivot = new Vector3(1, 0, 0).applyMatrix4(door.matrix());
  assert.ok(pivot.distanceTo(new Vector3(1, 0, 0)) < 1e-8, 'hinge pivot stays fixed');
  assert.ok(new Vector3().setFromMatrixPosition(glass.matrix()).distanceTo(new Vector3(1, 1, -1)) < 1e-8);
  assert.deepEqual(door.local.elements, closed.elements, 'closed attachment is never overwritten');
  for (let i = 0; i < 31; i++) advancePartFlap(door, false, 1 / 60);
  assert.equal(door.flapTransform, undefined);
  assert.deepEqual(door.matrix().elements, closed.elements);
  advancePartFlap(door, true, .1);
  world.detach(door);
  const detached = door.local.clone();
  advancePartFlap(door, true, .1);
  assert.deepEqual(door.matrix().elements, detached.elements, 'detached parts no longer animate on the former hinge');
  world.dispose();
});

test('ordinary parts cannot open, and a paused render does not snap a hinge to its endpoint', () => {
  const world = new EngineWorld();
  const config = parsePartConfig('slot 0 0 0 0 0 0 10\nflap 0 0 0 1 0 0 0 0 1 0 1');
  const root = world.create({key:{pack:'car.rpk',id:1},alias:'root',cfgPath:'root.cfg',config});
  const door = world.create({key:{pack:'car.rpk',id:2},alias:'door',cfgPath:'door.cfg',config:parsePartConfig('slot 0 0 0 0 0 0 1')});
  world.install(root,10,door,1);
  assert.equal(advancePartFlap(root,true,1),false);
  advancePartFlap(door,true,60);
  const angle = Math.acos(door.flapTransform!.elements[5]);
  assert.ok(angle > 0 && angle < 1, 'long frame is capped');
  assert.equal(advancePartFlap(door,true,0),false);
  assert.ok(!door.matrix().equals(new Matrix4()));
  world.dispose();
});

test('original command and Part.flap native share state through GameRef aliases', async () => {
  const jvm = new SlrrJvm({resolveImport:()=>null});
  const types = new GameTypeNative(jvm,()=>{}), parts = new PartNative(jvm,types);
  const ref = jv('GameRef',{className:'java.util.resource.GameRef',fields:new Map()});
  jvm.natives.invoke('java.lang.GameType','createNativeInstance',ref,[]);
  const node = types.getResource(ref)!;
  const read = () => jvm.natives.invoke('java.game.parts.Part','flap',ref,[jv('int',0)])!.value;
  try {
    assert.equal(read(),0);
    await jvm.natives.invokeAsync('java.util.resource.GameRef','queueEvent',ref,[jv('ResourceRef',ref.value),jv('int',16),jv('String','flap_toggle')]);
    assert.equal(read(),1); assert.equal(parts.flapOpen(node.resourceId),true);
    assert.equal(jvm.natives.invoke('java.game.parts.Part','flap',ref,[jv('int',1)])!.value,0);
    assert.equal(parts.flapOpen(node.resourceId),false);
  } finally { types.dispose(); }
});
