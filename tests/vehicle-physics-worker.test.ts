import test from 'node:test';
import assert from 'node:assert/strict';
import {Box3,BufferGeometry,Float32BufferAttribute,Group,Matrix4,Mesh,MeshBasicMaterial,Vector3} from 'three';
import {PanelView} from '../src/render/panel-view';
import {Viewer} from '../src/render/viewer';
import {EngineWorld} from '../src/engine/world';
import {parsePartConfig} from '../src/formats/cfg';
import {Vehicle3D} from '../src/engine/vehicle-3d';
import {VehiclePhysicsWorld} from '../src/engine/vehicle-physics-world';
import {VehiclePhysicsClient} from '../src/engine/vehicle-physics-client';
import {applyPhysicsCar,buildPhysicsCar,capturePhysicsCar,createPhysicsSeed} from '../src/engine/vehicle-physics-transfer';
import {VehiclePhysicsWorkerRuntime} from '../src/workers/vehicle-physics-worker';
import {TestTerrain} from '../src/engine/suspension-3d';
import {MapCollision} from '../src/engine/map-collision';
import {MapTerrain} from '../src/engine/map-terrain';
import {modelMatrix} from '../src/engine/model-transform';
import type {PhysicsRequest,PhysicsResponse} from '../src/engine/vehicle-physics-protocol';
const neutral={throttle:0,steer:0,brake:false};
test('sleeping parked render publishes its body skin after placement without a physics tick',async()=>{
  const vehicle=car(),client=new VehiclePhysicsClient(),proxies=new Map(),samples=new Map(),lamps=new Map(),geometries:BufferGeometry[]=[],materials:MeshBasicMaterial[]=[];
  vehicle.placeAt(new Vector3(100,0,200),0);
  for(const state of vehicle.soft.values()){
    const points=[-.5,0,-.5,.5,0,-.5,0,.1,.5],geometry=new BufferGeometry();
    geometry.setAttribute('position',new Float32BufferAttribute(points,3));geometry.computeVertexNormals();
    const group=new Group(),material=new MeshBasicMaterial();group.add(new Mesh(geometry,material));
    group.matrixAutoUpdate=false;group.matrix.copy(modelMatrix(state.part.matrix()));
    const lamp=new Group();lamp.matrixAutoUpdate=false;lamp.matrix.makeScale(100,100,100).multiply(new Matrix4().makeTranslation(.5,.2,1.8));group.add(lamp);lamps.set(state.part,lamp);
    proxies.set(state.part,group);samples.set(state.part,[points]);geometries.push(geometry);materials.push(material);
  }
  let groundReady=false;
  const terrain=Object.assign(new TestTerrain(),{faces:0,placementHeight:()=>groundReady?0:-1000});
  const races=new Map(),viewer={generation:0,mapRoadSource:{terrain,collision:{}},scriptTimeOfDay:()=>0,
    javaRaces:races,vehiclePhysics:client,profiler:{record(){}},proxies,pairVehicle:()=>({car:vehicle,positions:(part:unknown)=>samples.get(part)}),syncWorldVisuals:()=>{
      for(const [part,group]of proxies)if(!group.userData.panelViewOwnsTransform){group.matrix.copy(modelMatrix(part.matrix()));group.matrixWorldNeedsUpdate=true;}
    }};
  let placement:{position:Vector3;yaw:number;velocity:Vector3}|undefined={position:new Vector3(150,4,250),yaw:.3,velocity:new Vector3()};
  let published:Vector3|undefined;
  const oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,value:{hidden:false}});
  try{
    const binding=await Viewer.prototype.bindJavaRaceCar.call(viewer as unknown as Viewer,vehicle.root,{parked:true,active:()=>true,command:()=>undefined,placement:()=>placement,motion:p=>{published=p.clone();}});
    const checkLamps=()=>{for(const [part,lamp]of lamps){proxies.get(part).updateMatrixWorld(true);const actual=new Vector3().setFromMatrixPosition(lamp.matrixWorld),expected=new Vector3(.5,.2,1.8).applyMatrix4(part.matrix());assert.ok(actual.distanceTo(expected)<1e-7,`flare must follow the settled car, not its old spawn pose: ${actual.toArray()} != ${expected.toArray()}`);}};
    checkLamps();
    races.get(vehicle.root).update(1000);
    assert.ok(vehicle.body.position.y>=4,'missing map data must not drop the car to the fallback floor');
    groundReady=true;terrain.faces++;placement=undefined;
    races.get(vehicle.root).update(1016);
    const supported=()=>{
      for(const wheel of vehicle.suspension.wheels){
        const center=wheel.center.clone().applyMatrix4(vehicle.body.matrix());
        assert.ok(Math.abs(center.y-wheel.radius)<1e-6,'a sleeping wheel must touch map geometry without a physics tick');
      }
      assert.deepEqual(published?.toArray(),new Vector3().setFromMatrixPosition(vehicle.root.local).toArray(),'publish the corrected model origin, not the elevated center of mass, back to Java');
      checkLamps();
    };
    supported();
    placement={position:new Vector3(160,6,260),yaw:-.5,velocity:new Vector3()};
    races.get(vehicle.root).update(1032);supported();
    assert.equal(vehicle.root.world.lightMask&4,0,'parked native cars without an engine model must not enable night flares');
    for(const group of proxies.values()){
      group.updateMatrixWorld(true);const mesh=group.children[0] as Mesh;
      const box=new Box3().setFromBufferAttribute(mesh.geometry.getAttribute('position') as Float32BufferAttribute).applyMatrix4(mesh.matrixWorld);
      assert.ok(box.getCenter(new Vector3()).distanceTo(vehicle.body.position)<5,`parked body must remain beside its wheels: ${box.getCenter(new Vector3()).toArray()} vs ${vehicle.body.position.toArray()}`);
    }
    assert.equal(vehicle.clock.tick,0,'publishing body geometry does not simulate the sleeping car');
    // No hidden rAF callback is delivered when Chrome suspends the tab.
    placement=undefined;vehicle.wakePhysics();vehicle.body.velocity.z=-5;
    const racer=races.get(vehicle.root);
    client.beginFrame();racer.update(1066);client.flush();racer.publish();
    const peer=car();peer.placeAt(new Vector3(300,0,300),0);client.register(peer);
    // This car has no new elapsed time, but a later submission advances both
    // cars. Publishing from update() would leave its Java/draw pose one frame old.
    client.beginFrame();racer.update(1066);client.submit(peer,1/30,neutral);client.flush();racer.publish();
    assert.ok(published!.distanceTo(vehicle.body.position)<1e-9,'publish after a later vehicle advances the common world');
    client.forget(peer);peer.dispose();
    const tickBeforePause=vehicle.clock.tick;
    racer.pause();client.pause();
    client.beginFrame();racer.update(61066);client.flush();racer.publish();
    assert.equal(vehicle.clock.tick,tickBeforePause,'restoring a minimized window must not simulate the hidden minute');
    client.beginFrame();racer.update(61099);client.flush();racer.publish();
    assert.ok(vehicle.clock.tick-tickBeforePause<=4,'normal foreground stepping resumes immediately');
    assert.ok(published!.distanceTo(vehicle.body.position)<1e-9,'Java receives the completed physics frame');
    binding.dispose();
  }finally{
    if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else Reflect.deleteProperty(globalThis,'document');
    client.dispose();vehicle.dispose();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
  }
});
test('parked cars keep collision hulls asleep, wake on vehicle impact and sleep again without repairing dents',()=>{
  const parked=car(),moving=car(),world=new VehiclePhysicsWorld();
  parked.sleepWhenResting=true;parked.sleepPhysics();
  moving.placeAt(new Vector3(0,0,20),0);moving.settleSpawn();
  world.add(1,{car:parked,input:neutral});world.add(2,{car:moving,input:neutral});
  const original=parked.body.position.clone(),tick=parked.clock.tick;
  world.advance(.1);
  assert.deepEqual(parked.body.position,original);assert.equal(parked.clock.tick,tick,'no suspension or panel ticks while asleep');
  moving.placeAt(new Vector3(0,0,4.1),0);moving.settleSpawn();moving.body.velocity.z=-12;
  let contacts=0;const contact=parked.vehicleContact.bind(parked);
  parked.vehicleContact=(...args)=>{contacts++;contact(...args);};
  for(let i=0;i<30;i++)world.advance(1/120);
  assert.ok(contacts>0,'parked collision participates in the shared physical world');
  assert.equal(parked.sleeping,false);assert.ok(parked.clock.tick>tick);
  assert.ok(parked.body.position.distanceTo(original)>.01,'impact moves the parked car');
  parked.panel.positions[0]+=.2;const dent=parked.panel.positions.slice();
  parked.body.velocity.set(0,0,0);parked.body.momentum.set(0,0,0);
  for(const state of parked.soft.values())state.activity.internalSpeed=0;
  parked.updatePhysicsSleep(2.01);
  assert.equal(parked.sleeping,true);assert.deepEqual(parked.panel.positions,dent,'returning to sleep retains damage');
  const copy=buildPhysicsCar(structuredClone(createPhysicsSeed(parked)),new TestTerrain());
  assert.equal(copy.sleeping,true);assert.equal(copy.sleepWhenResting,true);
  parked.applyImpulse(new Vector3(1000,0,0),parked.body.position);
  assert.equal(parked.sleeping,false,'external impulses also wake the car');
  parked.dispose();moving.dispose();copy.dispose();
});
function car(){
  const world=new EngineWorld(),make=(file:string,cfg:string)=>world.create({key:{pack:'test.rpk',id:world.parts.size+1},alias:file,cfgPath:file,config:parsePartConfig(cfg)});
  const slots=[101,102,103,104].map((type,i)=>`slot 0 0 0 0 0 0 ${20+i}\nslottype ${type}`).join('\n');
  const wheels=[[-.7,-1.3],[.7,-1.3],[-.7,1.3],[.7,1.3]].map(([x,z],i)=>`type 10 sphere .3\nspring .29 .1 .05\nwheel ${x} -.6 ${z} 0 0 0 ${i<2?1:0} 0 1 0`).join('\n');
  const root=make('car.cfg',`body 0 -.2 0 0 0 0 1000 sphere 1\n${wheels}\n${slots}\nslot 0 .2 -1.4 0 0 0 601`);
  for(let i=0;i<4;i++)world.install(root,20+i,make('wheel.cfg','slot 0 0 0 0 0 0 1'),1);
  const hood=make('hood.cfg','slot 0 0 0 0 0 0 1\nbody 0 0 0 0 0 0 38.5 sphere 1');world.install(root,601,hood,1);
  const points=(xs:number[],ys:number[],zs:number[])=>xs.flatMap(x=>ys.flatMap(y=>zs.flatMap(z=>[x,y,z])));
  const vehicle=new Vehicle3D(root,hood,points([-.7,.7],[0,.12],[-.6,.6]),new Box3(new Vector3(-.9,-.4,-2),new Vector3(.9,.6,2)),undefined,undefined,120);
  const faces=[-.9,-.4,-2,.9,-.4,-2,.9,-.4,2,-.9,-.4,-2,.9,-.4,2,-.9,-.4,2];vehicle.register(root,points([-.9,.9],[-.4,.6],[-2,2]),faces);vehicle.setBodyTriangles(faces);vehicle.disableObstacle();vehicle.settleSpawn();return vehicle;
}
function worldPair(){const a=car(),b=car(),world=new VehiclePhysicsWorld();a.placeAt(new Vector3(0,0,5),0);b.placeAt(new Vector3(.2,0,-5),Math.PI);a.disableObstacle();b.disableObstacle();a.body.velocity.z=-12;b.body.velocity.z=12;a.syncRecordedPose();b.syncRecordedPose();world.add(1,{car:a,input:neutral});world.add(2,{car:b,input:neutral});return {world,a,b};}

function panelView(car:Vehicle3D){
  const samples=[-.7,.12,-.6,.7,.12,-.6,.7,.12,.6,-.7,.12,-.6,.7,.12,.6,-.7,.12,.6],geometry=new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute(samples,3));geometry.computeVertexNormals();const material=new MeshBasicMaterial(),group=new Group();group.matrixAutoUpdate=false;group.add(new Mesh(geometry,material));
  const view=new PanelView(group,car.panel,[samples]);return {samples,geometry,group,view,dispose:()=>{view.dispose();geometry.dispose();material.dispose();}};
}
for(const sleeping of [false,true])test(`rendered vertices adopt a worker dent even when the returned panel is ${sleeping?'already asleep':'active'}`,()=>{
  const source=car(),mirror=buildPhysicsCar(structuredClone(createPhysicsSeed(source)),new TestTerrain()),skin=panelView(mirror);
  try{
    skin.view.update(mirror.hood.matrix(),true);const before=Array.from(skin.geometry.getAttribute('position').array);
    const state=source.soft.get(source.hood)!;
    // A completed worker solve changed the shape. No main-thread panel advance occurs.
    for(let i=0;i<source.panel.positions.length;i+=3)if(source.panel.positions[i]>.1)source.panel.positions[i+1]-=.35;
    source.panel.shapeVersion++;source.panel.clock.restore(12);state.activity.deforming=!sleeping;
    applyPhysicsCar(mirror,structuredClone(capturePhysicsCar(source)));assert.equal(mirror.panel.clock.tick,12);
    skin.view.update(mirror.hood.matrix(),sleeping);const positions=skin.geometry.getAttribute('position');
    let moved=0;for(let i=0;i<positions.count;i++){const expected:number[]=[];source.panel.skin(source.panel.bind(skin.samples.slice(i*3,i*3+3)),expected,0);const actual=new Vector3().fromBufferAttribute(positions,i).applyMatrix4(skin.group.matrix);assert.ok(actual.distanceTo(new Vector3(...expected as [number,number,number]))<1e-5);moved=Math.max(moved,Math.abs(positions.getY(i)-before[i*3+1]));}
    assert.ok(moved>.25,'the rendered mesh, not just beam rest lengths, must visibly dent');assert.ok(skin.group.visible);
  }finally{skin.dispose();source.dispose();mirror.dispose();}
});
test('between worker snapshots an active panel keeps its complete skin and follows the part frame',()=>{
  const vehicle=car(),skin=panelView(vehicle);try{
    const first=vehicle.hood.matrix();skin.view.update(first,false);const before=new Vector3().fromBufferAttribute(skin.geometry.getAttribute('position'),0);
    const shifted=new Matrix4().makeTranslation(7,2,-4).multiply(first);skin.group.matrix.makeScale(100,100,100);skin.view.update(shifted,false);
    skin.group.updateMatrixWorld(true);const actual=new Vector3().fromBufferAttribute(skin.geometry.getAttribute('position'),0).applyMatrix4(skin.group.matrixWorld);assert.ok(actual.distanceTo(before.add(new Vector3(7,2,-4)))<1e-6);assert.ok(skin.group.visible);assert.equal(skin.group.userData.panelViewOwnsTransform,true);
  }finally{skin.dispose();assert.equal(skin.group.userData.panelViewOwnsTransform,undefined);vehicle.dispose();}
});
test('Java and scene synchronization cannot overwrite a live panel skin or its render transform',()=>{
  const vehicle=car(),skin=panelView(vehicle);try{
    skin.view.update(vehicle.hood.matrix(),false);const geometry=skin.geometry.getAttribute('position'),vertices=Array.from(geometry.array),frame=new Matrix4().makeTranslation(4,2,-3);skin.group.matrix.copy(frame);
    skin.geometry.userData.damageReference=new Float32Array(vertices.map(v=>v+100));skin.group.userData.savedPanelApplied=false;
    const viewer={proxies:new Map([[vehicle.hood,skin.group]]),suspensionSkins:new Map(),profiler:{measure:(_name:string,work:()=>unknown)=>work()}} as unknown as Viewer;Object.setPrototypeOf(viewer,Viewer.prototype);
    viewer.syncWorldVisuals(vehicle.root.world);(viewer as unknown as {syncWorld():void}).syncWorld();
    assert.ok(skin.group.matrix.equals(frame),'only PanelView owns the draw matrix while physics is live');assert.deepEqual(Array.from(geometry.array),vertices,'saved geometry must not erase the complete worker skin');assert.ok(skin.group.visible);
  }finally{skin.dispose();vehicle.dispose();}
});
test('shared world resolves a high speed pair on identical substeps at 15 and 60 render FPS',()=>{
  const fast=worldPair(),slow=worldPair();for(let i=0;i<60;i++)fast.world.advance(1/60);for(let i=0;i<15;i++)slow.world.advance(1/15);
  for(const key of ['a','b']as const){assert.equal(fast[key].clock.tick,120);assert.equal(slow[key].clock.tick,120);assert.ok(fast[key].body.position.distanceTo(slow[key].body.position)<1e-9);assert.ok(fast[key].root.condition<1);}
});
test('worker assembly round trip preserves physical configuration, poses and independent node buffers',()=>{
  const source=car();source.placeAt(new Vector3(23,2,-17),.4);source.body.velocity.set(3,0,-8);source.syncRecordedPose();
  const seed=structuredClone(createPhysicsSeed(source)),replica=buildPhysicsCar(seed,new TestTerrain());
  assert.ok(replica.body.position.equals(source.body.position));assert.ok(replica.body.velocity.equals(source.body.velocity));assert.deepEqual(replica.captureDamage(),source.captureDamage());
  const view=source.panel.positions;replica.advance(1/120,neutral);applyPhysicsCar(source,structuredClone(capturePhysicsCar(replica)));assert.equal(source.panel.positions,view);assert.deepEqual(source.panel.positions,replica.panel.positions);
});
class TestWorker{
  runtime=new VehiclePhysicsWorkerRuntime();requests:PhysicsRequest[]=[];onmessage?:({data}:{data:PhysicsResponse})=>void;onerror?:Function;onmessageerror?:Function;terminated=false;
  postMessage(request:PhysicsRequest){this.requests.push(structuredClone(request));}
  terminate(){this.terminated=true;}
  drain(){while(this.requests.length){const result=this.runtime.handle(this.requests.shift()!);if(result)this.onmessage?.({data:structuredClone(result)});}}
}
test('worker client keeps one batch in flight and retains elapsed time while rendering continues',()=>{
  const fake=new TestWorker(),client=new VehiclePhysicsClient(()=>fake as unknown as Worker),a=car(),b=car();b.placeAt(new Vector3(20,0,0),0);
  a.advance=()=>{throw Error('Main thread must not step this car');};b.advance=a.advance;
  client.submit(a,1/60,neutral);client.submit(b,1/60,neutral);client.flush();
  for(let i=0;i<5;i++){client.submit(a,1/60,neutral);client.submit(b,1/60,neutral);client.flush();}
  assert.equal(fake.requests.filter(r=>r.kind==='step').length,1);fake.drain();client.flush();fake.drain();assert.equal(a.clock.tick,12);assert.equal(b.clock.tick,12);assert.equal(client.error,'');client.dispose();assert.ok(fake.terminated);
});
test('teleport invalidates an older in-flight snapshot and is applied by the worker',()=>{
  const fake=new TestWorker(),client=new VehiclePhysicsClient(()=>fake as unknown as Worker),a=car();client.submit(a,1/60,neutral);client.flush();a.placeAt(new Vector3(70,0,-20),0);fake.drain();assert.ok(a.body.position.x>69);client.flush();fake.drain();assert.ok(a.body.position.x>69);assert.equal(client.error,'');client.dispose();
});

test('short gear/start inputs survive an in-flight batch instead of being overwritten by a later render frame',()=>{
  const fake=new TestWorker(),client=new VehiclePhysicsClient(()=>fake as unknown as Worker),a=car();client.submit(a,1/60,neutral);client.flush();
  client.submit(a,1/60,{...neutral,gearUp:true,start:true});client.flush();client.submit(a,1/60,neutral);client.flush();fake.drain();client.flush();
  const request=fake.requests.find(r=>r.kind==='step');assert.ok(request&&request.kind==='step');assert.equal(request.controls[0].input.gearUp,true);assert.equal(request.controls[0].input.start,true);client.dispose();
});
test('a worker creation failure immediately uses the common local clock',()=>{
  const client=new VehiclePhysicsClient(()=>{throw Error('deliberate worker creation failure');}),a=car(),b=car();b.placeAt(new Vector3(20,0,0),0);
  client.submit(a,1/60,neutral);client.submit(b,1/60,neutral);client.flush();assert.equal(a.clock.tick,2);assert.equal(b.clock.tick,2);assert.match(client.error,/deliberate/);client.dispose();
});
test('external traffic corrections made during an in-flight batch reach the next physical step exactly once',()=>{
  const fake=new TestWorker(),client=new VehiclePhysicsClient(()=>fake as unknown as Worker),a=car();client.submit(a,1/60,neutral);client.flush();a.body.position.x+=3;fake.drain();assert.ok(a.body.position.x>2.9);client.submit(a,1/60,neutral);client.flush();fake.drain();assert.ok(a.body.position.x>2.9&&a.body.position.x<3.1);client.dispose();
});
test('part failure requested on the main thread is processed on the physical worker',()=>{
  const fake=new TestWorker(),client=new VehiclePhysicsClient(()=>fake as unknown as Worker),a=car();client.submit(a,1/60,neutral);client.flush();fake.drain();a.hood.condition=0;client.submit(a,1/60,neutral);client.flush();fake.drain();assert.equal(a.hood.parent,undefined);assert.ok(!a.soft.get(a.hood)!.activity.deforming,'detached pieces remain rigid');client.dispose();
});
test('map support snapshot preserves overpasses and physical object support',()=>{
  const objects=new MapCollision();objects.addBox(new Matrix4().setPosition(0,3,0),new Vector3(2,.5,2));
  const terrain=new MapTerrain(objects),copy=MapTerrain.fromPhysicsSnapshot(structuredClone(terrain.physicsSnapshot()),objects);
  assert.equal(copy.height(0,0,6),terrain.height(0,0,6));assert.equal(copy.height(0,0,6),3.5);
});


test('production main-thread world advances before rendering and never waits for worker snapshots',()=>{
  const client=new VehiclePhysicsClient(()=>undefined),a=car(),b=car();b.placeAt(new Vector3(20,0,0),0);client.register(a);client.register(b);
  for(let i=0;i<60;i++){
    client.beginFrame();client.submit(a,1/60,neutral);
    assert.equal(a.clock.tick,(i+1)*2,'player is current before geometry update');assert.equal(b.clock.tick,a.clock.tick,'opponent shares this substep');
    client.submit(b,1/60,neutral);client.flush();assert.equal(a.clock.tick,(i+1)*2,'one world advance per frame');
  }
  assert.match(client.backend,/Main thread/);assert.equal(client.roundTripMs,0);client.dispose();a.dispose();b.dispose();
});

test('pausing clears queued catch-up ticks without resetting position, velocity or completed simulation',()=>{
  const client=new VehiclePhysicsClient(),a=car();
  client.submit(a,2,neutral);client.flush();
  const tick=a.clock.tick,position=a.body.position.clone(),velocity=a.body.velocity.clone();
  client.pause();
  client.beginFrame();client.submit(a,0,neutral);client.flush();
  assert.equal(a.clock.tick,tick);assert.deepEqual(a.body.position,position);assert.deepEqual(a.body.velocity,velocity);
  client.beginFrame();client.submit(a,1/30,neutral);client.flush();
  assert.equal(a.clock.tick,tick+4,'old backlog must not cause a fast-forward burst');
  client.dispose();a.dispose();
});
