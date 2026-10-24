import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Vector3 } from 'three';
import { TriangleSurface } from '../src/engine/triangle-surface';
import { DeformablePanel } from '../src/engine/deformable-panel';

const plane = [-10, 0.5, -10, 10, 0.5, -10, 10, 0.5, 10, -10, 0.5, -10, 10, 0.5, 10, -10, 0.5, 10];
const surface = () => new TriangleSurface(plane, () => true, () => new Vector3(), () => {});
test('refit moves contacts outside old BVH bounds and invalidates cached candidates', () => {
  const s = surface(), old = new Float64Array([0, 1, 0]), p = new Float64Array([0, -1, 0]);
  assert.ok(s.project(p, old, 0));
  const moved = plane.map((v, i) => v + (i % 3 === 0 ? 30 : 0)); s.refit(moved);
  p.set([0, -1, 0]); assert.equal(s.project(p, old, 0), undefined);
  old.set([30, 1, 0]); p.set([30, -1, 0]); assert.ok(s.project(p, old, 0));
  const rebuilt = new TriangleSurface(moved, () => true, () => new Vector3(), () => {}), expected = new Float64Array([30, -1, 0]);
  rebuilt.project(expected, old, 0); assert.deepEqual(p, expected);
  assert.throws(() => s.refit(moved.slice(3)), /topology/);
  assert.throws(() => s.refit(moved.map((v, i) => i === 0 ? NaN : v)), /Invalid/);
});

test('refit can revive an initially degenerate face', () => {
  const s = new TriangleSurface([...plane, ...Array(9).fill(0)], () => true, () => new Vector3(), () => {});
  s.refit([...plane, 29, 2, -1, 31, 2, -1, 30, 2, 1]);
  const p = new Float64Array([30, 0, 0]); assert.ok(s.project(p, new Float64Array([30, 3, 0]), 0)); assert.ok(p[1] > 2);
});
test('triangle contact is two-sided, swept, bounded and cannot flip sides from inside its contact shell', () => {
  const s = surface(); s.setFrames(new Matrix4(), new Matrix4());
  for (const [fromY, toY, sign] of [[1, -4, 1], [0, 4, -1], [0.52, 0.2, 1]]) {
    const p = new Float64Array([0, toY, 0]), old = new Float64Array([0, fromY, 0]);
    const contact = s.project(p, old, 0); assert.ok(contact); assert.equal(Math.sign(contact.normal[1]), sign); assert.ok(Math.abs(p[1] - (0.5 + sign * s.radius)) < 1e-10);
  }
  assert.equal(s.project(new Float64Array([12, -1, 0]), new Float64Array([12, 1, 0]), 0), undefined);
});

test('moving body frame sweeps against a stationary world point', () => {
  const s = surface(); s.setFrames(new Matrix4(), new Matrix4().makeTranslation(0, 1, 0));
  const p = new Float64Array([0, 1, 0]); const contact = s.project(p, p.slice(), 0);
  assert.ok(contact); assert.ok(Math.abs(p[1] - (1.5 + s.radius)) < 1e-10);
});

test('a free panel bounces, transfers opposite impulse and remains supported above a roof', () => {
  const p = new DeformablePanel([-0.7, 1.3, -0.7, 0.7, 1.3, -0.7, -0.7, 1.3, 0.7, 0.7, 1.3, 0.7], { mass: 38.5, mount: [0, 1.3, 0.7], yieldStrain: 100 });
  p.mounts.forEach(m => { m.broken = true; }); let reactionY = 0, peakUpward = 0;
  const s = new TriangleSurface(plane, () => true, () => new Vector3(), j => { reactionY -= j[1]; }); s.setFrames(new Matrix4(), new Matrix4()); p.surfaces.push(s);
  for (let i = 1; i < p.velocities.length; i += 3) p.velocities[i] = -3;
  for (let tick = 0; tick < 720; tick++) { p.advance(1 / 240); const mean = p.velocities.filter((_, i) => i % 3 === 1).reduce((a, b) => a + b, 0) / (p.velocities.length / 3); if (s.hits) peakUpward = Math.max(peakUpward, mean); }
  assert.ok(peakUpward > 0.1); assert.ok(reactionY < -10); assert.ok(s.hits > 0);
  for (let i = 1; i < p.positions.length; i += 3) assert.ok(p.positions[i] >= 0.5 + s.radius - 1e-6);
});
