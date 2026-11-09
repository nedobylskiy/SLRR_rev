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

test('traffic chooses a new cruise speed after exiting yellow or pink crossings, once per exit',()=>{
  for(const [group,low,high] of [[0,60,100],[1,15,35]] as const)for(const sample of [0,.999]){
    const graph=network();graph.nodes[0].group=group;
    const route=new RoadTrafficCar(graph,new Vector3(99,0,0),()=>0),vehicle=new HeldVehicle();
    let draws=0;const bot=new Bot(route,vehicle,()=>{draws++;return sample;});
    assert.ok(Math.abs(bot.cruiseSpeed*3.6-15)<1e-8);
    for(let i=0;i<20;i++)route.advance(.1);
    vehicle.body.position.copy(route.position);bot.advance(1/60);
    assert.ok(bot.cruiseSpeed*3.6>=low&&bot.cruiseSpeed*3.6<=high);
    assert.ok(Math.abs(bot.cruiseSpeed*3.6-(low+sample*(high-low)))<1e-8);assert.equal(draws,1);
    bot.advance(1/60);assert.equal(draws,1);
  }
});

test('lane-change lottery runs once per twenty seconds with a ten percent chance, and checks the neighboring traffic gap',()=>{
  for(const sample of [.099,.1]){
    const route=new RoadTrafficCar(network(),new Vector3(10,0,0),()=>0),vehicle=new HeldVehicle();vehicle.body.velocity.set(1,0,0);
    let attempts=0,draws=0,clear=true;
    route.tryChangeLane=(_position,_length,isClear)=>{attempts++;clear=isClear!(new Vector3(10,0,3),new Vector3(1,0,0));return false;};
    const bot=new Bot(route,vehicle,()=>{draws++;return sample;});
    const peer=new RigidBody3D(1400,bounds.clone());peer.position.set(10,0,3);
    advance(bot,19.9,[peer]);assert.equal(draws,0);advance(bot,.2,[peer]);assert.equal(draws,1);assert.equal(attempts,sample<.1?1:0);
    if(sample<.1)assert.equal(clear,false,'adjacent car prevents merging');
    advance(bot,19.9,[peer]);assert.equal(draws,2);assert.equal(attempts,sample<.1?2:0);
  }
});

test('yellow-linked roads attempt lane changes every ten seconds at 25 percent, with the same gap checks',()=>{
  for(const sample of [.249,.25]){
    const graph=network();graph.nodes[0].group=0;
    const route=new RoadTrafficCar(graph,new Vector3(10,0,0),()=>0),vehicle=new HeldVehicle();vehicle.body.velocity.set(1,0,0);
    let attempts=0,draws=0;route.tryChangeLane=()=>{attempts++;return false;};
    const bot=new Bot(route,vehicle,()=>{draws++;return sample;});
    advance(bot,9.9);assert.equal(draws,0);advance(bot,.2);assert.equal(draws,1);assert.equal(attempts,sample<.25?1:0);
  }
});

test('a leader restricting target speed raises urban lane-change chance to twenty percent; a faster leader does not',()=>{
  for(const [leadSpeed,sample,expected] of [[0,.199,1],[0,.2,0],[10,.15,0]] as const){
    const route=new RoadTrafficCar(network(),new Vector3(10,0,0),()=>0),vehicle=new HeldVehicle();vehicle.body.velocity.set(1,0,0);
    const peer=new RigidBody3D(1400,bounds.clone());peer.orientation.copy(vehicle.body.orientation);peer.position.copy(vehicle.body.position).add(new Vector3(leadSpeed?20:10,0,0));peer.velocity.set(leadSpeed,0,0);
    let attempts=0;route.tryChangeLane=()=>{attempts++;return false;};
    const bot=new Bot(route,vehicle,()=>sample);advance(bot,20.1,[peer]);assert.equal(attempts,expected);
  }
});

test('crossing cruise changes ramp from actual exit speed in both directions; nearby cars still demand immediate braking',()=>{
  for(const [group,exitSpeed] of [[0,20],[1,80]] as const){
    const graph=network();graph.nodes[0].group=group;
    const route=new RoadTrafficCar(graph,new Vector3(99,0,0),()=>0),vehicle=new HeldVehicle();vehicle.body.velocity.set(exitSpeed/3.6,0,0);
    const bot=new Bot(route,vehicle,()=>.5,exitSpeed/3.6);
    for(let i=0;i<20;i++)route.advance(.1);vehicle.body.position.copy(route.position);
    bot.command(1/60);const initial=exitSpeed/3.6;
    assert.ok(Math.abs(bot.cruiseSetpoint-initial)<=1.2/60+1e-9,'no sudden target jump');
    let previous=bot.cruiseSetpoint;
    for(let i=0;i<60;i++){bot.command(1/60);const current=bot.cruiseSetpoint;assert.ok(Math.abs(current-previous)<=1.2/60+1e-9);assert.equal(Math.sign(current-previous),group===0?1:-1);previous=current;}
    const peer=new RigidBody3D(1400,bounds.clone());peer.position.copy(vehicle.body.position).add(new Vector3(5,0,0));
    bot.command(1/60,[peer]);assert.equal(bot.desiredSpeed,0);assert.equal(bot.input.throttle,0);assert.equal(bot.input.brake,true);
  }
});
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
  peer.position.z=20;advance(bot,1.6,[peer]);assert.ok(bot.input.throttle>.5);
});

test('a blocked crossing starts recovery only with room behind and brakes if that room is occupied',()=>{
  for(const rearBlocked of [false,true]){
    const route=new RoadTrafficCar(network(),new Vector3(99,0,0),()=>0);route.follow(new Vector3(100,0,0));assert.equal(route.insideCrossing,true);
    const vehicle=new HeldVehicle();vehicle.body.position.copy(route.position);
    const bot=new Bot(route,vehicle,()=>0),front=new RigidBody3D(1400,bounds.clone()),rear=new RigidBody3D(1400,bounds.clone());
    front.position.copy(vehicle.body.position).add(new Vector3(6,0,0));rear.position.copy(vehicle.body.position).add(new Vector3(-7,0,0));
    const peers=rearBlocked?[front,rear]:[front];advance(bot,3.2,peers);
    assert.equal(bot.mode,rearBlocked?'cruise':'reverse');
    if(!rearBlocked){assert.ok(bot.input.throttle<0);bot.command(1/60,[front,rear]);assert.equal(bot.input.throttle,0);assert.equal(bot.input.brake,true);}
  }
});

test('one stationary minute starts forward ramming despite a queue; contact restores normal impact recovery',()=>{
  const vehicle=new HeldVehicle(),bot=new Bot(new RoadTrafficCar(network(),new Vector3(10,0,0)),vehicle,()=>0);
  const front=new RigidBody3D(1400,bounds.clone());front.position.copy(vehicle.body.position).add(new Vector3(6,0,0));
  advance(bot,59.9,[front]);assert.equal(bot.mode,'cruise');assert.equal(bot.input.throttle,0);
  advance(bot,.2,[front]);assert.equal(bot.mode,'ram');assert.ok(bot.input.throttle>.9);assert.equal(bot.input.brake,false);
  vehicle.collisionVersion++;advance(bot,1/60,[front]);assert.equal(bot.mode,'impact');
  advance(bot,.9,[front]);assert.equal(bot.mode,'impact');advance(bot,.2,[front]);assert.notEqual(bot.mode,'ram');
});

test('reaching 3 km/h resets the minute instead of accumulating separate slow periods',()=>{
  const vehicle=new HeldVehicle(),bot=new Bot(new RoadTrafficCar(network(),new Vector3(10,0,0)),vehicle,()=>0);
  const front=new RigidBody3D(1400,bounds.clone());front.position.copy(vehicle.body.position).add(new Vector3(6,0,0));
  advance(bot,40,[front]);vehicle.body.velocity.set(3/3.6,0,0);advance(bot,1/60,[front]);vehicle.body.velocity.set(0,0,0);advance(bot,40,[front]);assert.equal(bot.mode,'cruise');
  advance(bot,20.2,[front]);assert.equal(bot.mode,'ram');
});

test('creeping below 3 km/h for a minute triggers ramming despite substantial distance travelled',()=>{
  const vehicle=new HeldVehicle(),bot=new Bot(new RoadTrafficCar(network(),new Vector3(10,0,0)),vehicle,()=>0);
  const front=new RigidBody3D(1400,bounds.clone());vehicle.body.velocity.set(2.9/3.6,0,0);
  for(let i=0;i<3607;i++){
    vehicle.body.position.addScaledVector(vehicle.body.velocity,1/60);front.position.copy(vehicle.body.position).add(new Vector3(6,0,0));
    bot.advance(1/60,[front]);if(i===3593)assert.equal(bot.mode,'cruise');
  }
  assert.ok(vehicle.body.position.x>55);assert.equal(bot.mode,'ram');assert.ok(bot.input.throttle>.9);
});

test('a nearly stopped queue holds the brake pedal and releases when the lead vehicle moves away',()=>{
  const vehicle=new HeldVehicle(),bot=new Bot(new RoadTrafficCar(network(),new Vector3(10,0,0)),vehicle);
  const peer=new RigidBody3D(1400,bounds.clone());peer.orientation.copy(vehicle.body.orientation);
  peer.position.copy(vehicle.body.position).add(new Vector3(8.4,0,0));
  advance(bot,4,[peer]);assert.equal(bot.desiredSpeed,0);assert.equal(bot.input.throttle,0);
  assert.equal(bot.input.brake,true);assert.ok((bot.input.brakeAxis??0)>.5);assert.equal(bot.mode,'cruise');
  peer.position.x+=.3;advance(bot,.5,[peer]);assert.equal(bot.input.brake,true,'small queue-gap changes retain the pedal');
  peer.velocity.set(2,0,0);advance(bot,1.6,[peer]);assert.ok(bot.input.throttle>0);assert.equal(bot.input.brake,false);
});

test('each stopped bot samples one 500–1500 ms reaction delay and keeps its brake while waiting',()=>{
  for(const [sample,delay] of [[0,.5],[1,1.5]]){
    let samples=0;const vehicle=new HeldVehicle(),bot=new Bot(new RoadTrafficCar(network(),new Vector3(10,0,0)),vehicle,()=>{samples++;return sample;});
    const peer=new RigidBody3D(1400,bounds.clone());peer.position.copy(vehicle.body.position).add(new Vector3(6,0,0));
    advance(bot,.1,[peer]);peer.position.z=20;
    advance(bot,delay-1/60,[peer]);assert.equal(bot.input.throttle,0);assert.equal(bot.input.brake,true);assert.equal(samples,1);
    advance(bot,2/60,[peer]);assert.ok(bot.input.throttle>0);assert.equal(bot.input.brake,false);assert.equal(samples,1);
  }
});

test('a newly blocked queue cancels reaction time and requires a new delay after clearing again',()=>{
  let samples=0;const vehicle=new HeldVehicle(),bot=new Bot(new RoadTrafficCar(network(),new Vector3(10,0,0)),vehicle,()=>{samples++;return .5;});
  const peer=new RigidBody3D(1400,bounds.clone());peer.position.copy(vehicle.body.position).add(new Vector3(6,0,0));
  advance(bot,.1,[peer]);peer.position.z=20;advance(bot,.7,[peer]);assert.equal(bot.input.brake,true);
  peer.position.z=0;advance(bot,.1,[peer]);peer.position.z=20;advance(bot,.7,[peer]);
  assert.equal(bot.input.throttle,0);assert.equal(bot.input.brake,true);assert.equal(samples,2);
  advance(bot,.4,[peer]);assert.ok(bot.input.throttle>0);assert.equal(bot.input.brake,false);
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

test('a 30 km/h pickup catches a 15 km/h pickup, follows without contact, and accelerates when the lane clears',()=>{
  const graph=network(),terrain={height:()=>0,normal:()=>new Vector3(0,1,0)};
  const wheels=[[-.86,-.747,-1.74],[.86,-.747,-1.74],[-.86,-.747,1.27],[.86,-.747,1.27]].map(position=>({position:position as RoadPoint,rotation:[0,0,0] as RoadPoint,radius:.36,parameters:[]}));
  const leadRoute=new RoadTrafficCar(graph,new Vector3(40,0,0)),rearRoute=leadRoute.spawnBehind(25);
  const make=(route:RoadTrafficCar,speed:number)=>{const vehicle=new TrafficVehicle(bounds.clone(),1400,wheels,terrain);vehicle.place(route.position,route.direction,1.107);return new Bot(route,vehicle,()=>0,speed/3.6);};
  const lead=make(leadRoute,15),rear=make(rearRoute,30),peers=[lead.vehicle.body,rear.vehicle.body];
  let minimumGap=Infinity,maximumSpeed=0;
  for(let i=0;i<600;i++){
    lead.advance(1/60,peers);rear.advance(1/60,peers);
    minimumGap=Math.min(minimumGap,lead.vehicle.body.position.x-rear.vehicle.body.position.x-5);
    maximumSpeed=Math.max(maximumSpeed,rear.vehicle.body.velocity.length()*3.6);
  }
  assert.ok(minimumGap>2,`bumper gap ${minimumGap}`);assert.ok(maximumSpeed>20);
  assert.ok(Math.abs(rear.vehicle.body.velocity.length()*3.6-15)<.7);
  assert.equal(rear.mode,'cruise');assert.equal(rear.vehicle.collisionVersion,0);
  assert.equal(rear.cruiseSpeed,30/3.6);
  advance(rear,1.5);assert.ok(rear.vehicle.body.velocity.length()*3.6>25);
});
