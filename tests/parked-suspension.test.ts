import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineWorld, type PartDefinition } from '../src/engine/world';
import { parsePartConfig } from '../src/formats/cfg';
import { createWheelRefState } from '../src/runtime/wheel-ref-native';
import { resetParkedRunningGear, settleParkedSuspension } from '../src/engine/parked-suspension';
import { parkedSpringLength, suspensionAnchorLength } from '../src/engine/suspension-geometry';

const definition = (id: number, source: string): PartDefinition => ({
  key: { pack: 'test.rpk', id }, alias: String(id), cfgPath: `${id}.cfg`, config: parsePartConfig(source),
});

test('parked ride height follows installed Java springs and CFG mass rather than raw wheel slots', () => {
  const world = new EngineWorld();
  const mass = 1292, frontShare = 0.539, frontZ = -1.146, rearZ = 1.259;
  const centerZ = rearZ - frontShare * (rearZ - frontZ);
  const wheels = [[-0.67, frontZ], [0.67, frontZ], [-0.647, rearZ], [0.647, rearZ]];
  const root = world.create(definition(1, `body 0 0 ${centerZ} 0 0 0 ${mass} box 1 1 1\n` +
    wheels.map(([x, z], i) => `type 10 sphere 0.315\nspring 0.290 0.100 0.050\nwheel ${x} -0.630 ${z} 0 0 0 1 0 1 0\nslot 0 0 0 0 0 0 ${101+i}\nslottype ${101+i}`).join('\n')));
  for (let i = 0; i < 4; i++) {
    const part = world.create(definition(i + 2, 'slot 0 0 0 0 0 0 1'));
    world.install(root, 101 + i, part, 1);
    const state = createWheelRefState();
    state.force = 4.6 * 1000 * 9.81;
    const load = mass * (i < 2 ? frontShare : 1 - frontShare) / 2;
    // Original Spring.PositionedNPm2RestLength preloads the target ride length.
    state.restLength = 9.5 * 0.0254 + load * 9.81 / state.force;
    state.minLength = 7 * 0.0254; state.maxLength = 11.5 * 0.0254;
    world.wheelRefs.push(state);
    assert.ok(Math.abs(parkedSpringLength(state, load)! - 0.2413) < 1e-10);
  }
  assert.ok(settleParkedSuspension(root));
  const front = root.children.get(101)!;
  assert.ok(Math.abs(front.local.elements[13] - (-0.630 + 0.390 - 0.2413)) < 1e-10);
  const settled = front.local.clone();
  resetParkedRunningGear(root); settleParkedSuspension(root);
  assert.deepEqual(front.local, settled, 'settling is repeatable and does not ratchet the suspension each frame');
  root.wheelFrameOffsetY=.165;
  resetParkedRunningGear(root);settleParkedSuspension(root);
  assert.deepEqual(front.local,settled,'loaded native spring pose replaces the calibrated fallback height instead of adding another 16.5 cm');
  const last=world.wheelRefs[3];world.wheelRefs[3]=undefined;
  resetParkedRunningGear(root);assert.ok(settleParkedSuspension(root));
  assert.deepEqual(front.local,settled,'a missing fourth spring must not disable the other three corners');
  assert.ok(Math.abs(root.children.get(104)!.local.elements[13]-(-.630+.165))<1e-10);
  world.wheelRefs[3]=last;
  const anchor = suspensionAnchorLength(root.definition.config.wheels[0]);
  world.wheelRefs[0]!.restLength -= 0.02;
  resetParkedRunningGear(root); settleParkedSuspension(root);
  assert.ok(Math.abs(front.local.elements[13] - settled.elements[13] - 0.02) < 1e-10, 'shorter installed spring lowers the body relative to its wheel');
  assert.equal(suspensionAnchorLength(root.definition.config.wheels[0]), anchor, 'tuning cannot move the chassis anchor');
  world.dispose();
});
