import assert from 'node:assert/strict';
import test from 'node:test';
import { JavaNativeRegistry, jv } from 'slrr-jvm';
import { DEFAULT_TIRE_MODEL, tireForces } from '../src/engine/tire-model';
import { executeTyreSource } from '../src/runtime/tyre-java';
import { callWheelRefNative, createWheelRefState, registerWheelRefNatives } from '../src/runtime/wheel-ref-native';

test('WheelRef native setters retain original slots and ignore invalid indices', () => {
  const registry = new JavaNativeRegistry(); registerWheelRefNatives(registry);
  const state = createWheelRefState(), receiver = jv('WheelRef', state);
  callWheelRefNative(registry, receiver, 'setPacejka', [jv('int', 8), jv('float', -1)]);
  callWheelRefNative(registry, receiver, 'setFriction', [jv('float', 1.8)]);
  assert.equal(state.pacejka[8], -1);
  assert.equal(state.pacejka[2], 1.8);
  callWheelRefNative(registry, receiver, 'setPacejka', [jv('int', 2), jv('float', 2)]);
  assert.equal(state.friction, 2);
  callWheelRefNative(registry, receiver, 'setPacejka', [jv('int', 17), jv('float', 1)]);
  assert.equal(state.pacejka.length, 17);
});

test('original Java tyre calculations feed each wheel and change tire forces', () => {
  const source = `public class Tyre {
    int[] render_types = new int[2];
    float friction = 1.0;
    float stiffness = 10.0;
    public void SetupTyre(float w, float p, float r, float rw, int compound, float inflation) {
      friction = 1.76863 * compound;
      stiffness = 17.6839 * inflation;
      SetupRubber(compound);
      SetInflation(inflation);
    }
    public void SetupRubber(int compound) { friction = friction + 0.0; }
    public void SetInflation(float inflation) {
      WheelRef wheel = getWheel();
      wheel.setFriction(friction);
      wheel.setStiffness(stiffness);
      wheel.setSliction(0.814);
      wheel.setFrictn_x(1.0);
      wheel.setRadius(0.32865);
    }
  }`;
  const stock = executeTyreSource(source, [205, 55, 17, 8, 1, 1], 0);
  const grippy = executeTyreSource(source, [205, 55, 17, 8, 2, 1], 1);
  const a = tireForces(3600, 1, 3, 3, 10, 13, DEFAULT_TIRE_MODEL, stock);
  const b = tireForces(3600, 1, 3, 3, 10, 13, DEFAULT_TIRE_MODEL, grippy);
  assert.ok(Math.abs(b.lateral) > Math.abs(a.lateral));
  const aStraight = tireForces(3600, 1, 3, 0, 10, 13, DEFAULT_TIRE_MODEL, stock);
  const bStraight = tireForces(3600, 1, 3, 0, 10, 13, DEFAULT_TIRE_MODEL, grippy);
  assert.ok(bStraight.longitudinal > aStraight.longitudinal);
  const subclass = 'public class custom_tyre extends Tyre { public custom_tyre(int id) { render_types[0] = parts.wheels:0x00000058r; SetupTyre(205.0, 55.0, 17.0, 8.0, 2, 1.0); } }';
  assert.equal(executeTyreSource(source, subclass, 2).friction, grippy.friction);
});
