import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { FollowCamera } from '../src/render/follow-camera';

test('uneven frames and physics catch-up cannot change the camera offset during straight travel', () => {
  const follow = new FollowCamera(), position = new Vector3(), target = new Vector3();
  const focus = new Vector3(0, 1.1, 0), offset = new Vector3(0, 1.4, 7);
  follow.update(position, target, focus, offset, 0, 5);
  // Include a stalled physics frame and a later catch-up; camera follows the
  // rendered car pose rather than estimating displacement from wall time.
  for (const [elapsed, displacement] of [[1 / 60, 0.4], [0.08, 0.8], [1 / 60, 0], [0.05, 1.3], [1 / 120, 0.2]]) {
    focus.z -= displacement;
    follow.update(position, target, focus, offset, elapsed, 5);
    assert.ok(position.clone().sub(focus).distanceTo(offset) < 1e-12);
    assert.deepEqual(target, focus);
  }
});

test('view-offset damping has the same result at equal elapsed time across frame schedules', () => {
  const run = (schedule: number[]) => {
    const follow = new FollowCamera(), position = new Vector3(), target = new Vector3(), focus = new Vector3();
    follow.update(position, target, focus, new Vector3(0, 2, 7), 0, 5);
    for (const dt of schedule) {
      focus.x += 12 * dt;
      follow.update(position, target, focus, new Vector3(7, 3, 0), dt, 5);
    }
    return position.sub(focus);
  };
  assert.ok(run(Array(60).fill(1 / 60)).distanceTo(run(Array(10).fill([0.01, 0.02, 0.07]).flat())) < 1e-12);
});

test('teleports and leaving a cockpit reset the follow frame without carrying an old displacement', () => {
  const follow = new FollowCamera(), position = new Vector3(), target = new Vector3(), offset = new Vector3(0, 2, 7);
  follow.update(position, target, new Vector3(), offset, 0, 5);
  const destination = new Vector3(700, 12, -300);
  position.copy(destination).add(offset);
  follow.update(position, target, destination, offset, 0, 5, true);
  assert.deepEqual(position, destination.clone().add(offset));
  follow.reset(); position.set(1, 1, 1);
  follow.update(position, target, destination, offset, 0, 5);
  assert.deepEqual(position, destination.clone().add(offset));
});
