import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Vector3 } from 'three';
import { solveHubGeometry, applyExperimentalHubPose } from '../src/engine/hub-geometry';
import { createWheelRefState } from '../src/runtime/wheel-ref-native';
import { EngineWorld } from '../src/engine/world';
import { parsePartConfig } from '../src/formats/cfg';
import { linkedSlotFrame } from '../src/engine/linked-slots';

const near = (a: Vector3, b: Vector3) => assert.ok(a.distanceTo(b) < 1e-9, `${a.toArray()} != ${b.toArray()}`);
const wheel = () => {
  const state = createWheelRefState();
  state.arm = [1, -1, 0, 0, 0, 0, 1];
  state.hub = [-1, 0, 0, 0, 0, 1, 0, 0, .5, 0];
  return state;
};

test('arm projection preserves hinge position and radius, including mirrored travel', () => {
  for (const mirror of [1, -1]) {
    const state = wheel(); state.arm[1] *= mirror;
    const frames = solveHubGeometry(new Vector3(), new Vector3(0, -.3, .2), state)!;
    const point = new Vector3().setFromMatrixPosition(frames.arm);
    assert.ok(Math.abs(point.z - .2) < 1e-10);
    assert.ok(Math.abs(Math.hypot(point.x + mirror, point.y) - 1) < 1e-10);
    assert.ok(point.x * mirror < 0, 'travel also changes track width');
    assert.ok(point.y < 0);
    const again = solveHubGeometry(new Vector3(), new Vector3(0, -.3, .2), state)!;
    assert.deepEqual(again, frames, 'the pure solve does not accumulate transforms');
  }
});

test('hub zero closes both lower attachment and upper strut point', () => {
  const state = wheel(); state.hub[0] = 0; state.hub[2] = -.2;
  const frames = solveHubGeometry(new Vector3(), new Vector3(0, -.3, 0), state)!;
  const arm = new Vector3().setFromMatrixPosition(frames.arm);
  near(new Vector3(0, -.2, 0).applyMatrix4(frames.hub), arm);
  const upper = new Vector3(0, .7, 0);
  const hub = new Vector3().setFromMatrixPosition(frames.hub);
  const direction = new Vector3(0, 1, 0).transformDirection(frames.hub);
  near(upper.clone().sub(hub).normalize(), direction);
  assert.ok(upper.y > hub.y);
});

test('unsupported or degenerate hub geometry fails without producing NaNs', () => {
  const state = wheel();
  state.hub[0] = 1; assert.equal(solveHubGeometry(new Vector3(), new Vector3(), state), undefined);
  state.hub[0] = -1; state.arm[6] = 0;
  assert.equal(solveHubGeometry(new Vector3(), new Vector3(), state), undefined);
  state.arm[6] = 1; state.arm[0] = NaN;
  assert.equal(solveHubGeometry(new Vector3(), new Vector3(), state), undefined);
});

test('experimental mounts apply once, wheel spin leaves the arm carrier unchanged, disabled mode is inert', () => {
  const world = new EngineWorld();
  const definition = (id: number, cfg: string) => ({ key: { pack: 'test.rpk', id }, alias: 'test', cfgPath: 'test.cfg', config: parsePartConfig(cfg) });
  const root = world.create(definition(1, 'type 10 sphere .3\nspring .3 .1 .05\nwheel 0 0 0 0 0 0 1 0 1 0\nslot .1 .05 0 0 .2 0 101\nslottype 101\nslot .2 0 0 0 0 0 351\nslottype 101'));
  const rim = world.create(definition(2, 'slot .02 .03 0 0 .1 0 1'));
  world.install(root, 101, rim, 1); world.wheelRefs = [wheel()];
  const original = rim.local.clone();
  assert.equal(applyExperimentalHubPose(root, 0, .5, .2), false);
  assert.deepEqual(rim.local, original);
  world.experimentalHubGeometry = true;
  assert.equal(applyExperimentalHubPose(root, 0, .5, .2), true);
  const once = rim.local.clone(), arm = rim.armTravelTransform!.clone();
  const linkedArm = rim.matrix().multiply(linkedSlotFrame(rim, 351, false)!);
  applyExperimentalHubPose(root, 0, .5, .2);
  assert.deepEqual(rim.local, once);
  applyExperimentalHubPose(root, 0, .5, .2, 2);
  assert.notDeepEqual(rim.local, once);
  assert.deepEqual(rim.armTravelTransform, arm);
  const spunLinkedArm = rim.matrix().multiply(linkedSlotFrame(rim, 351, false)!);
  assert.ok(spunLinkedArm.elements.every((value, i) => Math.abs(value - linkedArm.elements[i]) < 1e-9), 'linked control arms inherit neither hub steering nor tyre spin');
  const input = root.definition.config.wheels[0];
  const frames = solveHubGeometry(new Vector3(...input.position), new Vector3(0, -.1, 0), world.wheelRefs[0]!)!;
  near(new Vector3().setFromMatrixPosition(arm.clone().multiply(root.wheelFrame(0))), new Vector3().setFromMatrixPosition(frames.arm));
  assert.deepEqual(root.local, new Matrix4());
  world.wheelRefs[0]!.oppositeWheel = 1;
  assert.equal(applyExperimentalHubPose(root, 0, .5, .2), false, 'live-axle coupling stays on the explicit unsupported path');
});
