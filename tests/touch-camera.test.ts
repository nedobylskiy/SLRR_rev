import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampZoom, MAX_ZOOM, MIN_ZOOM, ORBIT_PER_PIXEL, TwoFingerCamera } from '../src/render/touch-camera';

test('one finger never moves the camera', () => {
  const gesture = new TwoFingerCamera();
  gesture.down(1, 100, 100);
  assert.equal(gesture.move(1, 150, 100), undefined);
  assert.equal(gesture.move(7, 150, 100), undefined, 'a finger that was not put down on the canvas');
});

test('two fingers moved together orbit the camera without zooming', () => {
  const gesture = new TwoFingerCamera();
  gesture.down(1, 100, 100); gesture.down(2, 200, 100);
  const delta = gesture.move(1, 140, 80)!;
  // Only one finger moved, so the midpoint moved half as far.
  assert.ok(Math.abs(delta.yaw - 20 * ORBIT_PER_PIXEL) < 1e-12);
  assert.ok(Math.abs(delta.pitch - 10 * ORBIT_PER_PIXEL) < 1e-12, 'up raises the camera, like the mouse orbit');
  const second = gesture.move(2, 240, 80)!;
  assert.ok(Math.abs(delta.zoom * second.zoom - 1) < 1e-9, 'same span after both fingers moved: zoom cancels out');
});

test('spreading the fingers zooms in, pinching zooms out, within limits', () => {
  const gesture = new TwoFingerCamera();
  gesture.down(1, 100, 100); gesture.down(2, 200, 100);
  assert.equal(gesture.move(2, 300, 100)!.zoom, .5, 'span doubled: half the distance');
  assert.equal(gesture.move(2, 200, 100)!.zoom, 2);
  gesture.up(2);
  assert.equal(gesture.move(1, 0, 0), undefined, 'lifting a finger ends the gesture');
  assert.equal(clampZoom(.01), MIN_ZOOM);
  assert.equal(clampZoom(99), MAX_ZOOM);
  assert.equal(clampZoom(Number.NaN), 1);
});
