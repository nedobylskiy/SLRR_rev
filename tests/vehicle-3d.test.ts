import { MapCollision } from '../src/engine/map-collision';
import type { ScxModel } from '../src/formats/scx';
import { validateVehicleDamage } from '../src/engine/vehicle-damage';
import {keyboardDrivingInput} from '../src/engine/driving-demo';
import {PlayerTrafficDriver} from '../src/engine/player-traffic-driver';
import {TrafficControl} from '../src/engine/traffic-control';
import type {RoadNetwork,RoadPoint,RoadSegment} from '../src/formats/trc';
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
test('player traffic driver follows the graph with a full car through its normal solver',()=>{
  const {demo,world}=setup(false);demo.disableObstacle();
  const segment=(start:RoadPoint,end:RoadPoint):RoadSegment=>{const tangent=end.map((n,i)=>n-start[i]) as RoadPoint;return {start,end,startTangent:tangent,endTangent:tangent,length:Math.hypot(...tangent),raw:new Uint32Array(14),flag:0};};
  const graph:RoadNetwork={version:1,bytes:0,paths:[],others:[{id:2,refs:[10,0],raw:new Uint32Array(12),extraRefs:[],tail:new Uint32Array(3),flag:0,segments:[segment([0,0,-200],[0,0,0])]},{id:3,refs:[20,0],raw:new Uint32Array(12),extraRefs:[],tail:new Uint32Array(3),flag:0,segments:[segment([0,0,-400],[0,0,-202])]}],nodes:[{id:1,group:1,position:[0,0,-200],links:[{target:2,flag:1},{target:3,flag:0}],raw:new Uint32Array(4),lanes:[{header:new Uint8Array(12),segment:segment([0,0,-202],[0,0,-200])}]}]};
  const driver=new PlayerTrafficDriver(demo,graph,new TrafficControl(graph,[])),before=demo.body.position.clone();
  driver.sample(demo.physicsDt,[]);assert.ok(demo.body.position.equals(before),'sampling does not integrate or teleport');
  demo.controlInput=dt=>driver.sample(dt,[]);
  for(let i=0;i<300;i++)demo.advance(1/60,neutral);
  assert.ok(demo.body.position.z<before.z-2,`driven position ${demo.body.position.z}`);
  demo.controlInput=undefined;world.dispose();
});
test('a driver input provider runs on the existing physics clock and can be removed without resetting the car',()=>{
  const {demo,world}=setup();let calls=0,elapsed=0;
  demo.controlInput=dt=>{calls++;elapsed+=dt;return {throttle:.2,steer:0,brake:false};};
  demo.advance(4*demo.physicsDt,neutral);
  assert.equal(calls,4);assert.ok(Math.abs(elapsed-4*demo.physicsDt)<1e-9);
  const position=demo.body.position.clone(),velocity=demo.body.velocity.clone();demo.controlInput=undefined;
  assert.ok(demo.body.position.equals(position));assert.ok(demo.body.velocity.equals(velocity));
  demo.advance(demo.physicsDt,neutral);assert.equal(calls,4);world.dispose();
});
function setup(mechanical = false, terrain?: ConstructorParameters<typeof Vehicle3D>[4],frequency=240,mapCollision?:MapCollision,withBumper=false) {
  const world = new EngineWorld(), slots = [101, 102, 103, 104].map((type, i) => `slot 0 0 0 0 0 0 ${20 + i}\nslottype ${type}`).join('\n');
  const wheels = [[-0.7, -1.3], [0.7, -1.3], [-0.7, 1.3], [0.7, 1.3]].map(([x, z], i) => `type 10 sphere 0.3\nspring 0.29 0.1 0.05\nwheel ${x} -0.6 ${z} 0 0 0 ${i < 2 ? 1 : 0} 0 1 0`).join('\n');
  const create = (id: number, file: string, cfg: string) => world.create({ key: { pack: 'test.rpk', id }, alias: file, cfgPath: file, config: parsePartConfig(cfg) });
  const root = create(1, 'car.cfg', `body 0 -0.2 0 0 0 0 1000 sphere 1\n${wheels}\n${slots}\nslot 0 0.21 -0.807 0 0 0 601\nslot -0.8 0 0 0 0 0 602\nslot 0.5 0.05 -2.35 0 0 0 603`);
  for (let i = 0; i < 4; i++) world.install(root, 20 + i, create(i + 2, 'wheel.cfg', 'slot 0 0 0 0 0 0 1'), 1);
  const hood = create(6, 'hood.cfg', 'slot 0 0.191 0.696 0 0 0 601\nbody 0 0 0 0 0 0 38.5 sphere 1'); world.install(root, 601, hood, 601);
  const door = create(7, 'door.cfg', 'slot 0 0 0 0 0 0 1\nbody 0 0 0 0 0 0 15 sphere 1'); world.install(root, 602, door, 1);
  const lamp = create(8, 'headlights.cfg', 'slot 0 0 0 0 0 0 1\nbody 0 0 0 0 0 0 1 sphere 0.2'); world.install(root, 603, lamp, 1);
  let bumper:ReturnType<typeof create>|undefined;
  if(withBumper){
    root.definition.config.slots.push({id:604,position:[0,0,-2.25],rotation:[0,0,0],attach:[],compatible:[]});
    bumper=create(9,'front_bumper.cfg','slot 0 0 0 0 0 0 1\nbody 0 0 0 0 0 0 18 sphere 1');world.install(root,604,bumper,1);
  }
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
  const demo = new Vehicle3D(root, hood, samples, new Box3(new Vector3(-0.85, -0.55, -2.1), new Vector3(0.85, 0.6, 2.1)), terrain,mapCollision,frequency);
  const box = (x: number, y: number, z: number) => { const a: number[] = []; for (const px of [-x, x]) for (const py of [-y, y]) for (const pz of [-z, z]) a.push(px, py, pz); return a; };
  demo.register(door, box(0.04, 0.4, 0.6), []); demo.register(lamp, box(0.15, 0.15, 0.15), []); if(bumper)demo.register(bumper,box(.7,.14,.1),[]); demo.reset();
  if (mechanical) {
    for (const wheel of demo.suspension.wheels) demo.register(wheel.part, box(0.3, 0.3, 0.1), []);
    demo.register(block!, box(0.3, 0.3, 0.3), []);
    demo.register(crank!, box(0.2, 0.2, 0.2), []);
    demo.reset();
  }
  return { world, root, hood, door, lamp, demo, struts, sway, block, crank,bumper };
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

test('vehicle disposal restores a live assembly and does not reinstall parts into a disposed world',()=>{
  const {world,root,hood,demo}=setup();
  world.detach(hood);demo.panel.mounts.forEach(m=>m.broken=true);
  demo.dispose();assert.equal(hood.parent,root,'normal stand teardown restores the live assembly');
  world.dispose();assert.doesNotThrow(()=>demo.dispose());assert.doesNotThrow(()=>demo.dispose());
  assert.equal(world.parts.size,0,'late teardown cannot resurrect disposed parts');
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
  assert.ok(landed.velocity.length() < 0.3 && landed.omega.length() < 0.3, `a crashed hood eventually settles: speed ${landed.velocity.length()}, spin ${landed.omega.length()}`);
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

test('ground support resists detached-panel twisting without damping airborne rotation', () => {
  const { world, demo } = setup(); demo.disableObstacle();
  const obstacle = new Box3(new Vector3(100,100,100), new Vector3(101,101,101));
  const solve = (x: number, y: number) => {
    const body = new RigidBody3D(20, new Box3(new Vector3(-.5,-.01,-.5), new Vector3(.5,.01,.5)));
    body.setFrame(new Matrix4().makeTranslation(x,y,0));
    body.velocity.set(0,-.1,0); body.setAngularVelocity(new Vector3(0,3,0));
    const points = new Float64Array(body.corners().flatMap(p=>p.toArray()));
    (demo as unknown as { freeContacts(body: RigidBody3D, previous: Matrix4, obstacle: Box3, apply: boolean, shape: Float64Array): unknown }).freeContacts(body,body.matrix(),obstacle,true,points);
    return body.omega.y;
  };
  const grounded = solve(10,.009);
  assert.ok(grounded>=0 && grounded<3,'a supported patch dissipates spin without reversing it');
  assert.ok(Math.abs(solve(100000,.009)-grounded)<1e-8,'friction is independent of world-coordinate magnitude');
  assert.equal(solve(10,2),3,'there is no artificial spin damping in flight');
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
  // A weak tap is now recoverable; use a strong strike to exercise permanent dents.
  demo.panel.hit(400); demo.advance(1 / 240, neutral);
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








test('sleeping detached panels do not request collision-surface refits while attached panels deform',()=>{
  const {world,root,demo,hood,door}=setup();demo.disableObstacle();
  const triangles=[-.8,-.5,-2,.8,-.5,-2,.8,.6,2];
  const samples:number[]=[];for(const x of [-.85,.85])for(const y of [-.55,.6])for(const z of [-2.1,2.1])samples.push(x,y,z);
  demo.register(root,samples,triangles);demo.setBodyTriangles(triangles);demo.reset();
  world.detach(hood);demo.panel.mounts.forEach(m=>m.broken=true);
  for(let i=0;i<demo.panel.positions.length;i+=3){demo.panel.positions[i]+=5;demo.panel.positions[i+1]+=2;}
  const state=demo.soft.get(hood)!;
  for(let tick=0;tick<6*240&&!state.activity.resting;tick++)demo.advance(1/240,neutral);
  assert.ok(state.activity.resting);
  const geometry=demo as unknown as {updateSurface():void},update=geometry.updateSurface.bind(demo);let refits=0;
  geometry.updateSurface=()=>{refits++;update();};
  const positions=demo.panel.positions.slice();
  for(let tick=0;tick<120;tick++){demo.soft.get(door)!.activity.wake();demo.advance(1/240,neutral);}
  assert.equal(refits,0,'no awake loose consumer needs the current body triangle mesh');
  assert.deepEqual(demo.panel.positions,positions);
  state.activity.freeBody!.impulse(new Vector3(20,100,0));demo.advance(1/240,neutral);
  assert.ok(refits>0,'waking debris receives fresh body geometry before its contact queries');
  world.dispose();
});


test('recording aggregates profiled panel phases across every fixed substep and exports actual vehicle CPU frames',()=>{
  const {demo,world,hood}=setup(true);demo.disableObstacle();demo.panel.hit(20);
  demo.telemetry.start();demo.advance(4/240,neutral);
  assert.equal(demo.timings.ticks,4);assert.ok(demo.timings.activePanels>=4);
  assert.ok(demo.timings.panelConstraints>0);assert.ok(demo.timings.panelContacts>0);assert.ok(demo.timings.nodeSteps>=4*demo.panel.positions.length/3);
  demo.telemetry.recordPerformanceFrame(100,{'Render callback CPU':25},false,{stream_matrices_written_count:7,hiz_collect_ms:2});demo.telemetry.stop();
  const line=demo.telemetry.text().split('\n').find(l=>l.startsWith('SLRR_FRAME|v=1|'))!;
  const row=JSON.parse(line.slice('SLRR_FRAME|v=1|'.length));assert.equal(row.physics_ticks,4);assert.equal(row.constraints_ms,demo.timings.panelConstraints);assert.equal(row.active_panel_steps,demo.timings.activePanels);
  assert.equal(row.suspension_height_count,16);assert.ok(row.suspension_height_ms>=0);
  assert.equal(demo.suspension.terrain.queryProfile,undefined,'query scope restored after suspension calls');
  assert.equal(row.stream_matrices_written_count,7);assert.equal(row.hiz_collect_ms,2);
  assert.deepEqual(demo.suspension.workProfile.drain(),{});
  assert.equal(row.wasm_panels+row.ts_panels,demo.soft.size);assert.equal(row.cpu_render_callback_cpu_ms,25);
  demo.advance(1/240,neutral);assert.equal(demo.timings.panelConstraints,0,'no detailed timers when recording is off');
  world.dispose();
});


test('detaching body geometry keeps the existing collision BVH and disables its triangle slots',()=>{
  const {demo,world,root,door}=setup();const triangle=[-.8,-.5,-2,.8,-.5,-2,.8,.6,2];
  const samples:number[]=[];for(const x of [-.85,.85])for(const y of [-.55,.6])for(const z of [-2.1,2.1])samples.push(x,y,z);
  demo.register(root,samples,triangle);demo.register(door,samples,triangle);demo.setBodyTriangles([...triangle,...triangle]);
  const original=demo.bodySurface!,update=()=>{(demo as unknown as {updateSurface():void}).updateSurface();};
  update();assert.equal(demo.bodySurface,original);const tree=(original as any).tree;
  world.detach(door);update();assert.equal(demo.bodySurface,original);assert.equal((original as any).tree,tree);
  assert.equal(original.coordinateLength,18);assert.equal(demo.timings.surfaceBuilds,0);assert.equal(demo.timings.surfaceRefits,2);
  assert.equal((original as any).faces.filter((f:any)=>f.active).length,1,'only the connected chassis triangle remains active');
  world.dispose();
});


test('collision skin cache survives rigid motion and updates only changed part ranges, including removal and restoration',()=>{
  const {demo,world,root,door}=setup();const triangle=[-.8,-.5,-2,.8,-.5,-2,.8,.6,2];
  const samples:number[]=[];for(const x of [-.85,.85])for(const y of [-.55,.6])for(const z of [-2.1,2.1])samples.push(x,y,z);
  demo.register(root,samples,triangle);demo.register(door,samples,triangle);demo.setBodyTriangles([...triangle,...triangle]);
  const chassis=demo.soft.get(root)!.panel,side=demo.soft.get(door)!.panel,skinRoot=chassis.skin.bind(chassis),skinDoor=side.skin.bind(side);
  let rootCalls=0,doorCalls=0;chassis.skin=(...args)=>{rootCalls++;skinRoot(...args);};side.skin=(...args)=>{doorCalls++;skinDoor(...args);};
  const update=()=>{(demo as unknown as {updateSurface():void}).updateSurface();};
  update();assert.equal(rootCalls,3);assert.equal(doorCalls,3);update();assert.equal(rootCalls,3);assert.equal(doorCalls,3);
  root.local.makeRotationY(.7).setPosition(20,2,-30);demo.body.setFrame(root.matrix());demo.syncRecordedPose();update();
  assert.equal(rootCalls,3,'whole-car translation/rotation must not skin cached local geometry');assert.equal(doorCalls,3);
  const geometry=(demo as unknown as {geometry:{part:typeof root;bindings:any[]}[];surfaceCoordinates:number[]});
  const expected=[0,0,0];skinRoot(geometry.geometry.find(g=>g.part===root)!.bindings[0],expected);
  const localPoint=new Vector3().fromArray(expected).applyMatrix4(root.matrix().invert());
  assert.ok(localPoint.distanceTo(new Vector3().fromArray(geometry.surfaceCoordinates))<1e-10,'cached coordinates match an explicit rotated world-space skin');
  door.local.elements[12]+=.1;demo.syncRecordedPose();update();assert.equal(rootCalls,3);assert.equal(doorCalls,6);assert.equal(demo.bodySurface!.lastRefitTriangles,1);
  chassis.positions[0]-=.2;chassis.shapeVersion++;update();assert.equal(rootCalls,6);assert.equal(doorCalls,6);assert.equal(demo.bodySurface!.lastRefitTriangles,1);
  world.detach(door);update();assert.equal(doorCalls,6);assert.equal(demo.bodySurface!.lastRefitTriangles,1);
  world.install(root,602,door,1);demo.syncRecordedPose();update();assert.equal(doorCalls,9,'restored geometry must be regenerated');
  demo.reset();update();assert.ok(rootCalls>6,'reset invalidates the cache');world.dispose();
});


test('120 Hz vehicle keeps all soft panels in step, preserves its rate on reset and retains bounded time debt',()=>{
  const {demo,world}=setup(false,undefined,120);demo.disableObstacle();
  assert.equal(demo.physicsDt,1/120);assert.equal(demo.maxPhysicsSteps,32);
  for(const s of demo.soft.values())assert.equal(s.panel.clock.frequency,120);
  demo.advance(1/60,neutral);assert.equal(demo.timings.ticks,2);
  for(const s of demo.soft.values())assert.equal(s.panel.clock.tick,2);
  demo.reset();assert.equal(demo.clock.frequency,120);for(const s of demo.soft.values())assert.equal(s.panel.clock.frequency,120);
  const result=demo.advance(.6,neutral);assert.equal(result.steps,32);assert.equal(result.backlogTicks,40);
  assert.equal(demo.advance(0,neutral).backlogTicks,8);assert.equal(demo.advance(0,neutral).backlogTicks,0);
  assert.ok(Math.abs(demo.simulationTime-.6)<1e-12);world.dispose();
});

test('120 Hz collision simulation has the same fixed-step trajectory at different render cadences',()=>{
  const a=setup(false,undefined,120),b=setup(false,undefined,120);
  a.demo.reset(15);b.demo.reset(15);
  for(let i=0;i<180;i++)a.demo.advance(2/120,neutral);
  for(let i=0;i<90;i++)b.demo.advance(4/120,neutral);
  assert.ok(a.demo.body.position.distanceTo(b.demo.body.position)<1e-10);
  assert.ok(a.demo.body.velocity.distanceTo(b.demo.body.velocity)<1e-10);
  for(const [part,state] of a.demo.soft){const other=[...b.demo.soft.values()].find(s=>s.part.definition.alias===part.definition.alias)!;assert.deepEqual(state.panel.positions,other.panel.positions);}
  a.world.dispose();b.world.dispose();
});

test('120 Hz keeps collision-geometry refresh cadence at 60 Hz',()=>{
  const {demo,root,world,hood,door}=setup(false,undefined,120);demo.disableObstacle();
  const triangles=[-.8,-.5,-2,.8,-.5,-2,.8,.6,2],samples:number[]=[];
  for(const x of [-.85,.85])for(const y of [-.55,.6])for(const z of [-2.1,2.1])samples.push(x,y,z);
  demo.register(root,samples,triangles);demo.setBodyTriangles(triangles);world.detach(hood);demo.panel.mounts.forEach(m=>m.broken=true);
  for(let i=0;i<demo.panel.positions.length;i+=3){demo.panel.positions[i]+=5;demo.panel.positions[i+1]+=10;}
  const internals=demo as unknown as {updateSurface():void},update=internals.updateSurface.bind(demo),ticks:number[]=[];
  internals.updateSurface=()=>{ticks.push(demo.clock.tick+1);update();};
  for(let i=0;i<12;i++){demo.soft.get(door)!.activity.wake();demo.soft.get(hood)!.activity.wake();demo.advance(1/120,neutral);}
  assert.deepEqual(ticks,[1,3,5,7,9,11]);world.dispose();
});

test('a 20cm spawn drop does not crumple the mounted hood at 120Hz',()=>{
  const {demo,world,hood}=setup(true,{ramp:false,height:()=>0,normal:()=>new Vector3(0,1,0)},120);
  demo.placeAt(new Vector3(0,0.2,0),0);
  const initial=demo.panel.positions.slice(),inverse=hood.matrix().invert();
  const rest=Array.from({length:initial.length/3},(_,i)=>new Vector3().fromArray(initial,i*3).applyMatrix4(inverse));
  let sag=0;
  for(let frame=0;frame<240;frame++){
    demo.advance(1/120,neutral);
    const local=hood.matrix().invert();
    for(let i=0;i<rest.length;i++)sag=Math.max(sag,rest[i].y-new Vector3().fromArray(demo.panel.positions,i*3).applyMatrix4(local).y);
  }
  assert.ok(sag<0.03,`hood sag after spawn settling: ${sag}m, damage ${demo.panel.permanentDamage}, plastic beams ${demo.panel.plasticBeams}`);
  assert.equal(hood.parent,demo.root);world.dispose();
});


test('spawn suspension initialization eliminates the visible drop without solving or damaging body panels',()=>{
  const {demo,world,hood}=setup(true,{ramp:false,height:()=>0,normal:()=>new Vector3(0,1,0)},120);
  demo.placeAt(new Vector3(0,0.2,0),0);
  const tick=demo.clock.tick;
  demo.settleSpawn();
  assert.equal(demo.clock.tick,tick,'initialization must not advance the recorded physics timeline');
  assert.equal(demo.panel.plasticBeams,0);assert.equal(hood.condition,1);
  assert.ok([...demo.soft.values()].every(state=>!state.activity.deforming));
  const height=demo.body.position.y;let movement=0;
  for(let i=0;i<120;i++){demo.advance(1/120,neutral);movement=Math.max(movement,Math.abs(demo.body.position.y-height));}
  assert.ok(movement<0.03,`remaining spawn settling ${movement}m`);
  assert.equal(demo.panel.plasticBeams,0);assert.equal(hood.condition,1);
  assert.ok(demo.suspension.wheels.every(w=>w.contact));world.dispose();
});

test('a small vertical hop keeps an attached hood elastic at 120Hz',()=>{
  const {demo,world,hood}=setup(true,{ramp:false,height:()=>0,normal:()=>new Vector3(0,1,0)},120);
  demo.settleSpawn();
  const inverse=hood.matrix().invert(),rest=Array.from({length:demo.panel.positions.length/3},(_,i)=>new Vector3().fromArray(demo.panel.positions,i*3).applyMatrix4(inverse));
  demo.body.velocity.y=1.5;
  let sag=0;
  for(let i=0;i<360;i++){
    demo.advance(1/120,neutral);const inverse=hood.matrix().invert();
    for(let j=0;j<rest.length;j++)sag=Math.max(sag,rest[j].y-new Vector3().fromArray(demo.panel.positions,j*3).applyMatrix4(inverse).y);
  }
  assert.ok(sag<0.15,`vertical hop hood sag ${sag}m, permanent damage ${demo.panel.permanentDamage}`);
  const finalFrame=hood.matrix().invert();
  const residual=Math.max(...rest.map((point,index)=>point.distanceTo(new Vector3().fromArray(demo.panel.positions,index*3).applyMatrix4(finalFrame))));
  assert.ok(residual<0.025,`hood must spring back after the hop, residual ${residual}m`);
  assert.ok(demo.panel.permanentDamage<0.001);assert.equal(hood.parent,demo.root);world.dispose();
});

test('landing on wheels after reset height does not permanently fold an untouched hood',()=>{
  const {demo,world,hood}=setup(true,{ramp:false,height:()=>0,normal:()=>new Vector3(0,1,0)},120);
  demo.placeAt(new Vector3(0,1,0),0);demo.disableObstacle();
  for(let i=0;i<480;i++)demo.advance(1/120,neutral);
  assert.ok(demo.panel.permanentDamage<0.001,`hood damage from wheel-only landing ${demo.panel.permanentDamage}`);
  assert.ok(hood.condition>0.99);assert.equal(hood.parent,demo.root);world.dispose();
});


test('suspension applies speed-dependent steering help only to button input',()=>{
  const helped=setup(),raw=setup(),analog=setup();
  for(const {demo} of [helped,raw,analog])demo.body.velocity.set(0,0,-100/3.6);
  helped.demo.suspension.helping.steer=1;analog.demo.suspension.helping.steer=1;
  for(let i=0;i<12;i++){
    helped.demo.suspension.step(1/120,{...neutral,steer:1,steerDigital:true});
    raw.demo.suspension.step(1/120,{...neutral,steer:1,steerDigital:true});
    analog.demo.suspension.step(1/120,{...neutral,steer:1,steerDigital:false});
  }
  assert.ok(helped.demo.suspension.steer<raw.demo.suspension.steer/3);
  assert.equal(analog.demo.suspension.steer,raw.demo.suspension.steer);
  for(const {world} of [helped,raw,analog])world.dispose();
});


test('ABS reduces service-brake locking without stopping handbrake operation',()=>{
  const raw=setup(true),helped=setup(true);
  for(const item of [raw,helped]){
    item.demo.settleSpawn();item.demo.suspension.mechanics!.manual=true;
    for(let i=0;i<4;i++)item.demo.suspension.mechanics!.corners[i].brake=item.struts[i];
    item.demo.body.velocity.set(0,0,-20);
    item.demo.suspension.wheels.forEach(w=>{w.omega=20/w.radius;});
  }
  helped.demo.suspension.helping.abs=1;
  const braking={...neutral,brake:true,serviceBrakeAxis:1};
  for(let step=0;step<120;step++)for(const {demo} of [raw,helped])demo.suspension.step(1/120,braking);
  const roadOmega=20/helped.demo.suspension.wheels[0].radius;
  const slowest=(demo:typeof raw.demo)=>Math.min(...demo.suspension.wheels.map(w=>w.omega));
  assert.ok(slowest(helped.demo)>slowest(raw.demo),`ABS wheel speed ${slowest(helped.demo)}, raw ${slowest(raw.demo)}`);
  assert.ok(slowest(helped.demo)>roadOmega*.8);
  for(let step=0;step<120;step++)helped.demo.suspension.step(1/120,keyboardDrivingInput(new Set(['Space'])));
  assert.ok(helped.demo.suspension.wheels.slice(0,2).every(w=>w.omega>roadOmega*.8),'Space leaves front wheels rolling');
  assert.ok(helped.demo.suspension.wheels.slice(2).some(w=>w.omega<roadOmega*.99),'handbrake still applies rear braking despite ABS');
  raw.world.dispose();helped.world.dispose();
});


test('handbrake applies at most 30 percent torque and preserves the analogue axis',()=>{
  const free=setup(true),half=setup(true),full=setup(true);
  for(const {demo,struts} of [free,half,full]){
    for(let i=0;i<4;i++)demo.suspension.mechanics!.corners[i].brake=struts[i];
    demo.body.position.y=10;demo.suspension.wheels.forEach(w=>w.omega=60);
  }
  for(const [item,axis] of [[free,0],[half,.5],[full,1]] as const)item.demo.suspension.step(1/120,{...neutral,serviceBrakeAxis:0,handbrakeAxis:axis});
  const loss=free.demo.suspension.wheels[2].omega-full.demo.suspension.wheels[2].omega;
  assert.ok(Math.abs(loss-950*.3/1.6/120)<1e-9,`full handbrake torque loss ${loss}`);
  const halfLoss=free.demo.suspension.wheels[2].omega-half.demo.suspension.wheels[2].omega;
  assert.ok(Math.abs(halfLoss-loss*.5)<1e-9);
  assert.equal(full.demo.suspension.wheels[0].omega,free.demo.suspension.wheels[0].omega);
  for(const {world} of [free,half,full])world.dispose();
});


test('damage survives JSON encoding, a different garage pose and a new physics session', () => {
  const restoredCar=()=>{
    const car=setup(true),samples:number[]=[];
    for(const x of [-.8,.8])for(const y of [-.5,.5])for(const z of [-2,2])samples.push(x,y,z);
    car.demo.register(car.root,samples,[-.8,-.5,-2,.8,-.5,-2,-.8,-.5,2]);car.demo.setBodyTriangles([-.8,-.5,-2,.8,-.5,-2,-.8,-.5,2]);return car;
  };
  const first=restoredCar(),panel=first.demo.soft.get(first.hood)!.panel;
  first.demo.placeAt(new Vector3(40,2,-30),0.6);
  panel.positions[7]-=0.18;panel.beams[0].rest*=0.83;
  panel.mounts[0].broken=true;panel.mounts[1].overload=0.012;
  first.hood.condition=0.65;first.root.condition=0.8;
  first.world.detach(first.door);first.door.condition=0;
  first.demo.suspension.deform(0,new Matrix4().makeTranslation(0.05,0.02,0),0.08);
  first.demo.body.velocity.set(12,0,0);
  for(const state of first.demo.soft.values())for(let i=0;i<state.panel.velocities.length;i+=3)
    first.demo.body.pointVelocity(new Vector3().fromArray(state.panel.positions,i)).toArray(state.panel.velocities,i);
  const saved=JSON.parse(JSON.stringify(first.demo.captureDamage()));validateVehicleDamage(saved);
  const second=restoredCar();second.demo.placeAt(new Vector3(-80,3,20),-1.2);
  second.demo.restoreDamage(saved);
  assert.equal(second.door.parent,undefined,'a detached part must not become installed again');
  assert.equal(second.hood.condition,0.65);assert.equal(second.root.condition,0.8);
  const restored=second.demo.soft.get(second.hood)!.panel;
  assert.equal(restored.beams[0].rest,panel.beams[0].rest);
  assert.equal(restored.mounts[0].broken,true);assert.equal(restored.mounts[1].overload,0.012);
  assert.ok(second.demo.suspension.wheels[0].hardpoint.distanceTo(first.demo.suspension.wheels[0].hardpoint)<1e-10);
  assert.equal(second.demo.suspension.wheels[0].mountCondition,0.08);
  const shape=restored.captureDamage(second.hood.matrix()),original=saved.parts.find(p=>p.path.join('/')==='601')!.panel!;
  shape.positions.forEach((value,i)=>assert.ok(Math.abs(value-original.positions[i])<1e-9));
  assert.ok(restored.velocities.every(v=>Math.abs(v)<1e-9),'the old driving velocity must not kick panels on a stationary garage spawn');
  second.demo.advance(second.demo.physicsDt,neutral);
  assert.ok(second.demo.suspension.wheels[0].hardpoint.distanceTo(first.demo.suspension.wheels[0].hardpoint)<1e-8,'the first physics tick must not heal the restored wheel mount');
  const again=JSON.parse(JSON.stringify(second.demo.captureDamage()));validateVehicleDamage(again);
  const third=restoredCar();third.demo.placeAt(new Vector3(4,3,5),0.2);third.demo.restoreDamage(again);
  assert.equal(third.demo.soft.get(third.hood)!.panel.beams[0].rest,panel.beams[0].rest);
  assert.equal(third.demo.suspension.wheels[0].mountCondition,0.08);
});


test('a new trip starts with a missing hood and wheel without recreating lost parts',()=>{
  const car=setup(),wheel=car.demo.suspension.wheels[0].part;
  car.world.detach(car.hood);car.world.parts.delete(car.hood.id);
  car.world.detach(wheel);car.world.parts.delete(wheel.id);
  const count=car.world.parts.size,samples:number[]=[];
  for(const x of [-.8,.8])for(const y of [-.5,.5])for(const z of [-2,2])samples.push(x,y,z);
  const demo=new Vehicle3D(car.root,car.root,samples,new Box3(new Vector3(-.8,-.5,-2),new Vector3(.8,.5,2)));
  demo.register(car.root,samples,[]);demo.placeAt(new Vector3(0,3,0),0);
  demo.advance(demo.physicsDt,neutral);
  assert.equal(car.world.parts.size,count);
  assert.equal(car.root.children.has(601),false);assert.equal(car.root.children.has(20),false);
  assert.equal(demo.suspension.wheels[0].contact,false);
  assert.equal(demo.suspension.wheels[0].part.parent,undefined);
  assert.ok(demo.soft.get(car.root),'the chassis remains deformable when the hood is absent');
  assert.ok(Number.isFinite(demo.body.position.y));
});


test('60 km/h frontal impact against an SCX map wall permanently crumples hood and bumper',()=>{
  const map=new MapCollision();
  const model:ScxModel={version:3,warnings:[],meshes:[{name:'map wall',
    positions:new Float32Array([-2000,-2000,-800,2000,-2000,-800,2000,2000,-800,-2000,2000,-800]),
    normals:new Float32Array(12),uv:new Float32Array(8),indices:new Uint32Array([0,1,2,0,2,3]),diffuse:[1,1,1,1],textureIndex:0}]};
  map.add(model);
  const {demo,root,bumper}=setup(false,undefined,120,map,true),shell:number[]=[];
  for(const x of [-.85,.85])for(const y of [-.55,.6])for(const z of [-2.1,2.1])shell.push(x,y,z);
  demo.register(root,shell,[]);demo.disableObstacle();demo.reset(60/3.6);
  let hit=false;for(let i=0;i<120;i++){demo.advance(1/120,neutral);hit ||= (demo.collisionCue?.speed??0)>10;}
  const hood=demo.panel,front=demo.soft.get(bumper!)!.panel;
  assert.ok(hit,'the real map wall was reached at speed');
  assert.ok(hood.permanentDamage>.005,`hood must retain a dent after release: ${hood.permanentDamage}`);
  assert.ok(front.permanentDamage>.005,`bumper must retain a dent: ${front.permanentDamage}`);
  const shape=hood.captureDamage(demo.hood.matrix());
  let bend=0;for(let i=0;i<shape.positions.length;i+=3)
    bend=Math.max(bend,Math.hypot(...[0,1,2].map(axis=>shape.positions[i+axis]-shape.template[i+axis])));
  assert.ok(bend>.03,`hood must visibly bend, not only lose condition: ${bend}m`);
});


test('a strongly dented saved panel cannot restore with high condition while its solver sleeps',()=>{
  const car=setup(),panel=car.demo.soft.get(car.door)!.panel;
  for(let i=0;i<Math.ceil(panel.beams.length*.1);i++)panel.beams[i].rest=panel.beams[i].initial*.8;
  const saved=JSON.parse(JSON.stringify(car.demo.captureDamage()));
  assert.equal(saved.parts.find((p:{path:number[]})=>p.path[0]===602).condition,1,'old saves may carry an overly generous condition');
  const restored=setup();restored.demo.restoreDamage(saved);
  assert.ok(restored.door.condition<=.25,'restoration immediately reconciles permanent shape and part condition');
  assert.equal(restored.door.parent,restored.root,'low condition does not automatically tear off an attached panel');
});
