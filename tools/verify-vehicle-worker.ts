import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {Worker} from 'node:worker_threads';
import {Box3,Matrix4,Vector3,BufferGeometry,Float32BufferAttribute,Group,Mesh,MeshBasicMaterial} from 'three';
import {PanelView} from '../src/render/panel-view';
import {Assets} from '../src/assets';
import {PartFactory,poseMatrix} from '../src/engine/world';
import {modelMatrix} from '../src/engine/model-transform';
import {parseScx} from '../src/formats/scx';
import {loadPartCollision,partContactTriangles} from '../src/engine/part-collision';
import {Vehicle3D} from '../src/engine/vehicle-3d';
import {VehiclePhysicsWorld} from '../src/engine/vehicle-physics-world';
import {softBodyRuntime} from '../src/engine/soft-body-wasm';
if(process.argv.includes('--main'))assert.ok(await softBodyRuntime.load(()=>readFile(new URL('../src/engine/wasm/soft-body.wasm',import.meta.url))));
import {createPhysicsSeed,applyPhysicsCar,buildPhysicsCar} from '../src/engine/vehicle-physics-transfer';
import type {PhysicsResponse} from '../src/engine/vehicle-physics-protocol';
import {gameRoot,walk,relativeGamePath,safeGamePath} from './game-files';

const assets=new Assets((await walk(gameRoot)).map(f=>({path:relativeGamePath(f),size:0})),async path=>new Uint8Array(await readFile(await safeGamePath(path))));
const {world,root}=await new PartFactory(assets).stock({pack:'cars/racers/Baiern.rpk',id:6},{mechanical:true});
const rows=new Map<typeof root,{samples:number[];indices:number[];triangles:number[];physical:number}>();let renderTriangles=0;
for(const part of world.parts.values()){
  if(!part.definition.model)continue;
  const model=parseScx(await assets.read(part.definition.model.path)),frame=modelMatrix(new Matrix4(),part.definition.config.renderPose&&poseMatrix(part.definition.config.renderPose)),point=new Vector3(),samples:number[]=[],indices:number[]=[];
  for(const mesh of model.meshes){const base=samples.length/3;indices.push(...Array.from(mesh.indices,index=>index+base));renderTriangles+=mesh.indices.length/3;for(let i=0;i<mesh.positions.length;i+=3){point.fromArray(mesh.positions,i).applyMatrix4(frame);samples.push(point.x,point.y,point.z);}}
  const physical=await loadPartCollision(assets,part.definition);rows.set(part,{samples,indices,triangles:partContactTriangles(part.definition,physical,samples),physical:physical.length/9});
}
const hood=[...world.parts.values()].find(p=>/\/hood.cfg$/i.test(p.definition.cfgPath))!,bounds=new Box3(),rootData=rows.get(root)!;
for(let i=0;i<rootData.samples.length;i+=3)bounds.expandByPoint(new Vector3().fromArray(rootData.samples,i));
const car=new Vehicle3D(root,hood,rows.get(hood)!.samples,bounds,undefined,undefined,120,process.argv.includes('--xpbd')?'xpbd':'ror'),triangles:number[]=[],inverse=root.matrix().invert();
for(const [part,row]of rows){
  if(part===hood&&hood!==root)continue;
  const type=part.parent?.definition.config.slots.find(s=>s.id===part.parentSlot)?.type;if(type===11)continue;
  if(type!==undefined&&type>=101&&type<=104){car.register(part,row.samples,[]);continue;}if(type!==undefined&&type>104&&type<200)continue;
  car.register(part,row.samples,row.triangles);if(!part.definition.mechanics){const frame=inverse.clone().multiply(part.matrix());for(let i=0;i<row.triangles.length;i+=3)triangles.push(...new Vector3().fromArray(row.triangles,i).applyMatrix4(frame).toArray());}
}
car.setBodyTriangles(triangles);car.disableObstacle();car.placeAt(new Vector3(0,0,0),0);car.settleSpawn();
car.body.velocity.z=-10;car.syncRecordedPose();
const seed=createPhysicsSeed(car);if(process.argv.includes('--browser-seed'))await writeFile('.research/vehicle-worker-seed.json',JSON.stringify(seed,(_key,value)=>ArrayBuffer.isView(value)?{$typed:value.constructor.name,data:Array.from(value as Float64Array)}:value));const thread=new Worker(new URL('./vehicle-physics-node-worker.mjs',import.meta.url));
let sequence=0;const samples:number[]=[],roundTrips:number[]=[];let recordedSamples=0;const costs:Record<string,number>={};
const views=[...car.soft.values()].map(state=>{
  const row=rows.get(state.part)!,geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(row.samples,3));geometry.setIndex(row.indices);geometry.computeVertexNormals();const group=new Group(),material=new MeshBasicMaterial();group.add(new Mesh(geometry,material));
  const view=new PanelView(group,state.panel,[row.samples]);view.update(state.part.matrix(),!state.activity.deforming);
  const p=geometry.getAttribute('position'),origin=new Vector3().fromBufferAttribute(p,0).applyMatrix4(group.matrix),distances=Array.from({length:p.count},(_,i)=>new Vector3().fromBufferAttribute(p,i).applyMatrix4(group.matrix).distanceTo(origin));return {state,view,group,geometry,material,distances};
});
const renderShapes=()=>{let largest=0;for(const {state,view,group,geometry,distances}of views){view.update(state.part.matrix(),!state.activity.deforming);const p=geometry.getAttribute('position'),origin=new Vector3().fromBufferAttribute(p,0).applyMatrix4(group.matrix);for(let i=0;i<p.count;i++)largest=Math.max(largest,Math.abs(new Vector3().fromBufferAttribute(p,i).applyMatrix4(group.matrix).distanceTo(origin)-distances[i]));}return largest;};

if(process.argv.includes('--main')){
  await thread.terminate();
  const other=buildPhysicsCar(seed,car.terrain),physics=new VehiclePhysicsWorld(120);let impact:number|undefined;
  physics.add(1,{car,input:{throttle:0,steer:0,brake:true},impact:speed=>{impact??=speed;}});
  physics.add(2,{car:other,input:{throttle:0,steer:0,brake:false}});
  car.reset();other.placeAt(new Vector3(0,0,12),0);car.telemetry.start();other.telemetry.start();
  const batches:number[]=[],panels:number[]=[],beam:number[]=[],contact:number[]=[],collisionSkin:number[]=[];let shape=0;const partCost=new Map<string,{ms:number,passes:number,steps:number,mass:number}>();
  for(let i=0;i<180;i++){
    if(impact===undefined)other.body.velocity.z=-24;
    const start=performance.now();physics.advance(1/60);batches.push(performance.now()-start);
    panels.push(car.timings.panelSolve+other.timings.panelSolve);beam.push(car.timings.panelConstraints+other.timings.panelConstraints);contact.push(car.timings.panelContacts+other.timings.panelContacts);collisionSkin.push(car.timings.panelSurface+other.timings.panelSurface);
    for(const v of [car,other])for(const [part,row]of v.panelWork){const p=v.soft.get(part)!.panel,key=row.cfg,t=partCost.get(key)??{ms:0,passes:0,steps:0,mass:p.options.mass};t.ms+=row.constraints_ms;t.steps+=row.active_steps;t.passes=Math.max(t.passes,p.profile.beamPasses/Math.max(1,p.profile.steps));partCost.set(key,t);}
    shape=Math.max(shape,renderShapes());
    for(const v of [car,other])for(const state of v.soft.values())assert.ok(state.panel.positions.every(x=>Number.isFinite(x)&&Math.abs(x)<1000),'bounded panel deformation');
  }
  const stats=(v:number[])=>{const sorted=v.slice().sort((a,b)=>a-b);return {mean:v.reduce((a,b)=>a+b)/v.length,p50:sorted[Math.floor(v.length*.5)],p95:sorted[Math.floor(v.length*.95)],max:sorted.at(-1)};};
  assert.ok(impact!==undefined&&impact*3.6>60);assert.ok(shape>.02&&shape<5,`visible shape change ${shape}`);
  console.log('PART_COST',JSON.stringify([...partCost].sort((a,b)=>b[1].ms-a[1].ms).slice(0,8)));
  console.log(JSON.stringify({mode:'Main thread, no snapshots',solver:car.panelSolver,impactKmh:impact*3.6,renderedShapeChangeMeters:shape,twoCarBatchMs:stats(batches),panelSolveMs:stats(panels),beamKernelMs:stats(beam),panelContactsMs:stats(contact),collisionSkinMs:stats(collisionSkin)},null,2));
  for(const {view,geometry,material}of views){view.dispose();geometry.dispose();material.dispose();}other.dispose();other.root.world.dispose();car.dispose();world.dispose();process.exit(0);
}

const next=()=>new Promise<PhysicsResponse>((resolve,reject)=>{
  const timeout=setTimeout(()=>{cleanup();reject(Error('Physics worker check timed out'));},30000);
  const cleanup=()=>{clearTimeout(timeout);thread.off('message',message);thread.off('error',error);};
  const message=(response:PhysicsResponse)=>{cleanup();if(response.error)reject(Error(response.error));else resolve(response);};
  const error=(reason:Error)=>{cleanup();reject(reason);};thread.once('message',message);thread.once('error',error);
});
try{
  thread.postMessage({kind:'add',id:1,seed});
  for(let i=0;i<120;i++){
    const result=next(),start=performance.now();thread.postMessage({kind:'step',sequence:++sequence,seconds:1/60,controls:[{id:1,version:0,input:{throttle:0,steer:0,brake:false},settings:{},commands:[],bodyDelta:{},recording:true,recordingId:7}]});
    const response=await result;if(response.error)throw Error(response.error);assert.equal(response.backend,'C++/WASM worker');assert.equal(response.cars[0].telemetry?.id,7);recordedSamples+=response.cars[0].telemetry!.packet.samples.length;for(const [key,value]of Object.entries(response.cars[0].state.timings))costs[key]=(costs[key]??0)+value;applyPhysicsCar(car,response.cars[0].state);renderShapes();if(i>5){samples.push(response.workMs);roundTrips.push(performance.now()-start);}
  }
  assert.equal(car.clock.tick,240);assert.ok([...car.body.position.toArray(),...car.body.velocity.toArray()].every(Number.isFinite));assert.ok(car.body.position.z<-.5,`coasting worker assembly position ${car.body.position.toArray()}, gear ${car.suspension.mechanics?.gear}, rpm ${car.suspension.mechanics?.rpm}, wheels ${car.suspension.wheels.map(w=>w.contact)}`);
  assert.equal(recordedSamples,20,'telemetry samples come from actual worker ticks');
  if(process.argv.includes('--impact')){
    thread.postMessage({kind:'add',id:2,seed});let firstImpact:number|undefined;let rearVelocity=[0,0,0];let dents=0;let peak=0;let visibleShapeChange=0;
    for(let i=0;i<120;i++){
      const result=next();const commands=i===0?[{method:'placeAt',args:[{$physics:'v3',value:[0,0,12]},0]}]:[];
      const velocity=firstImpact===undefined?[0,0,-24-rearVelocity[2]]:undefined;
      thread.postMessage({kind:'step',sequence:++sequence,seconds:1/60,controls:[{id:1,version:0,input:{throttle:0,steer:0,brake:true},settings:{},commands:i===0?[{method:'reset',args:[]}]:[],bodyDelta:{},recording:false},{id:2,version:0,input:{throttle:0,steer:0,brake:false},settings:{},commands,bodyDelta:velocity?{velocity}:{},recording:false}]});
      const response=await result;if(response.error)throw Error(response.error);if(response.workMs>peak){peak=response.workMs;console.log("IMPACT_PEAK",i,response.workMs,JSON.stringify(response.cars.map(c=>c.state.timings)));}rearVelocity=response.cars.find(c=>c.id===2)!.state.body.velocity.value;
      if(response.impacts.length)firstImpact??=response.impacts[0].speed;
      const state=response.cars[0].state;applyPhysicsCar(car,state);visibleShapeChange=Math.max(visibleShapeChange,renderShapes());dents=Math.max(dents,...[...car.soft.values()].map(s=>s.panel.beams.filter(b=>Math.abs(b.rest-b.initial)>1e-6).length));
    }
    assert.ok(firstImpact!==undefined&&firstImpact>15,'high-speed two-car worker impact');assert.ok(dents>0,'plastic rest lengths survive the worker snapshot');assert.ok(visibleShapeChange>.02&&visibleShapeChange<5,'rendered panel geometry must change shape, excluding rigid movement');console.log(JSON.stringify({impactKmh:firstImpact*3.6,deformedBeams:dents,renderedShapeChangeMeters:visibleShapeChange,peakTwoCarBatchMs:peak}));
  }
  console.log('PHASE_COST',JSON.stringify(Object.fromEntries(Object.entries(costs).map(([k,v])=>[k,v/120]))));console.log(JSON.stringify({model:root.definition.alias,parts:world.parts.size,physicalContactTriangles:triangles.length/9,renderTriangles,physicsTicks:car.clock.tick,position:car.body.position.toArray(),backend:'C++/WASM worker',meanBatchMs:samples.reduce((a,b)=>a+b,0)/samples.length,meanRoundTripMs:roundTrips.reduce((a,b)=>a+b,0)/roundTrips.length},null,2));
}finally{await thread.terminate();for(const {view,geometry,material}of views){view.dispose();geometry.dispose();material.dispose();}car.dispose();world.dispose();}
