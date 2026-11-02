import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TIRE_MODEL, magicFormula, tireForces } from '../src/engine/tire-model';

test('Magic Formula tuning changes the peak force and remains finite at standstill', () => {
  const settings = structuredClone(DEFAULT_TIRE_MODEL);
  const baseline = tireForces(4000, 1, 2, 0, 0, 2, settings);
  settings.longitudinal.D *= 0.5;
  const reduced = tireForces(4000, 1, 2, 0, 0, 2, settings);
  assert.ok(reduced.longitudinal > 0 && reduced.longitudinal < baseline.longitudinal);
  assert.ok(Number.isFinite(tireForces(4000, 1, 0, 0, 0, 0, settings).lateral));
  assert.equal(magicFormula(0, settings.longitudinal), 0);
});

test('turning consumes longitudinal grip in Pacejka mode', () => {
  const straight = tireForces(4000, 1, 3, 0, 15, 18, DEFAULT_TIRE_MODEL);
  const turning = tireForces(4000, 1, 3, 2, 15, 18, DEFAULT_TIRE_MODEL);
  assert.ok(turning.lateral < 0);
  assert.ok(turning.longitudinal < straight.longitudinal);
});
