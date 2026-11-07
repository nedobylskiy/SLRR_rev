import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, BufferGeometry, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import {PanelView} from '../src/render/panel-view';
import { RigidBody3D, boxContact, orientedBoxContact } from '../src/engine/rigid-body-3d';
import { Vehicle3D } from '../src/engine/vehicle-3d';
import { EngineWorld } from '../src/engine/world';
import { parsePartConfig } from '../src/formats/cfg';
import { DeformablePanel } from '../src/engine/deformable-panel';

const neutral = { throttle: 0, steer: 0, brake: false };
function setup(mechanical = false, terrain?: ConstructorParameters<typeof Vehicle3D>[4]) {
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
  const demo = new Vehicle3D(root, hood, samples, new Box3(new Vector3(-0.85, -0.55, -2.1), new Vector3(0.85, 0.6, 2.1)), terrain);
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

test('route inputs run once per fixed tick and assembly export excludes animated local travel',()=>{
  const {demo,world,root}=setup(true),part=[...root.children.values()].find(p=>p.definition.mechanics?.kind==='suspension')!;
  const assembly=demo.assemblyLocal(part);part.local.makeTranslation(9,8,7);
  assert.deepEqual(demo.assemblyLocal(part),assembly);
  const times:number[]=[];
  demo.replayInput=time=>{times.push(time);return neutral;};
  demo.advance(4/240,{throttle:1,steer:1,brake:true});
  assert.equal(times.length,4);times.forEach((time,i)=>assert.ok(Math.abs(time-i/240)<1e-12));
  assert.equal(demo.simulationTime,4/240);assert.equal(demo.suspension.steer,0);
  demo.dispose();world.dispose();
});

test('recorded poses carry world-space panels before their first upload and subsequent rigid draws',()=>{
  for(const uploadFirst of [false,true]){
    const {demo,world,hood,root}=setup(true),samples=[-.7,.04,-.7,.7,.04,-.7,-.7,.04,.7,.7,.04,.7];
    const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(samples,3));geometry.computeVertexNormals();
    const group=new Group();group.matrixAutoUpdate=false;const material=new MeshBasicMaterial();group.add(new Mesh(geometry,material));
    const view=new PanelView(group,demo.panel,[samples]),initial=hood.matrix();
    if(uploadFirst)view.update(initial,true);
    const original=Array.from(geometry.getAttribute('position').array),clock=demo.simulationTime;
    for(let step=1;step<=3;step++){
      const next=new Matrix4().makeRotationY(.4*step).setPosition(20*step,3*step,-10*step);
      demo.body.setFrame(next);root.local.copy(next);demo.suspension.sync();demo.syncRecordedPose();
      view.update(hood.matrix(),true);
      const delta=hood.matrix().multiply(initial.clone().invert());
      for(let i=0;i<original.length;i+=3){
        const expected=new Vector3().fromArray(original,i).applyMatrix4(delta);
        const actual=new Vector3().fromBufferAttribute(geometry.getAttribute('position'),i/3).applyMatrix4(group.matrix);
        assert.ok(actual.distanceTo(expected)<1e-4,`panel follows recorded frame (initial upload: ${uploadFirst})`);
      }
      assert.ok(demo.soft.get(hood)!.activity.frame.equals(hood.matrix()));
      assert.equal(demo.simulationTime,clock,'render replay must not advance vehicle physics');
    }
    view.dispose();geometry.dispose();material.dispose();demo.dispose();world.dispose();
  }
});

test('checkpoint restore precedes physics frame capture and does not create a teleport impact',()=>{
  const {demo,root,world}=setup(true);demo.disableObstacle();
  const target=new Matrix4().makeRotationY(.7).setPosition(30,50,-20);
  const expectedCenter=demo.body.center.clone().applyMatrix4(target);
  demo.beforeReplayTick=time=>{if(time!==0)return;demo.body.setFrame(target);root.local.copy(target);demo.syncRecordedPose();};
  demo.advance(1/240,neutral);
  assert.ok(demo.body.position.distanceTo(expectedCenter)<.001,'restored frame is used for this tick');
  assert.equal(root.condition,1);assert.ok([...demo.soft.values()].every(s=>!s.activity.deforming));
  assert.equal(demo.impactSpeed,0);assert.equal(demo.timings.activePanels,0);
  demo.dispose();world.dispose();
});

test('10–20 FPS and 150–200 ms frames keep physics at real time with the same fixed-tick trajectory',()=>{
  const reference=setup(true);reference.demo.disableObstacle();
  for(let tick=0;tick<288;tick++)reference.demo.advance(1/240,neutral);
  for(const duration of [.05,.1,.15,.2]){
    const state=setup(true);state.demo.disableObstacle();
    for(let frame=0;frame<Math.round(1.2/duration);frame++){
      const result=state.demo.advance(duration,neutral);
      assert.equal(result.backlogTicks,0,`frame ${duration}s must not hit the old 8-tick cap`);
    }
    assert.ok(Math.abs(state.demo.simulationTime-1.2)<1e-12);
    assert.ok(Math.abs(state.demo.simulationTargetSeconds-1.2)<1e-12);
    assert.ok(state.demo.body.position.distanceTo(reference.demo.body.position)<1e-10);
    assert.ok(state.demo.body.orientation.angleTo(reference.demo.body.orientation)<1e-7);
    for(const [part,soft] of state.demo.soft){
      const other=[...reference.demo.soft.values()].find(s=>s.part.definition.alias===part.definition.alias)!;
      for(let i=0;i<soft.panel.positions.length;i++)assert.ok(Math.abs(soft.panel.positions[i]-other.panel.positions[i])<1e-10);
    }
    state.demo.dispose();state.world.dispose();
  }
  reference.demo.dispose();reference.world.dispose();
});

test('a long foreground stall retains bounded catch-up debt without losing simulation time',()=>{
  const {demo,world}=setup(true);demo.disableObstacle();
  const frame=demo.advance(.6,neutral);
  assert.equal(frame.steps,64);assert.equal(frame.backlogTicks,80);
  assert.ok(Math.abs(demo.simulationTargetSeconds-.6)<1e-12);
  assert.ok(Math.abs(demo.simulationPendingSeconds-80/240)<1e-12);
  assert.equal(demo.advance(0,neutral).backlogTicks,16);
  assert.equal(demo.advance(0,neutral).backlogTicks,0);
  assert.ok(Math.abs(demo.simulationTime-.6)<1e-12);
  assert.ok(demo.simulationPendingSeconds<1e-12);
  demo.reset();assert.equal(demo.maxPhysicsSteps,64);assert.equal(demo.simulationTime,0);assert.equal(demo.simulationTargetSeconds,0);
  demo.dispose();world.dispose();
});

test('driving and active body deformation are invariant to terrain elevation below zero', () => {
  const createAt = (elevation: number) => {
    const state = setup(false, { ramp: false, height: (_x, z) => elevation + z * 0.04, normal: () => new Vector3(0, 1, -0.04).normalize() });
    const samples: number[] = [];
    for (const x of [-0.85, 0.85]) for (const y of [-0.55, 0.6]) for (const z of [-2.1, 2.1]) samples.push(x, y, z);
    state.demo.register(state.root, samples, []); state.demo.disableObstacle();
    state.demo.placeAt(new Vector3(0, elevation, 0), 0); state.demo.body.velocity.z = -6;
    state.demo.panel.hit(1); // Exercise XPBD as well as the sleeping/carry path.
    return state;
  };
  const above = createAt(10), below = createAt(-10);
  for (let tick = 0; tick < 480; tick++) {
    above.demo.advance(1 / 240, neutral); below.demo.advance(1 / 240, neutral);
    for (const [part, state] of above.demo.soft) {
      const counterpart = [...below.demo.soft.values()].find(s => s.part.definition.alias === part.definition.alias)!;
      assert.equal(!!counterpart.part.parent, !!part.parent, 'elevation cannot release mounts');
      assert.ok(Math.abs(counterpart.part.condition - part.condition) < 1e-7);
      for (let i = 0; i < state.panel.positions.length; i++)
        assert.ok(Math.abs(state.panel.positions[i] - counterpart.panel.positions[i] - (i % 3 === 1 ? 20 : 0)) < 1e-5, `node ${i} at tick ${tick}`);
    }
  }
  assert.ok(below.hood.parent && below.door.parent);
  assert.ok(below.demo.body.position.y < 0);
  above.world.dispose(); below.world.dispose();
});

test('a detached panel lands on the map surface below zero rather than an implicit zero plane', () => {
  const { world, demo, hood } = setup(false, { ramp: false, height: () => -8, normal: () => new Vector3(0, 1, 0) });
  demo.disableObstacle(); demo.placeAt(new Vector3(0, -8, 0), 0);
  world.detach(hood); demo.panel.mounts.forEach(m => { m.broken = true; });
  for (let i = 0; i < demo.panel.positions.length; i += 3) { demo.panel.positions[i] += 5; demo.panel.positions[i + 1] += 2; }
  for (let tick = 0; tick < 4 * 240; tick++) demo.advance(1 / 240, neutral);
  const center = demo.soft.get(hood)!.activity.motion().center;
  assert.ok(center.y < -7.8 && center.y > -8, `panel landed at ${center.y}`);
  world.dispose();
});

test('attached deformation defers whole-body collision skinning until a part comes loose', () => {
  const { world, root, lamp, demo } = setup();
  demo.disableObstacle();
  const triangles = [-0.8, -0.5, -2, 0.8, -0.5, -2, 0.8, 0.6, 2];
  const samples: number[] = [];
  for (const x of [-0.85, 0.85]) for (const y of [-0.55, 0.6]) for (const z of [-2.1, 2.1]) samples.push(x, y, z);
  demo.register(root, samples, triangles); demo.setBodyTriangles(triangles); demo.reset();
  const panel = demo.soft.get(root)!.panel;
  const collision = demo as unknown as { updateSurface(): void }, update = collision.updateSurface.bind(demo);
  let rebuilds = 0;
  collision.updateSurface = () => { rebuilds++; update(); };
  let solves = 0;
  for (let i = 0; i < 120; i++) {
    for (const part of demo.soft.values()) part.activity.wake();
    demo.advance(1 / 240, neutral); solves += demo.timings.activePanels;
  }
  assert.ok(solves >= 120, 'the real deformation solver remains active');
  assert.ok([...demo.soft.values()].every(part => part.root || part.part.parent));
  assert.equal(rebuilds, 0, 'attached panels do not consume the collision mesh');
  lamp.condition = 0; demo.advance(1 / 240, neutral);
  assert.equal(lamp.parent, undefined);
  assert.ok(rebuilds > 0, 'release builds current deformed collision geometry immediately');
  const atRelease = rebuilds;
  for (let i = 0; i < 12; i++) { panel.impulseAt([0.01, 0, 0], [0, 1, 0]); demo.advance(1 / 240, neutral); }
  assert.ok(rebuilds > atRelease, 'loose rigid parts keep receiving refreshed body geometry');
  world.dispose();
});

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
  let collisionCueSeen = false;
  let firstCue = -1, firstPanel = -1;
  for (let i = 0; i < 2 * 240; i++) { demo.advance(1 / 240, neutral); collisionCueSeen ||= !!demo.collisionCue; if (firstCue < 0 && demo.collisionCue) firstCue = i; if (firstPanel < 0 && [...demo.soft.values()].some(s => s.panel.contacts > 0)) firstPanel = i; }
  assert.equal(firstCue, firstPanel, 'collision audio starts with the first panel contact');
  assert.ok(demo.impactSpeed > 3, 'the chassis reached the obstacle');
  assert.ok(collisionCueSeen, 'a solid contact emits an audio collision cue');
  assert.ok(root.condition < 1 && root.condition > 0.9, `chassis condition ${root.condition}`);
  assert.ok(hood.condition > 0.6, `hood condition ${hood.condition}; mounts ${demo.panel.mounts.map(m => `${m.broken}:${Math.round(m.force)}`).join(',')}; root ${root.condition}; door ${door.condition}`);
  assert.ok(door.condition > 0.6, `door condition ${door.condition}`);
  assert.equal(hood.parent, root);
  assert.ok(demo.panel.mounts.every(m => !m.broken));
  world.dispose();
});

test('chassis crumple control changes the same 50 km/h impact without changing body parts', () => {
  const { world, root, demo } = setup();
  const shell: number[] = [];
  for (const x of [-0.85, 0.85]) for (const y of [-0.55, 0.6]) for (const z of [-2.1, 2.1]) shell.push(x, y, z);
  demo.register(root, shell, []);
  const dent = (value: number) => {
    demo.setChassisCrumple(value); demo.reset(50 / 3.6);
    for (let i = 0; i < 2 * 240; i++) demo.advance(1 / 240, neutral);
    const panel = demo.soft.get(root)!.panel;
    let maximum = 0;
    for (let i = 0; i < panel.positions.length; i += 3) maximum = Math.max(maximum, Math.hypot(...[0, 1, 2].map(axis => panel.positions[i + axis] - panel.rest[i + axis])));
    return maximum;
  };
  const firmer = dent(0.7), softer = dent(1.3);
  assert.ok(softer > firmer * 1.1, `softer chassis ${softer.toFixed(3)} m, firmer ${firmer.toFixed(3)} m`);
  assert.throws(() => demo.setChassisCrumple(2));
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

test('released panel nodes cannot sink deeper through their original chassis side', () => {
  const { world, root, hood, demo } = setup();
  const shell: number[] = [];
  for (const x of [-0.85, 0.85]) for (const y of [-0.55, 0.6]) for (const z of [-2.1, 2.1]) shell.push(x, y, z);
  demo.register(root, shell, []); demo.reset(50 / 3.6);
  for (let i = 0; i < 2 * 240 && hood.parent; i++) demo.advance(1 / 240, neutral);
  const state = demo.soft.get(hood)!, guard = state.guard;
  assert.ok(guard && guard.axis === 1 && guard.sign === 1);
  for (let i = 1; i < state.panel.velocities.length; i += 3) state.panel.velocities[i] -= 3;
  let guardedTicks = 0;
  for (let tick = 0; tick < 24; tick++) {
    demo.advance(1 / 240, neutral);
    if (!state.guard) break;
    guardedTicks++;
    const inverse = demo.body.matrix().invert();
    for (let n = 0; n < state.panel.positions.length; n += 3) {
      const local = new Vector3().fromArray(state.panel.positions, n).applyMatrix4(inverse);
      assert.ok(state.guard.minimum[n / 3] - state.guard.sign * local.getComponent(state.guard.axis) < 0.15, 'a detached node remains on its release side');
    }
  }
  assert.ok(guardedTicks > 5);
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

test('supported debris sleeps without repeated rigid solves and wakes for an external impulse', () => {
  const { world, demo, hood } = setup();
  demo.disableObstacle(); world.detach(hood); demo.panel.mounts.forEach(m => { m.broken = true; });
  for (let i = 0; i < demo.panel.positions.length; i += 3) { demo.panel.positions[i] += 5; demo.panel.positions[i + 1] += 2; }
  const state = demo.soft.get(hood)!;
  for (let tick = 0; tick < 6 * 240 && !state.activity.resting; tick++) demo.advance(1 / 240, neutral);
  assert.equal(state.activity.resting, true);
  const positions = demo.panel.positions.slice(), carry = demo.panel.advanceRigid.bind(demo.panel);
  let carries = 0;
  demo.panel.advanceRigid = (...args) => { carries++; return carry(...args); };
  for (let tick = 0; tick < 120; tick++) demo.advance(1 / 240, neutral);
  assert.equal(carries, 0, 'sleeping debris skips contact integration and rigid node carry');
  assert.deepEqual(demo.panel.positions, positions);
  state.activity.freeBody!.impulse(new Vector3(20, 100, 0));
  demo.advance(1 / 240, neutral);
  assert.equal(state.activity.resting, false); assert.ok(carries > 0);
  assert.notDeepEqual(demo.panel.positions, positions);
  world.dispose();
});

test('a moving chassis wakes sleeping debris in its swept bounds', () => {
  const { world, demo, hood } = setup();
  demo.disableObstacle(); world.detach(hood); demo.panel.mounts.forEach(m => { m.broken = true; });
  for (let i = 0; i < demo.panel.positions.length; i += 3) { demo.panel.positions[i] += 5; demo.panel.positions[i + 1] += 2; }
  const state = demo.soft.get(hood)!;
  for (let tick = 0; tick < 6 * 240 && !state.activity.resting; tick++) demo.advance(1 / 240, neutral);
  assert.equal(state.activity.resting, true);
  const center = state.activity.freeBody!.position;
  demo.body.position.copy(center).add(new Vector3(0, 0.1, 0)); demo.body.velocity.set(0, 0, -6);
  const carry = demo.panel.advanceRigid.bind(demo.panel);
  let carries = 0;
  demo.panel.advanceRigid = (...args) => { carries++; return carry(...args); };
  demo.advance(1 / 240, neutral);
  assert.ok(carries > 0 || state.activity.deforming, 'approaching chassis reactivates contact handling');
  world.dispose();
});

test('slow debris uses fewer terrain probes with the same contact response as unconditional probing', () => {
  let referenceQueries = 0, optimizedQueries = 0;
  const create = (reference: boolean) => {
    const state = setup(false, { ramp: false, height: () => { if (reference) referenceQueries++; else optimizedQueries++; return 0; }, normal: () => new Vector3(0, 1, 0) });
    state.demo.disableObstacle(); state.world.detach(state.hood); state.demo.panel.mounts.forEach(m => { m.broken = true; });
    for (let i = 0; i < state.demo.panel.positions.length; i += 3) { state.demo.panel.positions[i] += 5; state.demo.panel.positions[i + 1] += 2; }
    const activity = state.demo.soft.get(state.hood)!.activity;
    for (let tick = 0; tick < 6 * 240 && !activity.resting; tick++) state.demo.advance(1 / 240, neutral);
    assert.ok(activity.resting);
    activity.freeBody!.velocity.set(0.2, 0, 0);
    return state;
  };
  const reference = create(true), optimized = create(false);
  (reference.demo as unknown as { freeContactSpeedBound(): number }).freeContactSpeedBound = () => Infinity;
  referenceQueries = optimizedQueries = 0;
  for (let tick = 0; tick < 60; tick++) {
    for (const state of [reference, optimized]) { state.demo.soft.get(state.hood)!.activity.resting = false; state.demo.advance(1 / 240, neutral); }
    for (let i = 0; i < reference.demo.panel.positions.length; i++)
      assert.ok(Math.abs(reference.demo.panel.positions[i] - optimized.demo.panel.positions[i]) < 1e-8);
  }
  assert.ok(optimizedQueries < referenceQueries * 0.75, `${optimizedQueries} vs ${referenceQueries} terrain queries`);
  reference.world.dispose(); optimized.world.dispose();
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






