import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { InertialCamera } from '../src/render/inertial-camera';

test('inertial camera accelerates behind the car and keeps coasting when the car stops', () => {
  const rig = new InertialCamera(), position = new Vector3(), target = new Vector3(), focus = new Vector3(), offset = new Vector3(0, 2, 7);
  rig.update(position, target, focus, offset, 0, 5, true);
  for (let i = 0; i < 120; i++) { focus.x += 10 / 60; rig.update(position, target, focus, offset, 1 / 60); }
  assert.ok(position.x < focus.x - 1, 'camera lags behind rather than copying car translation');
  assert.ok(rig.velocity.x > 9 && rig.velocity.x < 10);
  const before = position.x;
  rig.update(position, target, focus, offset, 1 / 60);
  assert.ok(position.x > before, 'camera retains forward motion after the car stops');
  for (let i = 0; i < 600; i++) rig.update(position, target, focus, offset, 1 / 60);
  assert.ok(position.distanceTo(focus.clone().add(offset)) < 1e-8);
  assert.ok(rig.velocity.length() < 1e-8);
  assert.deepEqual(target, focus);
});

test('inertial camera trajectory agrees across smooth and uneven frame schedules', () => {
  const run = (schedule: number[]) => {
    const rig = new InertialCamera(), position = new Vector3(), target = new Vector3(), focus = new Vector3(), offset = new Vector3(0, 2, 7);
    rig.update(position, target, focus, offset, 0, 5, true);
    for (const dt of schedule) { focus.addScaledVector(new Vector3(12, 0, -4), dt); rig.update(position, target, focus, offset, dt); }
    return { position, velocity: rig.velocity };
  };
  const smooth = run(Array(60).fill(1 / 60)), uneven = run(Array(10).fill([0.01, 0.02, 0.07]).flat());
  assert.ok(smooth.position.distanceTo(uneven.position) < 1e-10);
  assert.ok(smooth.velocity.distanceTo(uneven.velocity) < 1e-10);
});

test('activation preserves the current view; reset and teleport discard camera momentum', () => {
  const rig = new InertialCamera(), position = new Vector3(2, 4, 10), target = new Vector3(), focus = new Vector3(), offset = new Vector3(0, 2, 7);
  rig.update(position, target, focus, offset, 0);
  assert.deepEqual(position, new Vector3(2, 4, 10));
  focus.x = 10; rig.update(position, target, focus, offset, 0.1);
  assert.ok(rig.velocity.length() > 0);
  rig.reset(); assert.equal(rig.velocity.length(), 0);
  focus.set(700, 12, -300); rig.update(position, target, focus, offset, 0, 5, true);
  assert.deepEqual(position, focus.clone().add(offset));
  assert.deepEqual(target, focus); assert.equal(rig.velocity.length(), 0);
  rig.update(position, target, focus, offset, 1);
  assert.ok(position.distanceTo(focus.clone().add(offset)) < 1e-10, 'long stationary frames remain stable');
});
