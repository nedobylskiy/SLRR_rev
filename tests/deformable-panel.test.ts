import test from 'node:test';
import assert from 'node:assert/strict';
import { DeformablePanel } from '../src/engine/deformable-panel';

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
  run(p, 3); assert.equal(p.attached, false); assert.ok(p.plasticBeams > 0);
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
