import test from 'node:test';
import assert from 'node:assert/strict';
import { DeformablePanel } from '../src/engine/deformable-panel';
import { Matrix4 } from 'three';

const samples = [-0.7, 1.3, -0.7, 0.7, 1.3, -0.7, -0.7, 1.3, 0.7, 0.7, 1.3, 0.7, 0, 1.35, 0];
const create = () => new DeformablePanel(samples, { mass: 38.5, mount: [0, 1.3, 0.7] });
const run = (p: DeformablePanel, seconds: number) => { for (let i = 0; i < seconds * 240; i++) p.advance(1 / 240); };

test('panel skin reproduces original vertices and follows a rigid transform', () => {
  const p = create(), bindings = samples.filter((_, i) => i % 3 === 0).map((_, i) => p.bind(samples.slice(i * 3, i * 3 + 3)));
  const out = new Float64Array(samples.length);
  bindings.forEach((b, i) => p.skin(b, out, i * 3));
  out.forEach((v, i) => assert.ok(Math.abs(v - samples[i]) < 1e-12));
  for (let i = 0; i < p.positions.length; i += 3) { const x = p.positions[i], z = p.positions[i + 2]; p.positions[i] = z + 2; p.positions[i + 1] += 3; p.positions[i + 2] = -x + 4; }
  bindings.forEach((b, i) => p.skin(b, out, i * 3));
  for (let i = 0; i < samples.length; i += 3) { assert.ok(Math.abs(out[i] - samples[i + 2] - 2) < 1e-12); assert.ok(Math.abs(out[i + 1] - samples[i + 1] - 3) < 1e-12); assert.ok(Math.abs(out[i + 2] + samples[i] - 4) < 1e-12); }
});

test('impact supplies momentum, does not directly tear mounts; overload falls and reset repairs it', () => {
  const p = create(); p.hit(650);
  const momentum = [0, 0, 0];
  for (let i = 0; i < p.velocities.length; i++) momentum[i % 3] += p.velocities[i] * p.options.mass / (p.velocities.length / 3);
  assert.ok(Math.abs(Math.hypot(...momentum) - 650) < 1e-9);
  assert.ok(p.mounts.every(m => !m.broken));
  for (let i = 0; i < 3 * 240; i++) {
    p.advance(1 / 240);
    const intact = p.mounts.filter(m => !m.broken).length;
    assert.ok(intact === 0 || intact === p.mounts.length, 'a panel cannot hang from only some clamps');
  }
  assert.equal(p.attached, false); assert.ok(p.plasticBeams > 0);
  for (let i = 0; i < p.positions.length; i++) { assert.ok(Number.isFinite(p.positions[i])); if (i % 3 === 1) assert.ok(p.positions[i] >= 0.015); }
  p.reset(); assert.deepEqual(p.positions, p.rest); assert.ok(p.velocities.every(v => v === 0)); assert.equal(p.plasticBeams, 0); assert.ok(p.mounts.every(m => !m.broken && !m.force));
});

test('fixed physics cadence is independent of rendering cadence', () => {
  const a = create(), b = create(); a.hit(45); b.hit(45);
  for (let i = 0; i < 60; i++) a.advance(1 / 60);
  for (let i = 0; i < 30; i++) b.advance(1 / 30);
  assert.deepEqual(a.positions, b.positions); assert.deepEqual(a.mounts, b.mounts);
});

test('invalid panel input and impacts are rejected', () => {
  assert.throws(() => new DeformablePanel(samples, { mass: 0, mount: [0, 1, 0] }));
  assert.throws(() => new DeformablePanel([0, 1, 0, 0, 2, 0, 0, 3, 0], { mass: 1, mount: [0, 1, 0] }));
  const p = create(); for (const impulse of [NaN, -1, Infinity, 1001]) assert.throws(() => p.hit(impulse));
  assert.throws(() => p.hit(1, -1)); assert.throws(() => p.bind([NaN, 0, 0]));
});

test('release velocity keeps the requested movement while limiting solver recoil', () => {
  const p = create();
  p.velocities.fill(0);
  p.velocities[0] = -100;
  p.setReleaseVelocity([1, 2, -3], 6);
  const mean = [0, 0, 0], count = p.velocities.length / 3;
  for (let i = 0; i < p.velocities.length; i += 3) for (let axis = 0; axis < 3; axis++) mean[axis] += p.velocities[i + axis] / count;
  assert.ok(mean.every((value, axis) => Math.abs(value - [1, 2, -3][axis]) < 1e-10));
  assert.ok(p.velocities.every(Number.isFinite));
  assert.throws(() => p.setReleaseVelocity([NaN, 0, 0]));
});

test('moving anchors do not teleport simulated mass; skin bindings stay in the original part frame', () => {
  const p = create(), binding = p.bind([0, 1.35, 0]), original = p.positions.slice();
  p.setAnchorFrame(new Matrix4().makeTranslation(2, 3, 4).elements);
  assert.deepEqual(p.positions, original);
  const laterBinding = p.bind([0, 1.35, 0]); assert.deepEqual(laterBinding, binding);
  p.reset(); const out = [0, 0, 0]; p.skin(binding, out);
  [2, 4.35, 4].forEach((v, i) => assert.ok(Math.abs(out[i] - v) < 1e-12));
  p.setAnchorFrame(new Matrix4().makeTranslation(2, 3, 4.01).elements);
  p.advance(1 / 240); assert.ok(p.velocities.some(v => Math.abs(v) > 0.1));
});

test('swept node contacts stop tunnelling through an obstacle, including entry from its surface', () => {
  const p = create(); p.mounts.forEach(m => { m.broken = true; });
  p.colliders.push({ min: [-100, -100, -0.2], max: [100, 100, 0.2] });
  for (let i = 2; i < p.positions.length; i += 3) { p.positions[i] += 2; p.velocities[i] = -1000; }
  p.advance(1 / 240);
  for (let i = 2; i < p.positions.length; i += 3) assert.ok(p.positions[i] >= 0.2 - 1e-10);
  for (let i = 2; i < p.positions.length; i += 3) p.velocities[i] = -1000;
  p.advance(1 / 240);
  for (let i = 2; i < p.positions.length; i += 3) assert.ok(p.positions[i] >= 0.2 - 1e-10);
});
