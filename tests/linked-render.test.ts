import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Matrix4, Vector3 } from 'three';
import { EngineWorld, type PartDefinition } from '../src/engine/world';
import { parsePartConfig } from '../src/formats/cfg';
import { linkedRenderPose } from '../src/engine/linked-render';

const definition = (id: number, source: string): PartDefinition => ({
  key: { pack: 'test.rpk', id }, alias: String(id), cfgPath: `${id}.cfg`, config: parsePartConfig(source),
});

test('trailing arm retains each render link and places its CV shaft between hub and chassis', () => {
  const world = new EngineWorld();
  const root = world.create(definition(1, `
slot -0.147 -0.536 1.244 0 0 0 543
wheel -0.647 -0.660 1.259 0 0 0 0 0 1 1
wheel 0.647 -0.660 1.259 0 0 0 0 0 1 1
wheel -0.647 -0.660 1.259 0 0 0 0 0 1 1
slot 0 0 0 0 0 0 123
slottype 203
slot 0.118 0 0 0 0 0 533
slottype 203`));
  const part = world.create(definition(2, `render 0x116
render 0x134
linked 551
render 0x143
linked 531 541
slot 0 0 0 0 0 0 1`));
  assert.equal(part.definition.config.renders[0].links, undefined);
  assert.deepEqual(part.definition.config.renders[1].links, [551]);
  assert.deepEqual(part.definition.config.renders[2].links, [531, 541]);
  world.install(root, 123, part, 1);
  const bounds = new Box3(new Vector3(-0.06, 0, -0.06), new Vector3(0.06, 0.3884848, 0.06));
  const endPoints = () => {
    const pose = linkedRenderPose(part, [531, 541], bounds)!;
    return [0, bounds.max.y].map(y => new Vector3(0, y, 0).applyMatrix4(pose).applyMatrix4(part.local));
  };
  let [hub, chassis] = endPoints();
  assert.ok(hub.distanceTo(new Vector3(-0.529, -0.660, 1.259)) < 1e-9);
  assert.ok(chassis.distanceTo(new Vector3(-0.147, -0.536, 1.244)) < 1e-9);
  assert.ok(Math.abs(chassis.x - hub.x) > Math.abs(chassis.y - hub.y), 'shaft extends across the axle, not vertically above the tire');
  part.local.premultiply(new Matrix4().makeTranslation(0, 0.1, 0));
  [hub, chassis] = endPoints();
  assert.ok(hub.distanceTo(new Vector3(-0.529, -0.560, 1.259)) < 1e-9, 'hub endpoint follows suspension travel');
  assert.ok(chassis.distanceTo(new Vector3(-0.147, -0.536, 1.244)) < 1e-9, 'chassis endpoint stays fixed');
  world.dispose();
});
