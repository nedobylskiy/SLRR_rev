import assert from 'node:assert/strict';
import { test } from 'node:test';
import { angleDelta, leverAxes, wheelReturn, LEVER_DEAD_ZONE, mergeTouchInput, touchControlsEnabled, wheelSteer, WHEEL_LOCK_DEGREES } from '../src/render/touch-driving';
import type { DrivingInput } from '../src/engine/driving-demo';

test('touch controls follow the build flag unless ?touch= overrides it', () => {
  assert.equal(touchControlsEnabled('', false), false);
  assert.equal(touchControlsEnabled('', true), true, 'SLRR_TOUCH / --mode touch build');
  assert.equal(touchControlsEnabled('?touch=1', false), true);
  assert.equal(touchControlsEnabled('?game=x&touch=on', false), true);
  assert.equal(touchControlsEnabled('?touch=0', true), false);
  assert.equal(touchControlsEnabled('?touch=maybe', true), true, 'unknown values keep the build default');
  assert.equal(touchControlsEnabled(''), false, 'plain builds and node tests have no define');
});

test('wheel angle maps to the game steer axis (+1 is left) and clamps at full lock', () => {
  assert.equal(wheelSteer(0), -0);
  assert.equal(wheelSteer(WHEEL_LOCK_DEGREES), -1, 'clockwise is right');
  assert.equal(wheelSteer(-WHEEL_LOCK_DEGREES / 2), .5);
  assert.equal(wheelSteer(720), -1);
  assert.equal(angleDelta(170, -170), 20, 'crossing ±180° keeps turning the same way');
  assert.equal(angleDelta(-170, 170), -20);
});

test('the lever is one analog axis: forward is throttle, back is brake, centre is neither', () => {
  assert.deepEqual(leverAxes(0), { throttle: 0, brake: 0 });
  assert.deepEqual(leverAxes(LEVER_DEAD_ZONE / 2), { throttle: 0, brake: 0 });
  assert.deepEqual(leverAxes(1), { throttle: 1, brake: 0 });
  assert.deepEqual(leverAxes(-1), { throttle: 0, brake: 1 });
  const half = leverAxes(.53);
  assert.ok(half.throttle > .45 && half.throttle < .55 && half.brake === 0, 'proportional, not a button');
  assert.deepEqual(leverAxes(3), { throttle: 1, brake: 0 });
});

test('touch axes join keyboard input: the held wheel steers, the lever adds to the pedals', () => {
  const keys: DrivingInput = { throttle: 0, throttleMode: 'pedal', steer: 1, steerDigital: true, brake: false, brakeAxis: 0, serviceBrakeAxis: 0, handbrakeAxis: .4 };
  const idle = mergeTouchInput(keys, { steer: 0, throttle: 0, brake: 0, steering: false });
  assert.equal(idle.steer, 1, 'an untouched wheel leaves keyboard steering alone');
  assert.equal(idle.steerDigital, true);
  const driving = mergeTouchInput(keys, { steer: -.3, throttle: .7, brake: 0, steering: true });
  assert.equal(driving.steer, -.3); assert.equal(driving.steerDigital, false, 'analog steering');
  assert.equal(driving.throttle, .7); assert.equal(driving.handbrakeAxis, .4);
  const braking = mergeTouchInput({ ...keys, throttle: 1 }, { steer: .2, throttle: 0, brake: .6, steering: false });
  assert.equal(braking.steer, .2, 'a wheel still springing back keeps steering');
  assert.equal(braking.throttle, 1); assert.equal(braking.serviceBrakeAxis, .6); assert.equal(braking.brake, true);
});

test('a released wheel returns to centre by elapsed time, independent of the frame rate', () => {
  let fast = 120; for (let i = 0; i < 30; i++) fast = wheelReturn(fast, 1 / 60);
  const slow = wheelReturn(wheelReturn(120, .25), .25);
  assert.equal(fast, 0, 'centred within half a second at 60 fps');
  assert.equal(slow, 0, 'and at 4 fps');
  assert.ok(wheelReturn(-90, .016) > -90 && wheelReturn(-90, .016) < 0, 'moves towards centre from either side');
  assert.equal(wheelReturn(30, 0), 30);
});
