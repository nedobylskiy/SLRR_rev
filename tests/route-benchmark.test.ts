import test from 'node:test';
import assert from 'node:assert/strict';
import {Quaternion,Vector3} from 'three';
import {EngineWorld} from '../src/engine/world';
import {parsePartConfig} from '../src/formats/cfg';
import {DriveTelemetry} from '../src/engine/drive-telemetry';
import type {Vehicle3D} from '../src/engine/vehicle-3d';
import {parseRouteBenchmark,restoreRouteVehicle,RoutePlayback,RouteCheckpoints,routeBodyMatrix,routeSourceSummary} from '../src/engine/route-benchmark';

function capture(){
  const world=new EngineWorld();world.mechanical=true;
  const root=world.create({key:{pack:'test.rpk',id:6},alias:'test',cfgPath:'test.cfg',config:parsePartConfig('slot 0 1 0 0 0 0 401')});
  const block=world.create({key:{pack:'test.rpk',id:7},alias:'engine',cfgPath:'engine.cfg',config:parsePartConfig('slot 0 0 0 0 0 0 1')});
  world.install(root,401,block,1);block.condition=.75;root.local.makeTranslation(1,2,3);root.renderAdjustment.makeRotationY(.2);
  root.slotPositions.set(401,[0,.8,0]);
  const mechanics={idleRpm:900,redlineRpm:7000,rpm:2000,gear:1,manual:true,running:true,temperature:50,
    boost:0,block,estimateFlywheelTorqueAt:()=>150};
  const body={mass:1200,center:new Vector3(0,.2,0),position:new Vector3(1,2.2,3),orientation:new Quaternion(),velocity:new Vector3(0,0,-10),omega:new Vector3(0,.1,0)};
  const vehicle={root,body,physicsDt:1/240,suspension:{mechanics,steer:0,tireModel:{model:'sl2'},wheels:Array.from({length:4},()=>({
    nativeSlip:{longitudinal:0,angle:0},center:new Vector3(),omega:30,spin:1,length:.2,radius:.3,steering:1,
  }))}};
  const recorder=new DriveTelemetry(vehicle as unknown as Vehicle3D);
  const camera={position:[0,3,8],rotation:[0,0,0,1],fov:42,near:.01,far:1000};
  recorder.setViewSource(()=>({primary:camera,observer:{...camera,position:[0,100,0]},focus:body.position.toArray()}));
  recorder.start({map_pack:'maps/test_track.rpk'});
  for(let tick=0;tick<48;tick++){
    body.position.x+=1/24;
    body.orientation.setFromAxisAngle(new Vector3(0,1,0),Math.PI*(tick+1)/48);
    recorder.tick(1/240,{throttle:1,steer:0,brake:false,gearUp:tick===1});recorder.recordView();
    if([0,4,8,12].includes(tick))recorder.recordRenderFrame([0,16,32,80][tick/4],{calls:100,triangles:1000,width:1920,height:1080});
    if(tick===16)recorder.recordRenderFrame(2000,{calls:0,triangles:0,width:0,height:0},true);
    if(tick===20||tick===24)recorder.recordRenderFrame(tick===20?2100:2116,{calls:100,triangles:1000,width:1920,height:1080});
  }
  recorder.stop();return {recorder,world,root,block};
}

test('route recording survives JSON round trip and reconstructs assembly without Java',()=>{
  const {recorder,world,root,block}=capture(),route=parseRouteBenchmark(recorder.benchmarkText()!);
  assert.equal(route.poses.length,3);assert.equal(route.views.length,5);assert.equal(route.controls.length,3);
  assert.deepEqual(route.vehicle.bodyCenter,[0,.2,0]);assert.equal(route.vehicle.mass,1200);
  const restored=restoreRouteVehicle(route.vehicle);
  assert.equal(restored.world.parts.size,2);assert.equal(restored.root.children.get(401)!.condition,.75);
  assert.deepEqual(restored.root.children.get(401)!.local,block.local);
  assert.deepEqual(restored.root.renderAdjustment,root.renderAdjustment);
  assert.deepEqual(restored.root.slotPositions.get(401),[0,.8,0]);
  restored.root.definition.config.slots[0].position[0]=99;
  assert.equal(root.definition.config.slots[0].position[0],0);
  restored.world.dispose();world.dispose();
});

test('route interpolation preserves quaternions, COM and independent observer/focus',()=>{
  const {recorder,world}=capture(),route=parseRouteBenchmark(recorder.benchmarkText()!),play=new RoutePlayback(route),pose=play.pose(.05);
  assert.ok(Math.abs(pose.position[0]-1.5)<1e-9);
  const expected=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/4);
  assert.ok(new Quaternion().fromArray(pose.rotation).angleTo(expected)<1e-7);
  const center=new Vector3().fromArray(route.vehicle.bodyCenter),matrix=routeBodyMatrix(pose,center);
  assert.ok(center.clone().applyMatrix4(matrix).distanceTo(new Vector3().fromArray(pose.position))<1e-9);
  assert.deepEqual(play.view(.05).observer!.position,[0,100,0]);
  assert.notDeepEqual(play.view(.05).primary.position,play.view(.05).focus);
  assert.deepEqual(play.pose(10).position,route.poses.at(-1)!.position);world.dispose();
});

test('single-tick gear pulses survive capture and differently batched playback',()=>{
  const {recorder,world}=capture(),route=parseRouteBenchmark(recorder.benchmarkText()!),play=new RoutePlayback(route);
  for(const batch of [1,4,8]){
    const shifts:number[]=[];
    for(let frame=0;frame<48/batch;frame++)for(let sub=0;sub<batch;sub++){
      const tick=frame*batch+sub;if(play.input(tick/240).gearUp)shifts.push(tick);
    }
    assert.deepEqual(shifts,[1]);
  }
  world.dispose();
});

test('source frame baseline retains real stalls, draw counts and resolution while excluding hidden-tab gaps',()=>{
  const {recorder,world}=capture(),route=parseRouteBenchmark(recorder.benchmarkText()!),summary=routeSourceSummary(route)!;
  assert.deepEqual(route.sourceRender!.frameIntervalsMs,[16,16,48,16]);
  assert.equal(summary.frames,4);assert.equal(summary.wall_s,.096);assert.ok(Math.abs(summary.mean_fps-1000/24)<1e-10);
  assert.equal(summary.max_ms,48);assert.equal(summary.p95_ms,48);assert.equal(summary.average_draws,100);assert.equal(summary.average_triangles,1000);
  assert.equal(summary.width,1920);assert.equal(summary.height,1080);
  delete route.sourceRender;
  assert.equal(routeSourceSummary(parseRouteBenchmark(JSON.stringify(route))),undefined,'older routes remain playable');
  world.dispose();
});

test('physics checkpoints restore tick-time state independently of render batching and report corrections',()=>{
  const {recorder,world}=capture(),playback=new RoutePlayback(parseRouteBenchmark(recorder.benchmarkText()!));
  const run=(batch:number)=>{
    const checkpoints=new RouteCheckpoints(),position=new Vector3().fromArray(playback.pose(0).position),times:number[]=[];
    for(let frame=0;frame<240/batch;frame++)for(let sub=0;sub<batch;sub++){
      const time=(frame*batch+sub)/240;
      checkpoints.apply(time,position,playback,pose=>{position.fromArray(pose.position);times.push(pose.t);});
      position.x+=1/240;
    }
    assert.equal(checkpoints.count,9);assert.ok(checkpoints.maxCorrection>0);assert.ok(checkpoints.rmsCorrection>0);
    assert.deepEqual(times.map(t=>Math.round(t*10)),[1,2,3,4,5,6,7,8,9]);
    return {times,position:position.toArray(),max:checkpoints.maxCorrection,rms:checkpoints.rmsCorrection};
  };
  assert.deepEqual(run(1),run(4));assert.deepEqual(run(4),run(8));world.dispose();
});

test('route loader rejects malformed timings, rotations, controls and attachment cycles',()=>{
  const {recorder,world}=capture(),route=parseRouteBenchmark(recorder.benchmarkText()!);
  for(const edit of [
    (r:typeof route)=>{r.poses[1].t=0;},
    (r:typeof route)=>{r.poses[1].rotation=[0,0,0,0];},
    (r:typeof route)=>{r.controls[0].input.throttle=2;},
    (r:typeof route)=>{r.vehicle.mass=-1;},
    (r:typeof route)=>{r.vehicle.parts[0].parent=r.vehicle.parts[1].id;},
  ]){const copy=structuredClone(route);edit(copy);assert.throws(()=>parseRouteBenchmark(JSON.stringify(copy)));}
  world.dispose();
});
