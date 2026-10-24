import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Matrix4, Vector3 } from 'three';
import { RigidBody3D, boxContact } from '../src/engine/rigid-body-3d';
import { Vehicle3D } from '../src/engine/vehicle-3d';
import { EngineWorld } from '../src/engine/world';
import { parsePartConfig } from '../src/formats/cfg';
import { DeformablePanel } from '../src/engine/deformable-panel';

const neutral = { throttle: 0, steer: 0, brake: false };
function setup() {
  const world = new EngineWorld(), slots = [101, 102, 103, 104].map((type, i) => `slot 0 0 0 0 0 0 ${20 + i}\nslottype ${type}`).join('\n');
  const wheels = [[-0.7, -1.3], [0.7, -1.3], [-0.7, 1.3], [0.7, 1.3]].map(([x, z], i) => `type 10 sphere 0.3\nspring 0.29 0.1 0.05\nwheel ${x} -0.6 ${z} 0 0 0 ${i < 2 ? 1 : 0} 0 1 0`).join('\n');
  const create = (id: number, file: string, cfg: string) => world.create({ key: { pack: 'test.rpk', id }, alias: file, cfgPath: file, config: parsePartConfig(cfg) });
  const root = create(1, 'car.cfg', `body 0 -0.2 0 0 0 0 1000 sphere 1\n${wheels}\n${slots}\nslot 0 0.21 -0.807 0 0 0 601\nslot -0.8 0 0 0 0 0 602\nslot 0.5 0.05 -2.35 0 0 0 603`);
  for (let i = 0; i < 4; i++) world.install(root, 20 + i, create(i + 2, 'wheel.cfg', 'slot 0 0 0 0 0 0 1'), 1);
  const hood = create(6, 'hood.cfg', 'slot 0 0.191 0.696 0 0 0 601\nbody 0 0 0 0 0 0 38.5 sphere 1'); world.install(root, 601, hood, 601);
  const door = create(7, 'door.cfg', 'slot 0 0 0 0 0 0 1\nbody 0 0 0 0 0 0 15 sphere 1'); world.install(root, 602, door, 1);
  const lamp = create(8, 'headlights.cfg', 'slot 0 0 0 0 0 0 1\nbody 0 0 0 0 0 0 1 sphere 0.2'); world.install(root, 603, lamp, 1);
  const samples = [-0.7, 0.04, -0.7, 0.7, 0.04, -0.7, -0.7, 0.04, 0.7, 0.7, 0.04, 0.7];
  const demo = new Vehicle3D(root, hood, samples, new Box3(new Vector3(-0.85, -0.55, -2.1), new Vector3(0.85, 0.6, 2.1)));
  const box = (x: number, y: number, z: number) => { const a: number[] = []; for (const px of [-x, x]) for (const py of [-y, y]) for (const pz of [-z, z]) a.push(px, py, pz); return a; };
  demo.register(door, box(0.04, 0.4, 0.6), []); demo.register(lamp, box(0.15, 0.15, 0.15), []); demo.reset();
  return { world, root, hood, door, lamp, demo };
}

test('rigid body integrates vertical motion and all rotation axes from an off-centre impulse', () => {
  const body = new RigidBody3D(1000, new Box3(new Vector3(-1, -0.5, -2), new Vector3(1, 0.5, 2)));
  body.setFrame(new Matrix4().makeTranslation(0, 5, 0)); body.impulse(new Vector3(1000, 2000, 300), new Vector3(0, 6, 1));
  assert.ok(body.omega.x !== 0 && body.omega.y !== 0 && body.omega.z !== 0);
  for (let i = 0; i < 120; i++) body.integrate(1 / 240);
  assert.ok(body.position.x > 0.4); assert.ok(body.position.y < 5.5); assert.ok(Math.abs(body.orientation.length() - 1) < 1e-12);
  assert.ok(boxContact(body, new Box3(new Vector3(-10, -10, -10), new Vector3(10, 10, 10))));
  assert.equal(boxContact(body, new Box3(new Vector3(50, 50, 50), new Vector3(51, 51, 51))), undefined);
});

test('CFG spring values are scoped and a vertical volume reproduces the original part geometry', () => {
  const cfg = parsePartConfig('type 1 sphere 0.3\nspring 0.29 0.1 0.05\nwheel 0 0 0 0 0 0\ntype 1 sphere 0.4\nwheel 0 0 1 0 0 0');
  assert.deepEqual(cfg.wheels[0].spring, [0.29, 0.1, 0.05]); assert.equal(cfg.wheels[1].spring, undefined);
  const samples = [-0.04, -0.5, -0.7, 0.04, 0.5, -0.7, -0.04, 0.5, 0.7, 0.04, -0.5, 0.7];
  const p = new DeformablePanel(samples, { mass: 10, mount: [0, 0, 0], volume: true, resolution: [4, 5] });
  for (let i = 0; i < samples.length; i += 3) { const out = [0, 0, 0]; p.skin(p.bind(samples.slice(i, i + 3)), out); out.forEach((v, a) => assert.ok(Math.abs(v - samples[i + a]) < 1e-10)); }
});

test('four ray springs settle, then a ramp makes the car airborne and an offset strike rolls it over', () => {
  const { world, demo } = setup();
  for (let i = 0; i < 480; i++) demo.advance(1 / 240, neutral);
  assert.ok(demo.suspension.wheels.every(w => w.contact && w.force > 0)); assert.ok(demo.driving.position.y > 0.7 && demo.driving.position.y < 1);
  assert.ok(Math.abs(demo.suspension.wheels.reduce((s, w) => s + w.force, 0) - demo.body.mass * 9.81) < demo.body.mass);
  demo.jump(); let maxY = 0, off = 0;
  for (let i = 0; i < 720; i++) { demo.advance(1 / 240, neutral); maxY = Math.max(maxY, demo.driving.position.y); if (demo.suspension.wheels.every(w => !w.contact)) off++; }
  assert.ok(maxY > 1.5); assert.ok(off > 20);
  demo.roll(); let minUp = 1;
  for (let i = 0; i < 720; i++) { demo.advance(1 / 240, neutral); minUp = Math.min(minUp, new Vector3(0, 1, 0).applyQuaternion(demo.body.orientation).y); }
  assert.ok(minUp < -0.8); assert.ok(demo.body.position.toArray().every(Number.isFinite)); world.dispose();
});

test('a headlight separates as a rigid part and reset restores the same full assembly', () => {
  const { world, root, hood, door, lamp, demo } = setup(), count = world.parts.size; demo.reset(50 / 3.6);
  for (let i = 0; i < 480; i++) demo.advance(1 / 240, neutral);
  assert.ok(!lamp.parent); assert.equal(demo.soft.has(lamp), false); assert.equal(world.parts.get(lamp.id), lamp);
  const frame = lamp.matrix(), a = new Vector3(0.1, 0, 0).applyMatrix4(frame), b = new Vector3(-0.1, 0, 0).applyMatrix4(frame); assert.ok(Math.abs(a.distanceTo(b) - 0.2) < 1e-10);
  demo.reset(); assert.equal(world.parts.size, count); assert.equal(hood.parent, root); assert.equal(door.parent, root); assert.equal(lamp.parent, root); assert.ok([...demo.soft.values()].every(s => s.panel.plasticBeams === 0)); world.dispose();
});

test('3D suspension, rotation and panel state are independent of rendering cadence', () => {
  const a = setup(), b = setup(), input = { throttle: 1, steer: 0.2, brake: false };
  for (let i = 0; i < 60; i++) a.demo.advance(1 / 60, input);
  for (let i = 0; i < 30; i++) b.demo.advance(1 / 30, input);
  assert.deepEqual(a.demo.body.position, b.demo.body.position); assert.deepEqual(a.demo.body.orientation, b.demo.body.orientation); assert.deepEqual(a.demo.panel.positions, b.demo.panel.positions);
  assert.throws(() => a.demo.advance(0, { ...input, steer: NaN }), /Finite/); a.world.dispose(); b.world.dispose();
});

test('installed panels stay rigid at rest, wake for an impulse and retain their dents when carried', () => {
  const { world, demo, hood } = setup();
  for (let i = 0; i < 120; i++) demo.advance(1 / 240, neutral);
  assert.ok([...demo.soft.values()].every(s => !s.activity.deforming));
  assert.equal(demo.panel.clock.tick, demo.clock.tick);
  demo.panel.hit(90); demo.advance(1 / 240, neutral);
  assert.ok(demo.soft.get(hood)!.activity.deforming);
  for (let i = 0; i < 180; i++) demo.advance(1 / 240, neutral);
  assert.ok(demo.panel.plasticBeams > 0);
  const plastic = demo.panel.beams.map(b => b.rest), positions = demo.panel.positions.slice();
  const transform = new Matrix4().makeRotationY(0.4).setPosition(2, 3, -1);
  demo.panel.advanceRigid(1 / 240, transform.elements, [1, 2, 3], [0, 0.5, 0], [0, 0, 0]);
  assert.deepEqual(demo.panel.beams.map(b => b.rest), plastic);
  for (let i = 0; i < positions.length; i += 3) assert.ok(new Vector3().fromArray(demo.panel.positions, i).distanceTo(new Vector3().fromArray(positions, i).applyMatrix4(transform)) < 1e-10);
  demo.reset(); assert.ok(!demo.soft.get(hood)!.activity.deforming); assert.equal(demo.panel.plasticBeams, 0); world.dispose();
});

test('a released panel becomes a rigid free body in flight and wakes again on landing', () => {
  const { world, demo, hood } = setup();
  world.detach(hood); demo.panel.mounts.forEach(m => { m.broken = true; });
  for (let i = 1; i < demo.panel.positions.length; i += 3) demo.panel.positions[i] += 5;
  let rigidFlight = false, wokeOnLanding = false;
  for (let i = 0; i < 480; i++) {
    demo.advance(1 / 240, neutral);
    const activity = demo.soft.get(hood)!.activity;
    if (!activity.deforming && activity.freeBody) { rigidFlight = true; assert.ok(activity.freeBody.velocity.y < 0); }
    if (rigidFlight && activity.deforming) { wokeOnLanding = true; break; }
  }
  assert.ok(rigidFlight); assert.ok(wokeOnLanding); assert.equal(hood.parent, undefined); world.dispose();
});






