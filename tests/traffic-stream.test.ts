import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Box3,Vector3,Group,Mesh,BoxGeometry,MeshBasicMaterial,PerspectiveCamera,Frustum,Matrix4,Sphere} from 'three';
import {TrafficDamageView} from '../src/render/traffic-damage-view';
import {TrafficSpawnIndex,TrafficVehicleLod,initializeTrafficMotion,safeTrafficSpawn,chooseSafeTrafficSpawn,trafficCruiseSpeed,type TrafficSpawn} from '../src/engine/traffic-stream';
import {TrafficVehicle} from '../src/engine/traffic-vehicle';
import {RoadTrafficCar,trafficRoadSpeedGroups} from '../src/engine/road-traffic';
import {Bot} from '../src/engine/bot';
import {TrafficControl} from '../src/engine/traffic-control';
import type {RoadNetwork,RoadPoint,RoadSegment,RoadOther} from '../src/formats/trc';

const segment=(start:RoadPoint,end:RoadPoint):RoadSegment=>{const tangent=end.map((n,i)=>n-start[i]) as RoadPoint;return {start,end,startTangent:tangent,endTangent:tangent,length:Math.hypot(...tangent),raw:new Uint32Array(14),flag:0};};
function graph():RoadNetwork{
 const road=(id:number,start:RoadPoint,end:RoadPoint):RoadOther=>({id,refs:[id+100,0],raw:new Uint32Array(12),extraRefs:[],tail:new Uint32Array(3),flag:0,segments:[segment(start,end)]});
 return {version:1,bytes:0,paths:[],others:[road(2,[500,0,0],[0,0,0]),road(3,[1000,0,0],[502,0,0]),road(4,[0,0,50],[1000,0,50])],nodes:[{id:1,group:1,position:[500,0,0],raw:new Uint32Array(4),links:[{target:2,flag:1},{target:3,flag:0}],lanes:[{header:new Uint8Array(12),segment:segment([502,0,0],[500,0,0])}]}]};
}
function car(){
 const route=new RoadTrafficCar(graph(),new Vector3(100,0,0),()=>0,2);
 const wheels=[[-.86,-.747,-1.74],[.86,-.747,-1.74],[-.86,-.747,1.27],[.86,-.747,1.27]].map(position=>({position:position as RoadPoint,rotation:[0,0,0] as RoadPoint,radius:.36,parameters:[]}));
 const vehicle=new TrafficVehicle(new Box3(new Vector3(-1,-.8,-2.5),new Vector3(1,1.2,2.5)),1400,wheels,{height:()=>0,normal:()=>new Vector3(0,1,0)});
 vehicle.place(route.position,route.direction,1.107);const lod=new TrafficVehicleLod(vehicle,route,1.107),bot=new Bot(route,lod,()=>.5);return {route,vehicle,lod,bot};
}

test('spawn speed is rural with a yellow crossing at either end of the road',()=>{
 const network=graph();
 network.others.push({id:9,refs:[109,0],raw:new Uint32Array(12),extraRefs:[],tail:new Uint32Array(3),flag:0,segments:[segment([-2,0,0],[-100,0,0])]});
 network.nodes.push({id:8,group:0,position:[0,0,0],raw:new Uint32Array(4),links:[{target:9,flag:1},{target:2,flag:0}],lanes:[{header:new Uint8Array(12),segment:segment([0,0,0],[-2,0,0])}]});
 const groups=trafficRoadSpeedGroups(network);assert.equal(groups.get(2),0,'yellow upstream, pink downstream');assert.equal(groups.get(3),1);
 const route=new RoadTrafficCar(network,new Vector3(100,0,0),()=>0,2),{vehicle}=car(),lod=new TrafficVehicleLod(vehicle,route,1.107);
 vehicle.place(route.position,route.direction,1.107);const bot=initializeTrafficMotion(route,lod,undefined,[],()=>.5);
 assert.ok(Math.abs(bot.cruiseSpeed*3.6-80)<1e-8);assert.ok(Math.abs(vehicle.body.velocity.length()*3.6-80)<1e-8);assert.ok(vehicle.body.velocity.dot(route.direction)>0);assert.ok(bot.rpm>850);
 assert.ok(Math.abs(trafficCruiseSpeed(1,()=>0)*3.6-15)<1e-8);assert.ok(Math.abs(trafficCruiseSpeed(1,()=>1)*3.6-35)<1e-8);
});

test('yellow destination takes priority over pink origin and remains rural after exiting the pink crossing',()=>{
 const network=graph();network.nodes.push({id:8,group:0,position:[1000,0,0],raw:new Uint32Array(4),links:[{target:3,flag:1}],lanes:[]});
 const groups=trafficRoadSpeedGroups(network);assert.equal(groups.get(2),1);assert.equal(groups.get(3),0);
 const reversed={...network,nodes:[...network.nodes].reverse()};assert.equal(trafficRoadSpeedGroups(reversed).get(3),0,'yellow wins regardless of record ordering');
 const route=new RoadTrafficCar(network,new Vector3(499,0,0),()=>0,2),{vehicle}=car(),lod=new TrafficVehicleLod(vehicle,route,1.107);
 vehicle.place(route.position,route.direction,1.107);const bot=initializeTrafficMotion(route,lod,undefined,[],()=>.5);
 route.follow(new Vector3(500,0,0));route.follow(new Vector3(502,0,0));vehicle.body.position.copy(route.position);bot.command(1/60);
 assert.equal(route.lastCrossingGroup,1);assert.equal(route.speedGroup,0);assert.ok(Math.abs(bot.cruiseSpeed*3.6-80)<1e-8);
});

test('spawn velocity respects an existing queue instead of appearing at cruise speed into a stopped car',()=>{
 const {route,vehicle,lod}=car(),peer=car().vehicle.body;peer.position.copy(vehicle.body.position).add(new Vector3(6,0,0));
 const bot=initializeTrafficMotion(route,lod,undefined,[peer],()=>.5);
 assert.ok(bot.cruiseSpeed>0);assert.equal(vehicle.body.velocity.length(),0);assert.equal(bot.desiredSpeed,0);
});

test('initial velocity is capped by a red light near the spawn point',()=>{
 const network=graph(),route=new RoadTrafficCar(network,new Vector3(497,0,0),()=>0,2),{vehicle}=car(),lod=new TrafficVehicleLod(vehicle,route,1.107);
 vehicle.place(route.position,route.direction,1.107);const control=new TrafficControl(network,[]);
 control.rules.set(2,{kind:'signal',crossing:1,branch:102});
 const bot=initializeTrafficMotion(route,lod,control,[],()=>.5);
 assert.equal(vehicle.body.velocity.length(),0);assert.equal(bot.desiredSpeed,0);assert.match(bot.trafficStatus,/red/);
});

test('safe spawn rejects near visible/front cars, closing paths and leaves unfillable population slots empty',()=>{
 const center=new Vector3(),forward=new Vector3(1,0,0);
 const spawn=(x:number,z=0):TrafficSpawn=>({road:2,position:new Vector3(x,0,z),direction:forward.clone(),speedGroup:1});
 assert.equal(safeTrafficSpawn(spawn(30),center,forward,0,true,[],3),false);
 assert.equal(safeTrafficSpawn(spawn(30),center,forward,0,false,[],3),false,'looking away must not spawn immediately ahead of the car');
 assert.equal(safeTrafficSpawn(spawn(90),center,forward,0,true,[],3),true);
 assert.equal(safeTrafficSpawn(spawn(90),center,forward,30,true,[],3),false,'fast player gets a larger front exclusion zone');
 assert.equal(safeTrafficSpawn(spawn(-40),center,forward,0,false,[],3),true);
 const peer=Object.assign(new Vector3(100,0,0),{trafficRadius:3,trafficVelocity:new Vector3()});
 assert.equal(safeTrafficSpawn(spawn(90),center,forward,0,true,[peer],3),false,'would catch a stationary car immediately');
 const index=new TrafficSpawnIndex(graph()),focus=new Vector3(200,0,0),occupied:Vector3[]=[];
 for(let i=0;i<50;i++){const found=index.choose(focus,40,occupied,()=>.5,15,true,undefined,3,s=>safeTrafficSpawn(s,focus,forward,0,true,occupied,3));if(found)occupied.push(found.position);}
 assert.equal(occupied.length,0,'the requested cap cannot bypass the visible-distance rule');
});

test('safe streaming expands only into blind areas and treats quantity as a cap',()=>{
 const index=new TrafficSpawnIndex(graph()),center=new Vector3(200,0,0),forward=new Vector3(1,0,0);
 const blind=(s:TrafficSpawn)=>s.position.x<160;
 const hidden=chooseSafeTrafficSpawn(index,center,40,150,[],forward,0,3,blind,()=>.5);
 assert.ok(hidden);assert.ok(blind(hidden));assert.ok(hidden.position.distanceTo(center)>40);assert.ok(hidden.position.distanceTo(center)<=150);
 assert.equal(chooseSafeTrafficSpawn(index,center,40,150,[],forward,0,3,()=>false),undefined,'visible positions outside the preferred radius are not fallback spawns');
 assert.equal(chooseSafeTrafficSpawn(index,center,40,40,[],forward,0,3,blind),undefined,'never expand beyond map streaming');
 const occupied:Vector3[]=[];
 for(let i=0;i<50;i++){const spawn=chooseSafeTrafficSpawn(index,center,40,150,occupied,forward,0,3,blind,()=>.5);if(spawn)occupied.push(spawn.position.clone());}
 assert.ok(occupied.length>0&&occupied.length<50);assert.ok(occupied.every(p=>p.x<160));
});

test('stream spawn samples belong to connected graph lanes, stay inside the radius and avoid occupied space',()=>{
 const index=new TrafficSpawnIndex(graph()),occupied:Vector3[]=[];
 for(let i=0;i<10;i++){const spawn=index.choose(new Vector3(200,0,0),200,occupied,()=>.5,20);assert.ok(spawn);assert.equal(spawn.road,2);assert.equal(spawn.position.z,0);assert.ok(spawn.position.distanceTo(new Vector3(200,0,0))<=200);assert.ok(occupied.every(p=>p.distanceTo(spawn.position)>=14));occupied.push(spawn.position.clone());}
 assert.equal(index.choose(new Vector3(-1000,0,0),50,[]),undefined);
 const moved=index.choose(new Vector3(450,0,0),45,[],()=>0,10);assert.ok(moved);assert.ok(Math.abs(moved.position.x-450)<=45);
});

test('near-preferred spawning chooses the closest free lane and does not expand a small spawn radius',()=>{
 const index=new TrafficSpawnIndex(graph()),center=new Vector3(200,0,0);
 const first=index.choose(center,40,[],()=>.5,15,true);assert.ok(first);assert.ok(Math.abs(first.position.distanceTo(center)-30)<1e-8);
 const second=index.choose(center,40,[first.position],()=>.5,15,true);assert.ok(second);assert.ok(Math.abs(second.position.distanceTo(center)-30)<1e-8);assert.notEqual(second.position.x,first.position.x);
 assert.equal(index.choose(center,40,[first.position,second.position],()=>.5,15,true),undefined,'no fallback to the larger visibility radius');
 const moved=index.choose(new Vector3(350,0,0),100,[],()=>.5,15,true);assert.ok(moved);assert.ok(Math.abs(moved.position.distanceTo(new Vector3(350,0,0))-20)<1e-8);
});

test('long Java traffic models reserve more spawn clearance than pickups',()=>{
 const index=new TrafficSpawnIndex(graph()),center=new Vector3(200,0,0),truck=Object.assign(new Vector3(170,0,0),{trafficRadius:40});
 const spawn=index.choose(center,100,[truck],()=>.5,15,true,undefined,30);assert.ok(spawn);assert.ok(Math.abs(spawn.position.x-250)<1e-8);assert.ok(spawn.position.distanceTo(truck)>=72);
});

test('offscreen spawn preference wins over distance, with visible fallback if offscreen lanes are occupied or absent',()=>{
 const index=new TrafficSpawnIndex(graph()),center=new Vector3(200,0,0);
 const camera=new PerspectiveCamera(60,1,.1,500);camera.position.set(160,1.5,0);camera.lookAt(300,1.5,0);camera.updateMatrixWorld();
 const frustum=new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
 const offscreen=(spawn:{position:Vector3})=>!frustum.intersectsSphere(new Sphere(spawn.position.clone().add(new Vector3(0,1.5,0)),4));
 const hidden=index.choose(center,100,[],()=>.5,15,true,offscreen);assert.ok(hidden);assert.ok(offscreen(hidden));assert.ok(hidden.position.x<160);assert.ok(hidden.position.distanceTo(center)>30,"offscreen candidate may be farther than a visible free lane");
 const blocked=[new Vector3(110,0,0),new Vector3(130,0,0),new Vector3(150,0,0),new Vector3(170,0,0)];
 const fallback=index.choose(center,100,blocked,()=>.5,15,true,offscreen);assert.ok(fallback);assert.equal(offscreen(fallback),false);assert.ok(Math.abs(fallback.position.x-230)<1e-8);
 const ordinary=index.choose(center,40,[],()=>.5,15,true,()=>false);assert.ok(ordinary);assert.ok(Math.abs(ordinary.position.distanceTo(center)-30)<1e-8);
});

test('puppets follow lanes and animate wheels without invoking the physical solver',()=>{
 const {vehicle,lod,bot}=car();let physics=0;const physicalStep=vehicle.step.bind(vehicle);vehicle.step=(dt,input)=>{physics++;physicalStep(dt,input);};
 for(let i=0;i<180;i++)bot.advance(1/60);
 assert.equal(physics,0);assert.equal(lod.physical,false);assert.ok(vehicle.body.position.x>105);assert.ok(Math.abs(vehicle.body.position.z)<.01);assert.ok(vehicle.wheels.some(w=>w.spin>0));
});

test('LOD handoffs retain pose, speed and dents, use hysteresis, and wake physics for impact',()=>{
 const {vehicle,lod,bot}=car();vehicle.body.velocity.set(5,0,0);
 vehicle.crush.hit(new Vector3(0,0,1),new Vector3(9000,0,0),10,1400);const dents=vehicle.crush.offsets.slice();
 const position=vehicle.body.position.clone(),velocity=vehicle.body.velocity.clone();
 lod.updateRange(new Vector3(75,0,0),30);assert.equal(lod.physical,true);assert.ok(vehicle.body.position.equals(position));assert.ok(vehicle.body.velocity.equals(velocity));assert.deepEqual(vehicle.crush.offsets,dents);
 lod.updateRange(new Vector3(65,0,0),30);assert.equal(lod.physical,true);
 lod.updateRange(new Vector3(50,0,0),30);assert.equal(lod.physical,false);
 lod.updateRange(new Vector3(75,0,0),30);let physics=0;const step=vehicle.step.bind(vehicle);vehicle.step=(dt,input)=>{physics++;step(dt,input);};bot.advance(1/60);assert.equal(physics,1);
 lod.updateRange(new Vector3(-100,0,0),30);lod.impact(new Vector3(2000,0,0),vehicle.body.position,3);assert.equal(lod.physical,true);
});

test('distant puppets retain following/braking rather than passing through queued vehicles',()=>{
 const {vehicle,bot}=car(),peer=car().vehicle.body;peer.position.copy(vehicle.body.position).add(new Vector3(6,0,0));
 for(let i=0;i<120;i++)bot.advance(1/60,[peer]);assert.equal(bot.desiredSpeed,0);assert.equal(bot.input.brake,true);assert.ok(vehicle.body.position.x<101);
});

test('recycling a damaged visual restores shared template geometry and frees only its private skin',()=>{
 const {vehicle}=car(),group=new Group(),base=new BoxGeometry(2,2,4),material=new MeshBasicMaterial(),mesh=new Mesh(base,material);group.add(mesh);
 const view=new TrafficDamageView(group,vehicle.crush);
 vehicle.crush.hit(new Vector3(0,0,1),new Vector3(9000,0,0),10,1400);view.update();assert.notEqual(mesh.geometry,base);
 let disposed=0;mesh.geometry.addEventListener('dispose',()=>disposed++);view.reset();assert.equal(mesh.geometry,base);assert.equal(disposed,1);
 vehicle.crush.offsets.fill(0);vehicle.crush.version=0;view.update();assert.equal(mesh.geometry,base);view.dispose();base.dispose();material.dispose();
});
