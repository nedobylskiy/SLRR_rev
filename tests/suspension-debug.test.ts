import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { EngineWorld, type PartDefinition } from '../src/engine/world';
import { parsePartConfig } from '../src/formats/cfg';
import { defaultSuspensionDebug, suspensionDebugMatrix, rearArmAdjustment } from '../src/render/suspension-debug';

test('rear arm controls are independent and mirror translation and rotation across X', () => {
  const settings = defaultSuspensionDebug();
  settings.rearLeftArmOffset = settings.rearRightArmOffset = [0.1, 0.2, 0.3];
  settings.rearLeftArmRotation = settings.rearRightArmRotation = [10, 20, 30];
  assert.deepEqual(rearArmAdjustment(settings, 2), { offset: [-0.1, 0.2, 0.3], rotation: [10, -20, -30] });
  assert.deepEqual(rearArmAdjustment(settings, 3), { offset: [0.1, 0.2, 0.3], rotation: [10, 20, 30] });
  settings.rearLeftArmOffset = [0.4, 0, 0];
  assert.deepEqual(rearArmAdjustment(settings, 3).offset, [0.1, 0.2, 0.3]);
});

test('visual suspension tuning moves independent wheel and hub branches, inherits to children and leaves native poses unchanged', () => {
  const definition = (id: number, cfg: string): PartDefinition => ({ key: { pack: 'test.rpk', id }, alias: String(id), cfgPath: '', config: parsePartConfig('wheel 0 0 0 0 0 0 0 0 1 1\n'.repeat(4) + cfg) });
  const world = new EngineWorld();
  const root = world.create(definition(1, 'slot -1 0 2 0 0 0 123\nslottype 203\nslot -1 0 2 0 0 0 103\nslottype 103\nslot -1 0 -2 0 0 0 101\nslottype 101'));
  const hub = world.create(definition(2, 'slot 0 0 0 0 0 0 1\nslot 0 1 0 0 0 0 2'));
  const wheel = world.create(definition(3, 'slot 0 0 0 0 0 0 1'));
  const front = world.create(definition(4, 'slot 0 0 0 0 0 0 1'));
  const child = world.create(definition(5, 'slot 0 0 0 0 0 0 1'));
  world.install(root, 123, hub, 1); world.install(root, 103, wheel, 1);
  world.install(root, 101, front, 1); world.install(hub, 2, child, 1);
  const base = child.matrix().clone(), settings = defaultSuspensionDebug();
  assert.deepEqual(suspensionDebugMatrix(child, settings).elements, base.elements);
  settings.rearOffset = [0, 0.2, 0]; settings.rearRotation = [0, 0, 90];
  const position = (part: typeof hub) => new Vector3().setFromMatrixPosition(suspensionDebugMatrix(part, settings));
  assert.ok(position(wheel).distanceTo(new Vector3(-1, 0.2, 2)) < 1e-9);
  assert.ok(position(hub).distanceTo(position(wheel)) < 1e-9);
  assert.ok(position(child).distanceTo(new Vector3(-1, 1.2, 2)) < 1e-9, 'arm-only rotation must not rotate the wheel/hub branch');
  assert.ok(position(front).distanceTo(new Vector3(-1, 0, -2)) < 1e-9);
  assert.deepEqual(child.matrix().elements, base.elements);
});

