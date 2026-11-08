import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Box3, Matrix4, Vector3 } from 'three';
import { Bot, type BotVehicle } from '../src/engine/bot';
import { TrafficVehicle, TrafficCrush } from '../src/engine/traffic-vehicle';
import { RoadTrafficCar } from '../src/engine/road-traffic';
import { RigidBody3D } from '../src/engine/rigid-body-3d';
import type { RoadNetwork, RoadSegment, RoadPoint, RoadOther } from '../src/formats/trc';
import type { DrivingInput } from '../src/engine/driving-demo';

const bounds=new Box3(new Vector3(-1,-.8,-2.5),new Vector3(1,1.2,2.5));
function segment(a:RoadPoint,b:RoadPoint):RoadSegment{const tangent=b.map((v,i)=>v-a[i]) as RoadPoint;return {start:a,end:b,startTangent:tangent,endTangent:tangent,length:Math.hypot(...tangent),raw:new Uint32Array(14),flag:0};}
function network():RoadNetwork{
  const road=(id:number,start:RoadPoint,end:RoadPoint):RoadOther=>({id,refs:[id+100,0],extraRefs:[],flag:0,raw:new Uint32Array(12),tail:new Uint32Array(3),segments:[segment(start,end)]});
  return {version:1,bytes:0,paths:[],others:[road(2,[100,0,0],[0,0,0]),road(3,[200,0,0],[102,0,0])],nodes:[{id:1,group:1,position:[100,0,0],raw:new Uint32Array(4),links:[{target:2,flag:1},{target:3,flag:0}],lanes:[{header:new Uint8Array(12),segment:segment([102,0,0],[100,0,0])}]}]};
}
class HeldVehicle implements BotVehicle {
  body=new RigidBody3D(1400,bounds.clone());collisionVersion=0;
  constructor(){this.body.setFrame(new Matrix4().makeRotationY(-Math.PI/2).setPosition(10,0,0));}
  step(_dt:number,_input:DrivingInput){} // Controlled immobility models a blocked vehicle, not its suspension.
  impact(){this.collisionVersion++;}
}
function advance(bot:Bot,seconds:number,peers:RigidBody3D[]=[]){for(let i=0;i<Math.round(seconds*60);i++)bot.advance(1/60,peers);}

test('bot waits one stopped second after impact, recovers without teleport, then resumes cruise',()=>{
  const vehicle=new HeldVehicle(),route=new RoadTrafficCar(network(),new Vector3(10,0,0)),bot=new Bot(route,vehicle),body=vehicle.body;
  vehicle.body.position.z=6;
  bot.hit(new Vector3(0,0,1000),body.position.clone(),8);
  assert.equal(bot.mode,'impact');advance(bot,.9);assert.equal(bot.mode,'impact');
  advance(bot,.2);assert.equal(bot.mode,'recover');assert.ok(bot.input.throttle>0);assert.equal(body.position.z,6);assert.equal(vehicle.body,body);
  body.position.z=0;advance(bot,.1);assert.equal(bot.mode,'cruise');assert.equal(vehicle.collisionVersion,1);
});

test('a blocked bot reverses for 3.5 seconds with full steering, then tries again',()=>{
  const vehicle=new HeldVehicle(),bot=new Bot(new RoadTrafficCar(network(),new Vector3(10,0,0)),vehicle,()=>0);
  advance(bot,2.2);assert.equal(bot.mode,'reverse');assert.equal(bot.input.steer,-1);assert.ok(bot.input.throttle<0);
  advance(bot,3.2);assert.equal(bot.mode,'reverse');advance(bot,.4);assert.notEqual(bot.mode,'reverse');
  assert.equal(vehicle.body.position.x,10);assert.equal(vehicle.body.position.z,0);
});

test('queuing behind a car requests zero speed and does not trigger the stuck reverse maneuver',()=>{
  const vehicle=new HeldVehicle(),bot=new Bot(new RoadTrafficCar(network(),new Vector3(10,0,0)),vehicle);
  const peer=new RigidBody3D(1400,bounds.clone());peer.position.copy(vehicle.body.position).add(new Vector3(6,0,0));
  advance(bot,5,[peer]);assert.equal(bot.desiredSpeed,0);assert.equal(bot.input.throttle,0);assert.equal(bot.mode,'cruise');
  peer.position.z=20;advance(bot,.1,[peer]);assert.ok(bot.input.throttle>.5);
});

test('traffic body is supported on four springs, drives through physical forces, and retains dents on impact',()=>{
  const wheels=[[-.86,-.747,-1.74],[.86,-.747,-1.74],[-.86,-.747,1.27],[.86,-.747,1.27]].map(position=>({position:position as RoadPoint,rotation:[0,0,0] as RoadPoint,radius:.36,parameters:[]}));
  const vehicle=new TrafficVehicle(bounds.clone(),1400,wheels,{height:()=>0,normal:()=>new Vector3(0,1,0)});
  const route=new RoadTrafficCar(network(),new Vector3(10,0,0));vehicle.place(route.position,route.direction,1.107);const bot=new Bot(route,vehicle);
  advance(bot,10);assert.ok(vehicle.body.position.x>40);assert.ok(Math.abs(vehicle.body.position.z)<.15);
  assert.ok(vehicle.wheels.every(w=>w.contact));assert.ok(Math.abs(vehicle.body.velocity.length()*3.6-15)<.2);
  assert.equal(vehicle.crush.version,0);const before=vehicle.body.velocity.clone();
  const hit=new Vector3(-7000,0,0),point=vehicle.body.position.clone().add(new Vector3(2,0,0));bot.hit(hit,point,12);
  assert.equal(bot.mode,'impact');assert.equal(vehicle.crush.version,1);assert.ok(vehicle.body.velocity.x<before.x);
  const damage=vehicle.crush.offsets.slice();advance(bot,.5);assert.deepEqual(vehicle.crush.offsets,damage);
});

test('crush fields and physics belong to an instance while immutable road graph buffers are shared',()=>{
  const graph=network(),a=new RoadTrafficCar(graph),b=new RoadTrafficCar(graph);assert.equal(a.connections,b.connections);
  const first=new TrafficCrush(bounds.clone()),second=new TrafficCrush(bounds.clone());
  first.hit(new Vector3(1,0,2),new Vector3(-7000,0,-2000),15,1400);
  assert.ok(first.offsets.some(v=>v!==0));assert.ok(second.offsets.every(v=>v===0));assert.equal(second.version,0);
});
