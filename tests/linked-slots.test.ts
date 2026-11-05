import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Matrix4, Vector3 } from 'three';
import { applyDisplaySteering } from '../src/engine/display-steering';
import { EngineWorld, type PartDefinition } from '../src/engine/world';
import { parsePartConfig } from '../src/formats/cfg';
import { linkedMountGroup, linkedSlotFrame, selectLinkedRule } from '../src/engine/linked-slots';
import { linkedRenderPose } from '../src/engine/linked-render';

const definition = (id: number, cfg: string): PartDefinition => ({ key: { pack: 'test.rpk', id }, alias: String(id), cfgPath: '',
  config: parsePartConfig('wheel 0 0 0 0 0 0 0 0 1 1\n'.repeat(4) + cfg) });

test('linker inherits root WheelRef group, searches self before parents and applies single-anchor orientation', () => {
  const world = new EngineWorld();
  const root = world.create(definition(1, 'slot 0 0 0 0 0 0 123\nslottype 203\nslot 1 2 3 1.5707963267948966 0 0 553'));
  const hub = world.create(definition(2, 'slot 0 0 0 0 0 0 1\nslot 0 0 0 0 0 0 8'));
  const child = world.create(definition(3, 'slot 0 0 0 0 0 0 1'));
  world.install(root, 123, hub, 1); world.install(hub, 8, child, 1);
  assert.equal(linkedMountGroup(child), 2);
  const pose = linkedRenderPose(child, [551], new Box3())!;
  assert.ok(new Vector3().setFromMatrixPosition(pose).distanceTo(new Vector3(1, 2, 3)) < 1e-9);
  assert.ok(new Vector3(0, 0, 1).transformDirection(pose).distanceTo(new Vector3(1, 0, 0)) < 1e-9);
  child.definition.config.slots.push({ id: 553, position: [4, 5, 6], rotation: [0, 0, 0], attach: [], compatible: [] });
  assert.ok(new Vector3().setFromMatrixPosition(linkedSlotFrame(child, 551)!).distanceTo(new Vector3(4, 5, 6)) < 1e-9);
  assert.equal(linkedSlotFrame(child, 999), undefined);
});

test('linked control arms keep their chassis plane while spring seats steer, and still follow suspension travel', () => {
  const world = new EngineWorld();
  const root = world.create(definition(1, `maxsteer 0.6 2.7
slot 0 0 0 0 0 0 101
slottype 101
slot 0.1 0 0 0 0 0 121
slottype 201
slot 0.3 0 0 0 0 0 311
slottype 301
slot -0.5 -0.2 0.2 0 0 0 351
slottype 301`));
  root.definition.config.wheels[0].parameters[0]=1;
  root.wheelFrameOffsetY=0.165;root.wheelFrameOffsets=[[0.055,0,0]];
  const strut = world.create(definition(2,'slot 0 0 0 0 0 0 1'));
  const spring = world.create(definition(3,'slot 0 -0.4 0 0 0 0 1'));
  world.install(root,121,strut,1);world.install(root,311,spring,1);
  const armFrame = () => strut.matrix().multiply(linkedRenderPose(strut,[351],new Box3())!);
  const near = (a:Matrix4,b:Matrix4) => a.elements.every((value,i)=>Math.abs(value-b.elements[i])<1e-9);
  const arm = armFrame(), neutralSpring = spring.local.clone();
  for (const input of [-1,-0.5,0.5,1,1,0]) {
    applyDisplaySteering(root,input);
    assert.ok(near(armFrame(),arm),`control arm cannot yaw with the spring at ${input}`);
    if(input) assert.ok(!near(spring.local,neutralSpring),'the spring must continue steering');
  }
  applyDisplaySteering(root,0.7);
  const travel = new Matrix4().makeTranslation(0,0.08,0);
  // Physical sync applies steering after travel in parent coordinates.
  spring.local.copy(spring.steeringTransform).multiply(travel).multiply(neutralSpring);
  assert.ok(near(armFrame(),travel.clone().multiply(arm)),'removing steering must retain vertical travel');
  world.refreshAttachment(spring);
  assert.ok(near(spring.steeringTransform,new Matrix4()),'attachment refresh clears stale steering metadata');
  world.dispose();
});

test('CFG retains ordered linked alternatives and selects the parent attachment slot, not the own slot', () => {
  const world = new EngineWorld();
  const root = world.create(definition(1, 'slot 0 0 0 0 0 0 123\nslottype 203'));
  const part = world.create(definition(2, 'render 0x134\nlinked 551 0 2\nlinked 531 541 123\nlinked 561 571\nslot 0 0 0 0 0 0 1'));
  world.install(root, 123, part, 1);
  const rules = part.definition.config.renders[0].linkRules!;
  assert.equal(rules.length, 3);
  assert.deepEqual(selectLinkedRule(part, rules), [531, 541, 123]);
  assert.equal(linkedRenderPose(part, [551, 0, 2], new Box3()), undefined);
  assert.deepEqual(selectLinkedRule(part, [[1, 2], [3, 4, 123]]), [1, 2], 'first matching rule wins');
});

