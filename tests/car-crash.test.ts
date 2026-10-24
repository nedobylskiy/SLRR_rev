import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Vector3 } from 'three';
import { EngineWorld } from '../src/engine/world';
import { parsePartConfig } from '../src/formats/cfg';
import { CarCrashDemo } from '../src/engine/car-crash-demo';
import { PartHost, PART_CLASS } from '../src/engine/part-host';

function setup() {
  const world = new EngineWorld();
  const cfg = parsePartConfig(`body 0 0 0 0 0 0 1000 sphere 1
type 10 sphere 0.3
wheel -0.7 -0.6 -1.3 0 0 0 1 0 1 0
wheel 0.7 -0.6 -1.3 0 0 0 1 0 1 0
wheel -0.7 -0.6 1.3 0 0 0 0 1 1 1
wheel 0.7 -0.6 1.3 0 0 0 0 1 1 1
slot 0 0 0 0 0 0 20
slottype 101
slot 0 0 0 3.142 0 0 21
slottype 102
slot 0 0 0 0 0 0 22
slottype 103
slot 0 0 0 3.142 0 0 23
slottype 104
slot 0 0.21 -0.807 0 0 0 601`);
  const root = world.create({ key: { pack: 'test.rpk', id: 1 }, alias: 'car', cfgPath: 'car.cfg', config: cfg });
  for (let i = 0; i < 4; i++) {
    const child = world.create({ key: { pack: 'test.rpk', id: i + 2 }, alias: 'wheel', cfgPath: 'wheel.cfg', config: parsePartConfig('slot 0 0 0 0 0 0 1') }); world.install(root, 20 + i, child, 1);
  }
  const hood = world.create({ key: { pack: 'test.rpk', id: 6 }, alias: 'hood', cfgPath: 'hood.cfg', config: parsePartConfig('slot 0 0.191 0.696 0 0 0 601\nbody 0 0 0 0 0 0 38.5 sphere 0.5') }); world.install(root, 601, hood, 601);
  const samples: number[] = [];
  for (const z of [-0.7, 0, 0.7]) for (const x of [-0.7, 0, 0.7]) samples.push(x, 0.04, z);
  const demo = new CarCrashDemo(root, hood, samples, new Box3(new Vector3(-0.86, -0.57, -2.1), new Vector3(0.86, 0.6, 2.1)), { mountStrength: 1000, yieldStrain: 0.02 });
  return { world, root, hood, demo };
}
const input = { throttle: 0, steer: 0, brake: false };

test('contact releases the same world part, native topology updates and reset reinstalls it', () => {
  const { world, root, hood, demo } = setup(), count = world.parts.size, host = new PartHost(world), handle = host.bind(hood);
  demo.reset(20);
  for (let i = 0; i < 240 * 3; i++) demo.advance(1 / 240, input);
  assert.ok(!hood.parent); assert.equal(root.children.has(601), false); assert.equal(world.parts.get(hood.id), hood); assert.equal(world.parts.size, count);
  assert.equal(host.natives.invoke(PART_CLASS, 'partOnSlot', '(I)Ljava.game.parts.Part;', host.bind(root), [601]), null);
  assert.equal(host.natives.invoke(PART_CLASS, 'getSlotID', '(I)I', handle, [-1]), 0);
  const before = demo.driving.position.clone();
  for (let i = 0; i < 240; i++) demo.advance(1 / 240, { ...input, throttle: -1 });
  assert.ok(demo.driving.position.distanceTo(before) > 2); assert.equal(hood.parent, undefined);
  assert.ok(new Vector3().setFromMatrixPosition(hood.matrix()).distanceTo(demo.driving.position) > 1);
  demo.reset(); assert.equal(root.children.get(601), hood); assert.equal(host.bind(hood), handle); assert.equal(world.parts.size, count); assert.equal(demo.panel.plasticBeams, 0); assert.ok(demo.panel.mounts.every(m => !m.broken));
  host.dispose(); demo.dispose(); world.dispose(); assert.throws(() => demo.advance(0, input), /disposed/);
});

test('a fast launch without obstacle contact does not itself damage or detach the hood', () => {
  const { world, root, hood, demo } = setup(); demo.obstacle.min[0] += 10; demo.obstacle.max[0] += 10; demo.reset(20);
  for (let i = 0; i < 240 * 2; i++) demo.advance(1 / 240, input);
  assert.equal(hood.parent, root); assert.equal(demo.impactSpeed, 0); assert.equal(demo.panel.plasticBeams, 0); assert.ok(demo.panel.mounts.every(m => !m.broken)); world.dispose();
});

test('coupled driving/contact/deformation has the same state at different rendering cadences', () => {
  const a = setup(), b = setup(); a.demo.reset(20); b.demo.reset(20);
  for (let i = 0; i < 120; i++) a.demo.advance(1 / 60, input);
  for (let i = 0; i < 60; i++) b.demo.advance(1 / 30, input);
  assert.deepEqual(a.demo.panel.positions, b.demo.panel.positions); assert.deepEqual(a.demo.panel.velocities, b.demo.panel.velocities); assert.deepEqual(a.hood.local, b.hood.local); assert.equal(a.demo.impactSpeed, b.demo.impactSpeed); a.world.dispose(); b.world.dispose();
});

test('wall impulse rebounds the chassis and an off-centre impulse changes angular momentum', () => {
  const { world, demo } = setup(); demo.reset(20);
  for (let i = 0; i < 240 && !demo.impactSpeed; i++) demo.advance(1 / 240, input);
  assert.ok(demo.impactSpeed > 10); assert.ok(demo.driving.speed < -1); assert.ok(demo.reboundSpeed > 1);
  assert.ok(demo.velocity().length() < demo.impactSpeed);
  demo.reset(); const point = demo.driving.position.clone().add(new Vector3(0, 0, 1));
  demo.applyImpulse(new Vector3(1000, 0, 0), point);
  assert.ok(Math.abs(demo.velocity().x - 1000 / demo.mass) < 1e-10); assert.ok(Math.abs(demo.yawVelocity - 1000 / demo.inertia) < 1e-10);
  demo.applyImpulse(new Vector3(-1000, 0, 0), point); assert.ok(demo.velocity().length() < 1e-10); assert.ok(Math.abs(demo.yawVelocity) < 1e-10); world.dispose();
});

test('a detached hood contact gives the finite-mass chassis the opposite horizontal impulse', () => {
  const { world, hood, demo } = setup();
  demo.setBodyTriangles([0, -5, -10, 0, 5, -10, 0, 5, 10, 0, -5, -10, 0, 5, 10, 0, -5, 10]);
  world.detach(hood); demo.panel.mounts.forEach(m => { m.broken = true; });
  for (let i = 0; i < demo.panel.positions.length; i += 3) { demo.panel.positions[i] += 2; demo.panel.velocities[i] = -5; }
  for (let i = 0; i < 240 && !demo.bodySurface!.hits; i++) demo.advance(1 / 240, input);
  assert.ok(demo.bodySurface!.hits > 0); assert.ok(demo.velocity().x < -0.001); assert.ok(demo.panel.positions.every(Number.isFinite)); world.dispose();
});

