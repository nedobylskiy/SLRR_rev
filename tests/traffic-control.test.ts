import {test} from 'node:test';import assert from 'node:assert/strict';
import {Vector3,Box3} from 'three';
import {TrafficControl,trafficFixtureKind} from '../src/engine/traffic-control';
import {Bot} from '../src/engine/bot';import {RoadTrafficCar} from '../src/engine/road-traffic';import {TrafficVehicle} from '../src/engine/traffic-vehicle';
import type {RoadNetwork,RoadOther,RoadPoint,RoadSegment} from '../src/formats/trc';
const segment=(start:RoadPoint,end:RoadPoint):RoadSegment=>{const tangent=end.map((v,i)=>v-start[i]) as RoadPoint;return {start,end,startTangent:tangent,endTangent:tangent,length:Math.hypot(...tangent),raw:new Uint32Array(14),flag:0};};
const road=(id:number,start:RoadPoint,end:RoadPoint,branch=id):RoadOther=>({id,refs:[branch,0],raw:new Uint32Array(12),extraRefs:[],tail:new Uint32Array(3),flag:0,segments:[segment(start,end)]});
function network():RoadNetwork{return {version:1,bytes:0,paths:[],others:[road(2,[100,0,0],[0,0,0],10),road(3,[100,0,3],[0,0,3],10),road(4,[103,0,5],[103,0,100],20),road(5,[200,0,0],[105,0,0],30)],nodes:[{id:1,group:1,position:[100,0,0],raw:new Uint32Array(4),links:[{target:2,flag:1},{target:3,flag:1},{target:4,flag:1},{target:5,flag:0}],lanes:[{header:new Uint8Array(12),segment:segment([105,0,0],[100,0,0])},{header:new Uint8Array(12),segment:segment([105,0,0],[103,0,5])}]}]};}
const fixtures=[{kind:'signal' as const,position:new Vector3(100,0,0)},{kind:'signal' as const,position:new Vector3(103,0,5)}];
test('one green approach at a time; green 20s, blocking yellow 5s, other lanes red',()=>{
 const control=new TrafficControl(network(),fixtures,()=>0);
 assert.equal(control.state(1,10),'green');assert.equal(control.state(1,20),'red');
 assert.equal(control.rule(2)?.branch,control.rule(3)?.branch,'one signal governs all incoming lanes of the same branch');
 control.advance(20);assert.equal(control.state(1,10),'yellow');assert.equal(control.state(1,20),'red');
 control.advance(5);assert.equal(control.state(1,10),'red');assert.equal(control.state(1,20),'green');
 control.advance(25);assert.equal(control.state(1,10),'green');
});
test('initial direction may vary but ordering remains fixed, with stop fallback for an unsignaled approach',()=>{
 const control=new TrafficControl(network(),fixtures,()=>.999);assert.equal(control.state(1,20),'green');
 const missing=new TrafficControl(network(),fixtures.slice(0,1),()=>0);assert.equal(missing.rule(4)?.kind,'stop');
 const empty=new TrafficControl(network(),[]);assert.equal(empty.rules.size,0);
});
test('signals override STOP/YIELD markings on the same approach regardless of fixture loading order',()=>{
 for(const kind of ['stop','yield'] as const)for(const reverse of [false,true]){
  const entries=[{kind,position:new Vector3(100,0,0)},...fixtures];if(reverse)entries.reverse();
  const control=new TrafficControl(network(),entries,()=>0);
  assert.equal(control.rule(2)?.kind,'signal');assert.equal(control.rule(3)?.kind,'signal');assert.equal(control.state(1,10),'green');
 }
});
test('a real signal binds to its nearest crossing in either pool; numbered decorative signs are not guessed',()=>{
 const graph=network();graph.nodes.unshift({...graph.nodes[0],id:99,group:0,position:[100,0,0]});
 const control=new TrafficControl(graph,fixtures.slice(0,1),()=>0);
 assert.equal(control.signals.length,1);assert.equal(control.signals[0].crossing,99);
 assert.equal(control.rule(2)?.kind,'signal');assert.equal(control.rule(2)?.crossing,99);
 assert.equal(trafficFixtureKind('trafficlamp','trlight'),'signal');assert.equal(trafficFixtureKind('stop_sign'),'stop');assert.equal(trafficFixtureKind('yield_1'),'yield');assert.equal(trafficFixtureKind('tabla_a'),undefined);
});
function car(control:TrafficControl,spawn=70){
 const graph=control.network,route=new RoadTrafficCar(graph,new Vector3(spawn,0,0),()=>0);
 const wheels=[[-.86,-.747,-1.74],[.86,-.747,-1.74],[-.86,-.747,1.27],[.86,-.747,1.27]].map(position=>({position:position as RoadPoint,rotation:[0,0,0] as RoadPoint,radius:.36,parameters:[]}));
 const vehicle=new TrafficVehicle(new Box3(new Vector3(-1,-.8,-2.5),new Vector3(1,1.2,2.5)),1400,wheels,{height:()=>0,normal:()=>new Vector3(0,1,0)});vehicle.place(route.position,route.direction,1.107);
 return new Bot(route,vehicle,()=>0,15/3.6,control);
}
test('physical bot brakes for red/yellow without reversing; after passing the line it ignores later changes',()=>{
 const control=new TrafficControl(network(),fixtures,()=>.999),bot=car(control);
 for(let i=0;i<1100;i++)bot.advance(1/60);
 assert.ok(bot.vehicle.body.position.x<97.5);assert.ok(bot.vehicle.body.velocity.length()<.25);assert.equal(bot.mode,'cruise');
 control.time=0; // The blocked branch stays red; test passing before a phase change separately.
 const clear=new TrafficControl(network(),fixtures,()=>0),entered=car(clear,98);
 entered.advance(1/60);clear.advance(20);entered.advance(1/60);
 assert.ok(entered.desiredSpeed>0);assert.equal(entered.trafficStatus,'');
});
test('crossing the line on red does not grant permission or advance the navigation cursor into the junction',()=>{
 const control=new TrafficControl(network(),fixtures,()=>.999),bot=car(control,96);
 for(let i=0;i<120;i++)bot.advance(1/60);
 bot.vehicle.body.position.x=98;bot.vehicle.body.velocity.set(0,0,0);bot.advance(1/60);
 assert.equal(bot.input.throttle,0);assert.equal(bot.input.brake,true);assert.match(bot.trafficStatus,/red/);
 bot.vehicle.body.position.x=100.2;bot.advance(1/60);
 assert.equal(bot.route.phase,'road #2');assert.equal(bot.input.throttle,0);assert.equal(bot.input.brake,true);
 control.time=25;for(let i=0;i<100;i++)bot.advance(1/60);
 assert.ok(bot.input.throttle>0||bot.route.phase!=='road #2');
});
test('being beyond a STOP line does not bypass the five-second stationary wait',()=>{
 const control=new TrafficControl(network(),[{kind:'stop',position:new Vector3(100,0,0)}]),bot=car(control,98);
 for(let i=0;i<240;i++)bot.advance(1/60);
 assert.equal(bot.input.throttle,0);assert.equal(bot.input.brake,true);assert.match(bot.trafficStatus,/stop/);
});
for(const kind of ['stop','yield'] as const)test(`${kind} holds a real car for five stopped seconds and then releases without a traffic query`,()=>{
 const control=new TrafficControl(network(),[{kind,position:new Vector3(100,0,0)}]),bot=car(control);
 let stoppedAt=-1,passedAt=-1;
 for(let i=0;i<1800;i++){
  bot.advance(1/60);const x=bot.vehicle.body.position.x;
  if(x>93&&bot.vehicle.body.velocity.length()<.2&&stoppedAt<0)stoppedAt=i/60;
  if(x>97.6){passedAt=i/60;break;}
 }
 assert.ok(stoppedAt>=0);assert.ok(passedAt-stoppedAt>=4.9,`wait ${passedAt-stoppedAt}s`);assert.ok(passedAt<30);assert.equal(bot.mode,'cruise');
});
