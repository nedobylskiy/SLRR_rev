import assert from 'node:assert/strict';
import test from 'node:test';
import { sl2PacejkaForce, type Sl2PacejkaCoefficients } from '../src/engine/sl2-pacejka';

const tyre: Sl2PacejkaCoefficients = [0.814, 0, 1.76863, 0, 17.6839, 0, 0, 0, -1, 0, 0];
const zeroShape: Sl2PacejkaCoefficients = [0, 0, 1.76863, 0, 17.6839, 0, 0, 0, -1, 0, 0];

test('recovered SL2 leaf formula uses load, slip and the non-negative variant', () => {
  assert.equal(sl2PacejkaForce(tyre, 0, 3500), 0);
  assert.ok(Math.abs(sl2PacejkaForce(tyre, 0.1, 3500) - 4512.310131513881) < 1e-8);
  assert.ok(sl2PacejkaForce(tyre, 0.1, 4500) > sl2PacejkaForce(tyre, 0.1, 3500));
  assert.ok(sl2PacejkaForce(tyre, -0.1, 3500) < 0);
  assert.equal(sl2PacejkaForce(tyre, -0.1, 3500, true), 0);
  assert.equal(sl2PacejkaForce(zeroShape, 0.1, 3500), 0);
});
