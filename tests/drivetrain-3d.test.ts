import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Matrix4, Vector3 } from 'three';
import { EngineWorld } from '../src/engine/world';
import { parsePartConfig } from '../src/formats/cfg';
import { RigidBody3D } from '../src/engine/rigid-body-3d';
import { Suspension3D, TestTerrain, tyreContactForces } from '../src/engine/suspension-3d';

test('spinning tyre retains lateral grip and yields longitudinal grip during a slide', () => {
  const straight = tyreContactForces(4000, 1, 3, 0);
  const sliding = tyreContactForces(4000, 1, 3, 2);
  assert.ok(straight.longitudinal > 0 && straight.lateral === 0);
  assert.ok(sliding.lateral < -straight.longitudinal, 'side response stays strong under throttle');
  assert.ok(sliding.longitudinal < straight.longitudinal, 'turning consumes forward grip');
  assert.ok(Number.isFinite(tyreContactForces(0, 1, 2, 2).longitudinal));
});

test('installed drivetrain accelerates a supported chassis, lets wheels slip and brakes it', () => {
  const world = new EngineWorld(); world.mechanical = true;
  const wheels = [[-0.7, -1.3], [0.7, -1.3], [-0.7, 1.3], [0.7, 1.3]].map(([x, z], i) => `type 10 sphere 0.3\nspring 0.29 0.1 0.05\nwheel ${x} -0.6 ${z} 0 0 0 ${i < 2 ? 1 : 0} 0 1 0`).join('\n');
  const slots = [101, 102, 103, 104, 121, 122, 123, 124, 301, 302, 303, 304, 311, 312, 313, 314, 401, 402, 403, 404, 405, 406].map(id => `slot 0 0 0 0 0 0 ${id}${id < 400 ? `\nslottype ${id >= 311 ? id - 10 : id >= 301 ? id : id >= 121 ? id + 80 : id}` : ''}`).join('\n');
  const create = (id: number, kind?: 'suspension' | 'spring' | 'shock' | 'engine', values: Record<string, number> = {}, script = `${id}.java`, drive?: string) => world.create({
    key: { pack: 'test.rpk', id }, alias: String(id), cfgPath: `${id}.cfg`, script,
    config: parsePartConfig('slot 0 0 0 0 0 0 1'), mechanics: kind ? { kind, source: script, values, drive } : undefined,
  });
  const root = world.create({ key: { pack: 'test.rpk', id: 1 }, alias: 'root', cfgPath: 'root.cfg', config: parsePartConfig(`${wheels}\n${slots}`) });
  for (let i = 0; i < 4; i++) {
    world.install(root, 101 + i, create(10 + i), 1);
    world.install(root, 121 + i, create(20 + i, 'suspension'), 1);
    world.install(root, 301 + i, create(30 + i, 'shock', { damping: 3000 }), 1);
    world.install(root, 311 + i, create(40 + i, 'spring', { force: 73000 }), 1);
  }
  for (const [slot, part] of [
    [401, create(50, 'engine', { cylinders: 6, bore: 80, rpm_idle: 900, RPM_limit: 6500 })],
    [402, create(51, 'engine', { stroke: 90 })],
    [403, create(52, 'engine', { intake_valve_diam: 32 })],
    [404, create(53, 'engine', { gears: 5, 'ratio[1]': 3.58, 'ratio[2]': 2.49, 'ratio[3]': 1.66, end_ratio: 3.03 }, 'transmission.java', 'DT_RWD')],
    [405, create(54, 'engine', {}, 'clutch.java')], [406, create(55, 'engine', {}, 'fuel_rail.java')],
  ] as const) world.install(root, slot, part, 1);
  const body = new RigidBody3D(1150, new Box3(new Vector3(-0.85, -0.55, -2), new Vector3(0.85, 0.55, 2)));
  body.setFrame(new Matrix4().makeTranslation(0, 0.9, 0));
  const suspension = new Suspension3D(root, body, new TestTerrain()); suspension.reset();
  const tick = (throttle: number, brake = false, gearUp = false, gearDown = false) => { suspension.step(1 / 240, { throttle, steer: 0, brake, gearUp, gearDown }); body.integrate(1 / 240); };
  for (let i = 0; i < 480; i++) tick(0);
  assert.ok(suspension.wheels.every(w => w.contact));
  tick(0, false, true);
  for (let i = 0; i < 60; i++) tick(0);
  const start = body.position.z;
  for (let i = 0; i < 720; i++) tick(1);
  assert.ok(body.position.z < start - 1, `drive displacement ${body.position.z - start}`);
  assert.ok(suspension.mechanics!.rpm > 900 && suspension.mechanics!.rpm < 7000);
  assert.ok(suspension.wheels[2].spin > 0 && suspension.wheels[2].omega > 0);
  assert.ok(suspension.wheels.every(w => Number.isFinite(w.slip)));
  const speed = body.velocity.length(); for (let i = 0; i < 240; i++) tick(0, true);
  assert.ok(body.velocity.length() < speed, `braking ${body.velocity.length()} < ${speed}`);
  body.setFrame(new Matrix4().makeTranslation(0, 0.9, 0)); suspension.reset();
  for (let i = 0; i < 480; i++) tick(0);
  tick(0, false, false, true);
  for (let i = 0; i < 60; i++) tick(0);
  const reverseStart = body.position.z;
  for (let i = 0; i < 720; i++) tick(-1);
  assert.equal(suspension.mechanics!.gear, -1);
  assert.ok(body.position.z > reverseStart + 1, `reverse displacement ${body.position.z - reverseStart}`);
  world.dispose();
});
