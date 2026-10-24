import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineWorld } from '../src/engine/world';
import { parsePartConfig } from '../src/formats/cfg';
import { DrivingDemo, NEUTRAL_INPUT } from '../src/engine/driving-demo';

function setup() {
  const world = new EngineWorld(), cfg = parsePartConfig(`steering -0.4 0.2 -0.4 0 -0.4 0\nmaxsteer 0.6 2.6\ntype 10 sphere 0.3\nwheel -0.7 -0.6 -1.3 0 0 0 1 0 1 0\nwheel 0.7 -0.6 -1.3 0 0 0 1 0 1 0\nwheel -0.7 -0.6 1.3 0 0 0 0 1 1 1\nwheel 0.7 -0.6 1.3 0 0 0 0 1 1 1\nslot 0 0 0 0 0 0 20\nslottype 101\nslot 0 0 0 3.142 0 0 21\nslottype 102\nslot 0 0 0 0 0 0 22\nslottype 103\nslot 0 0 0 3.142 0 0 23\nslottype 104\nslot 0 0 0 0 0 0 24\nslottype 11`);
  const root = world.create({ key: { pack: 'test.rpk', id: 1 }, alias: 'car', cfgPath: 'car.cfg', config: cfg });
  for (let i = 0; i < 5; i++) {
    const child = world.create({ key: { pack: 'test.rpk', id: i + 2 }, alias: 'wheel', cfgPath: 'wheel.cfg', config: parsePartConfig('slot 0 0 0 0 0 0 1') }); world.install(root, 20 + i, child, 1);
  }
  return { world, root, demo: new DrivingDemo(root) };
}
test('driving uses CFG axles/radii, accelerates, steers, brakes, reverses and resets all animated mounts', () => {
  const { world, root, demo } = setup(); assert.equal(demo.wheelbase, 2.6); assert.ok(Math.abs(demo.position.y - 0.9) < 1e-12);
  for (let i = 0; i < 180; i++) demo.advance(1 / 60, { throttle: 1, steer: 0, brake: false });
  assert.ok(demo.position.z < -15 && demo.speed > 10); const straight = demo.position.clone();
  for (let i = 0; i < 60; i++) demo.advance(1 / 60, { throttle: 1, steer: 1, brake: false });
  assert.ok(demo.position.x < straight.x - 1 && demo.yaw > 0);
  for (let i = 0; i < 240; i++) demo.advance(1 / 60, { ...NEUTRAL_INPUT, brake: true });
  assert.equal(demo.speed, 0);
  demo.reset(); for (let i = 0; i < 60; i++) demo.advance(1 / 60, { throttle: -1, steer: 0, brake: false });
  assert.ok(demo.position.z > 1 && demo.speed < 0);
  demo.reset(); assert.equal(demo.yaw, 0); assert.equal(demo.speed, 0); assert.equal(demo.distance, 0);
  assert.ok(Math.abs(root.children.get(20)!.local.elements[12] + 0.7) < 1e-12);
  assert.throws(() => demo.advance(1 / 60, { ...NEUTRAL_INPUT, throttle: NaN }), /Finite/);
  world.detach(root.children.get(20)!); assert.throws(() => demo.advance(1 / 60, NEUTRAL_INPUT), /detached/); world.dispose();
});
test('the same inputs produce the same movement across rendering cadences, including retained tick debt', () => {
  const a = setup(), b = setup(), input = { throttle: 1, steer: 0.3, brake: false };
  for (let i = 0; i < 240; i++) a.demo.advance(1 / 120, input);
  for (let i = 0; i < 40; i++) b.demo.advance(0.05, input);
  assert.ok(a.demo.position.distanceTo(b.demo.position) < 1e-10); assert.ok(Math.abs(a.demo.speed - b.demo.speed) < 1e-10);
  const frame = a.demo.advance(0.5, input); assert.ok(frame.backlogTicks > 0);
  while (a.world.clock.tick < 150) a.demo.advance(0, input);
  for (let i = 0; i < 60; i++) b.demo.advance(1 / 120, input);
  assert.ok(a.demo.position.distanceTo(b.demo.position) < 1e-10);
  a.world.dispose(); b.world.dispose();
});
