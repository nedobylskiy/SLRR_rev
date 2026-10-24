import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Matrix4, Vector3 } from 'three';
import { RigidBody3D, boxContact, orientedBoxContact } from '../src/engine/rigid-body-3d';
import { Vehicle3D } from '../src/engine/vehicle-3d';
import { EngineWorld } from '../src/engine/world';
import { parsePartConfig } from '../src/formats/cfg';
import { DeformablePanel } from '../src/engine/deformable-panel';

const neutral = { throttle: 0, steer: 0, brake: false };
function setup(mechanical = false) {
  const world = new EngineWorld(), slots = [101, 102, 103, 104].map((type, i) => `slot 0 0 0 0 0 0 ${20 + i}\nslottype ${type}`).join('\n');
  const wheels = [[-0.7, -1.3], [0.7, -1.3], [-0.7, 1.3], [0.7, 1.3]].map(([x, z], i) => `type 10 sphere 0.3\nspring 0.29 0.1 0.05\nwheel ${x} -0.6 ${z} 0 0 0 ${i < 2 ? 1 : 0} 0 1 0`).join('\n');
  const create = (id: number, file: string, cfg: string) => world.create({ key: { pack: 'test.rpk', id }, alias: file, cfgPath: file, config: parsePartConfig(cfg) });
  const root = create(1, 'car.cfg', `body 0 -0.2 0 0 0 0 1000 sphere 1\n${wheels}\n${slots}\nslot 0 0.21 -0.807 0 0 0 601\nslot -0.8 0 0 0 0 0 602\nslot 0.5 0.05 -2.35 0 0 0 603`);
  for (let i = 0; i < 4; i++) world.install(root, 20 + i, create(i + 2, 'wheel.cfg', 'slot 0 0 0 0 0 0 1'), 1);
  const hood = create(6, 'hood.cfg', 'slot 0 0.191 0.696 0 0 0 601\nbody 0 0 0 0 0 0 38.5 sphere 1'); world.install(root, 601, hood, 601);
  const door = create(7, 'door.cfg', 'slot 0 0 0 0 0 0 1\nbody 0 0 0 0 0 0 15 sphere 1'); world.install(root, 602, door, 1);
  const lamp = create(8, 'headlights.cfg', 'slot 0 0 0 0 0 0 1\nbody 0 0 0 0 0 0 1 sphere 0.2'); world.install(root, 603, lamp, 1);
  let struts: ReturnType<typeof create>[] = [], sway: ReturnType<typeof create> | undefined, block: ReturnType<typeof create> | undefined, crank: ReturnType<typeof create> | undefined;
  if (mechanical) {
    world.mechanical = true;
    for (const [id, kind] of [[121, 'suspension'], [311, 'spring'], [301, 'shock']] as const) for (let index = 0; index < 4; index++) {
      const slot = id + index;
      root.definition.config.slots.push({ id: slot, position: [index % 2 ? 0.7 : -0.7, -0.4, index < 2 ? -1.3 : 1.3], rotation: [0, 0, 0], attach: [], compatible: [], type: (kind === 'spring' ? 301 : 201) + index });
      const part = create(20 + slot, `${kind}.cfg`, 'slot 0 0 0 0 0 0 1');
      part.definition.mechanics = { kind, source: `${kind}.java`, values: kind === 'spring' ? { force: 71000 } : kind === 'shock' ? { damping: 3000 } : {} };
      world.install(root, slot, part, 1);
      if (kind === 'suspension') struts.push(part);
    }
    root.definition.config.slots.push({ id: 701, position: [0, -0.3, 0], rotation: [0, 0, 0], attach: [], compatible: [] });
    sway = create(702, 'sway.cfg', 'slot 0 0 0 0 0 0 1');
    sway.definition.mechanics = { kind: 'sway', source: 'sway.java', values: { force: 9000 } };
    world.install(root, 701, sway, 1);
    root.definition.config.slots.push({ id: 401, position: [0, -0.3, -1.4], rotation: [0, 0, 0], attach: [], compatible: [] });
    block = create(500, 'engine-block.cfg', 'slot 0 0 0 0 0 0 1\nslot 0 0 0.7 0 0 0 33\nbody 0 0 0 0 0 0 37 sphere 0.4');
    block.definition.mechanics = { kind: 'engine', source: 'block.java', values: { cylinders: 6, bore: 80 } }; world.install(root, 401, block, 1);
    crank = create(501, 'engine-crank.cfg', 'slot 0 0 0 0 0 0 1\nbody 0 0 0 0 0 0 10 sphere 0.2');
    crank.definition.mechanics = { kind: 'engine', source: 'crank.java', values: { stroke: 90 } }; world.install(block, 33, crank, 1);
  }
  const samples = [-0.7, 0.04, -0.7, 0.7, 0.04, -0.7, -0.7, 0.04, 0.7, 0.7, 0.04, 0.7];
  const demo = new Vehicle3D(root, hood, samples, new Box3(new Vector3(-0.85, -0.55, -2.1), new Vector3(0.85, 0.6, 2.1)));
  const box = (x: number, y: number, z: number) => { const a: number[] = []; for (const px of [-x, x]) for (const py of [-y, y]) for (const pz of [-z, z]) a.push(px, py, pz); return a; };
  demo.register(door, box(0.04, 0.4, 0.6), []); demo.register(lamp, box(0.15, 0.15, 0.15), []); demo.reset();
  if (mechanical) {
    for (const wheel of demo.suspension.wheels) demo.register(wheel.part, box(0.3, 0.3, 0.1), []);
    demo.register(block!, box(0.3, 0.3, 0.3), []);
    demo.register(crank!, box(0.2, 0.2, 0.2), []);
    demo.reset();
  }
  return { world, root, hood, door, lamp, demo, struts, sway, block, crank };
}

test('suspension hardware follows wheel travel without wheel spin, while the anti-roll bar stays on the chassis', () => {
  const { world, root, demo, struts, sway } = setup(true);
  const wheel = demo.suspension.wheels[0], spring = root.children.get(311)!, shock = root.children.get(301)!;
  const position = (part: typeof spring) => new Vector3().setFromMatrixPosition(part.matrix());
  const before = [wheel.part, struts[0], spring, shock, sway!].map(position);
  wheel.length -= 0.08; demo.suspension.sync();
  const after = [wheel.part, struts[0], spring, shock, sway!].map(position);
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(after[i].y - before[i].y - 0.08) < 1e-10);
  assert.ok(after[4].distanceTo(before[4]) < 1e-12);
  const strutFrame = struts[0].matrix(); wheel.spin = 1; demo.suspension.sync();
  assert.ok(struts[0].matrix().elements.every((n, i) => Math.abs(n - strutFrame.elements[i]) < 1e-12));
  demo.reset(); assert.ok(position(struts[0]).distanceTo(before[1]) < 1e-12);
  world.dispose();
});

test('engine drops with its children as one rigid assembly, while a failed strut keeps its place and releases the wheel', () => {
  const { world, root, demo, struts, block, crank } = setup(true);
  assert.ok(block && crank); assert.equal(demo.rigid.has(crank), false);
  crank.condition = 0; demo.advance(1 / 240, neutral);
  assert.equal(crank.parent, block); assert.equal(block.parent, root);
  const hull = demo.rigid.get(block)!.body.bounds;
  assert.ok(hull.max.z > 0.8, 'engine hull includes the crankshaft mounted beyond the block');
  block.condition = 0; demo.advance(1 / 240, neutral);
  assert.equal(block.parent, undefined); assert.equal(crank.parent, block);
  assert.equal(demo.rigid.get(block)!.body.mass, 47);
  assert.equal(demo.rigid.has(crank), false);
  for (let i = 0; i < 30; i++) demo.advance(1 / 240, neutral);
  assert.ok(new Vector3().setFromMatrixPosition(crank.matrix()).distanceTo(new Vector3().setFromMatrixPosition(block.matrix())) < 2);
  struts[0].condition = 0; const wheel = demo.suspension.wheels[0].part;
  demo.advance(1 / 240, neutral);
  assert.equal(struts[0].parent, root); assert.equal(wheel.parent, undefined);
  assert.equal(wheel.condition, 0); assert.ok(demo.rigid.has(wheel));
  demo.reset();
  assert.equal(block.parent, root); assert.equal(crank.parent, block); assert.equal(struts[0].parent, root); assert.equal(wheel.parent, root);
  assert.equal(block.condition, 1); assert.equal(struts[0].condition, 1); assert.equal(wheel.condition, 1);
  world.dispose();
});

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
  assert.equal(lamp.condition, 0);
  const frame = lamp.matrix(), a = new Vector3(0.1, 0, 0).applyMatrix4(frame), b = new Vector3(-0.1, 0, 0).applyMatrix4(frame); assert.ok(Math.abs(a.distanceTo(b) - 0.2) < 1e-10);
  demo.reset(); assert.equal(world.parts.size, count); assert.equal(hood.parent, root); assert.equal(door.parent, root); assert.equal(lamp.parent, root); assert.ok([...demo.soft.values()].every(s => s.panel.plasticBeams === 0)); world.dispose();
});

test('a 15 km/h impact marks the chassis without tearing off healthy body panels', () => {
  const { world, root, hood, door, demo } = setup();
  const shell: number[] = [];
  for (const x of [-0.85, 0.85]) for (const y of [-0.55, 0.6]) for (const z of [-2.1, 2.1]) shell.push(x, y, z);
  demo.register(root, shell, []);
  demo.reset(15 / 3.6);
  for (let i = 0; i < 2 * 240; i++) demo.advance(1 / 240, neutral);
  assert.ok(demo.impactSpeed > 3, 'the chassis reached the obstacle');
  assert.ok(root.condition < 1 && root.condition > 0.9, `chassis condition ${root.condition}`);
  assert.ok(hood.condition > 0.6, `hood condition ${hood.condition}; mounts ${demo.panel.mounts.map(m => `${m.broken}:${Math.round(m.force)}`).join(',')}; root ${root.condition}; door ${door.condition}`);
  assert.ok(door.condition > 0.6, `door condition ${door.condition}`);
  assert.equal(hood.parent, root);
  assert.ok(demo.panel.mounts.every(m => !m.broken));
  world.dispose();
});

test('a severe impact can still release the hood as one part', () => {
  const { world, root, hood, demo } = setup();
  const shell: number[] = [];
  for (const x of [-0.85, 0.85]) for (const y of [-0.55, 0.6]) for (const z of [-2.1, 2.1]) shell.push(x, y, z);
  demo.register(root, shell, []);
  demo.reset(50 / 3.6);
  let beforeRelease = demo.soft.get(hood)!.activity.motion().center;
  for (let i = 0; i < 2 * 240 && hood.parent; i++) {
    beforeRelease = demo.soft.get(hood)!.activity.motion().center;
    demo.advance(1 / 240, neutral);
  }
  assert.ok(demo.impactSpeed > 10);
  assert.equal(hood.parent, undefined);
  assert.ok(demo.panel.mounts.every(m => m.broken));
  assert.ok(demo.soft.get(hood)!.activity.motion().center.distanceTo(beforeRelease) < 0.5, `breaking mounts must not teleport the whole panel: ${demo.soft.get(hood)!.activity.motion().center.distanceTo(beforeRelease)}`);
  const center = new Vector3(), velocity = new Vector3(), nodes = demo.panel.positions.length / 3;
  for (let i = 0; i < demo.panel.positions.length; i += 3) {
    center.add(new Vector3().fromArray(demo.panel.positions, i));
    velocity.add(new Vector3().fromArray(demo.panel.velocities, i));
  }
  center.divideScalar(nodes); velocity.divideScalar(nodes);
  const outward = center.clone().sub(demo.body.position).normalize();
  const relative = velocity.sub(demo.body.pointVelocity(center)), separationSpeed = relative.dot(outward);
  assert.ok(separationSpeed > 0.5, `the released hood receives an outward velocity: ${separationSpeed}, center ${center.toArray()}, chassis ${demo.body.position.toArray()}`);
  assert.ok(relative.z < -0.5 && relative.length() < 1.6, `release follows the incoming -Z motion without an excessive kick: ${relative.toArray()}`);
  for (let i = 0; i < 6 * 240; i++) demo.advance(1 / 240, neutral);
  const landed = demo.soft.get(hood)!.activity.motion();
  assert.ok(landed.velocity.length() < 0.3 && landed.omega.length() < 0.3, 'a crashed hood eventually settles');
  world.dispose();
});


test('many contact points cannot launch one rigid detached panel upward', () => {
  const { world, demo } = setup();
  demo.disableObstacle();
  const body = new RigidBody3D(20, new Box3(new Vector3(-0.5, -0.1, -0.5), new Vector3(0.5, 0.1, 0.5)));
  body.setFrame(new Matrix4().makeTranslation(5, 0, 0));
  const points = new Float64Array(60);
  for (let i = 0; i < points.length; i += 3) { points[i] = 5 + (i % 5) * 0.05; points[i + 1] = -0.05; points[i + 2] = 0; }
  const before = body.position.y;
  (demo as unknown as { freeContacts(body: RigidBody3D, previous: Matrix4, obstacle: Box3, apply: boolean, shape: Float64Array): number }).freeContacts(body, body.matrix(), new Box3(new Vector3(100, 100, 100), new Vector3(101, 101, 101)), true, points);
  assert.ok(body.position.y - before < 0.05, `one shallow contact displaced the whole part by ${body.position.y - before} m`);
  world.dispose();
});

test('detached panel is not ejected by an overlapping chassis bounding box', () => {
  const { world, demo } = setup();
  demo.disableObstacle();
  const body = new RigidBody3D(20, new Box3(new Vector3(-0.3, -0.02, -0.3), new Vector3(0.3, 0.02, 0.3)));
  body.setFrame(new Matrix4().makeTranslation(0, 0.8, 0));
  const before = body.position.clone();
  (demo as unknown as { freeContacts(body: RigidBody3D, previous: Matrix4, obstacle: Box3, apply: boolean, shape: Float64Array): number }).freeContacts(body, body.matrix(), new Box3(new Vector3(100, 100, 100), new Vector3(101, 101, 101)), true, new Float64Array([0, 0.8, 0]));
  assert.ok(body.position.distanceTo(before) < 1e-10, 'only actual panel points and chassis triangles may cause contact');
  world.dispose();
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

test('a detached panel settles instead of gaining motion after landing', () => {
  const { world, demo, hood } = setup();
  demo.disableObstacle(); world.detach(hood);
  demo.panel.mounts.forEach(m => { m.broken = true; });
  for (let i = 0; i < demo.panel.positions.length; i += 3) { demo.panel.positions[i] += 5; demo.panel.positions[i + 1] += 3; }
  for (let i = 0; i < 6 * 240; i++) {
    demo.advance(1 / 240, neutral);
  }
  const activity = demo.soft.get(hood)!.activity, motion = activity.motion();
  assert.equal(activity.deforming, false);
  assert.ok(motion.velocity.length() < 0.1 && motion.omega.length() < 0.1 && motion.center.y < 0.1, `a grounded panel stays at rest: ${JSON.stringify({ velocity: motion.velocity.toArray(), omega: motion.omega.toArray(), center: motion.center.toArray() })}`);
  world.dispose();
});

test('bent chassis moves real attachment frames and suspension points, changing a straight drive', () => {
  const healthy = setup(), damaged = setup(), samples: number[] = [];
  for (const x of [-0.85, 0.85]) for (const y of [-0.6, 0.6]) for (const z of [-2.1, 2.1]) samples.push(x, y, z);
  for (const s of [healthy, damaged]) { s.demo.register(s.root, samples, []); s.demo.reset(); s.demo.obstacle.min[0] += 100; s.demo.obstacle.max[0] += 100; }
  const initialDoor = damaged.door.local.clone(), panel = damaged.demo.soft.get(damaged.root)!.panel, inverse = damaged.root.matrix().invert(), point = new Vector3();
  for (let i = 0; i < panel.positions.length; i += 3) {
    point.fromArray(panel.positions, i).applyMatrix4(inverse);
    point.z += 0.4 * (1 - (point.x + 0.85) / 1.7) * (1 - (point.z + 2.1) / 4.2);
    point.applyMatrix4(damaged.root.matrix()).toArray(panel.positions, i);
  }
  for (const s of [healthy, damaged]) s.demo.advance(1 / 240, neutral);
  assert.ok(damaged.demo.suspension.wheels[0].hardpoint.distanceTo(damaged.demo.suspension.wheels[0].originalHardpoint) > 0.25);
  assert.ok(damaged.demo.suspension.wheels[0].mountCondition < 0.1);
  assert.ok(!damaged.door.local.equals(initialDoor));
  for (let i = 0; i < 600; i++) for (const s of [healthy, damaged]) s.demo.advance(1 / 240, { ...neutral, throttle: 0.5 });
  assert.ok(healthy.demo.body.position.distanceTo(damaged.demo.body.position) > 0.05);
  damaged.demo.reset(); assert.ok(damaged.door.local.equals(initialDoor));
  assert.ok(damaged.demo.suspension.wheels.every(w => w.mountCondition === 1 && w.hardpoint.equals(w.originalHardpoint)));
  assert.throws(() => { damaged.root.condition = NaN; }, /condition/); assert.throws(() => { damaged.root.condition = -1; }, /condition/);
  healthy.world.dispose(); damaged.world.dispose();
});

test('alignment failure starts below 10 percent support health and zero-health panels detach', () => {
  const { world, demo, door } = setup(), damage = new Matrix4().makeRotationY(0.2);
  demo.suspension.deform(0, damage, 0.1); assert.ok(Math.abs(demo.suspension.wheels[0].damage.elements[2]) < 1e-10);
  demo.suspension.deform(0, damage, 0.05); assert.ok(Math.abs(demo.suspension.wheels[0].damage.elements[2]) > 0.05);
  door.condition = 0; demo.advance(1 / 240, neutral); assert.equal(door.parent, undefined);
  demo.reset(); assert.equal(door.condition, 1); assert.ok(door.parent); world.dispose();
});






