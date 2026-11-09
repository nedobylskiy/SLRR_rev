import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Box3, Vector3 } from 'three';
import { TrafficVehicle } from '../src/engine/traffic-vehicle';
import { Bot } from '../src/engine/bot';
import { RoadTrafficCar, trafficConnections } from '../src/engine/road-traffic';
import { parsePartConfig } from '../src/formats/cfg';
import type { RoadNetwork, RoadOther, RoadPoint, RoadSegment } from '../src/formats/trc';

function segment(start: RoadPoint, end: RoadPoint): RoadSegment {
  const tangent = end.map((v, i) => v - start[i]) as RoadPoint;
  return { start, end, startTangent: tangent, endTangent: tangent, length: Math.hypot(...tangent), raw: new Uint32Array(14), flag: 0 };
}
function road(id: number, start: RoadPoint, end: RoadPoint): RoadOther {
  return { id, refs: [id + 100, 0], raw: new Uint32Array(12), flag: 0, extraRefs: [], tail: new Uint32Array(3), segments: [segment(start, end)] };
}
function junction(): RoadNetwork {
  return { version: 1, bytes: 0, paths: [], others: [road(2, [0, 0, 0], [-10, 0, 0]), road(3, [102, 0, 2], [2, 0, 2]), road(4, [-2, 0, 102], [-2, 0, 2]), road(5, [102, 0, 2], [2, 0, 2])],
    nodes: [{ id: 1, group: 1, position: [0, 0, 0], raw: new Uint32Array(4),
      links: [{ target: 2, flag: 1 }, { target: 3, flag: 0 }, { target: 4, flag: 0 }],
      lanes: [{ header: new Uint8Array(12), segment: segment([2, 0, 2], [0, 0, 0]) }, { header: new Uint8Array(12), segment: segment([-2, 0, 2], [0, 0, 0]) }] }] };
}

function parallelRoads():RoadNetwork {
  const network=junction();
  network.others=[road(2,[200,0,0],[0,0,0]),road(3,[200,0,3],[0,0,3]),road(4,[0,0,-3],[200,0,-3]),road(5,[200,0,6],[0,0,6])];
  for(const road of network.others)road.refs[0]=100;
  const exit=road(9,[300,0,0],[202,0,0]);network.others.push(exit);
  network.nodes[0].links=network.others.map(r=>({target:r.id,flag:r.id===9?0:1}));
  network.nodes[0].lanes=network.others.filter(r=>r.id!==9).map(r=>({header:new Uint8Array(12),segment:segment([202,0,0],r.segments[0].start)}));
  return network;
}

test('steering preview continues from a crossing onto its chosen exit without rerolling',()=>{
  let calls=0;const route=new RoadTrafficCar(junction(),new Vector3(-1,0,0),()=>{calls++;return .999;});
  route.follow(new Vector3(0,0,0));assert.equal(route.insideCrossing,true);
  const point=new Vector3(),direction=new Vector3();route.targetAhead(12,point,direction);
  assert.ok(point.z>10);assert.ok(direction.z>.99);const chosen=calls;
  route.steeringTargetAhead(12,2,point,direction);assert.equal(calls,chosen);assert.ok(point.z>10);
  route.follow(new Vector3(-2,0,2));assert.equal(route.insideCrossing,false);assert.equal(route.crossingsPassed,1);
  assert.ok(route.junctionExitDistance!<.1);
});

test('a long physical bus clears a sharp crossing and continues along the exit',()=>{
  const route=new RoadTrafficCar(junction(),new Vector3(-10,0,0),()=>.999);
  const wheels=[[-1,-.7,-4],[1,-.7,-4],[-1,-.7,4],[1,-.7,4]].map(position=>({position:position as RoadPoint,rotation:[0,0,0] as RoadPoint,radius:.4,parameters:[]}));
  const vehicle=new TrafficVehicle(new Box3(new Vector3(-1.25,-.8,-6),new Vector3(1.25,2.5,6)),10000,wheels,{height:()=>0,normal:()=>new Vector3(0,1,0)});
  vehicle.place(route.position,route.direction,1.1);vehicle.body.velocity.copy(route.direction).multiplyScalar(15/3.6);
  const bot=new Bot(route,vehicle,()=>.5);let previous=vehicle.body.position.clone(),steer=0;
  for(let i=0;i<1800;i++){
    bot.advance(1/60);assert.ok(vehicle.body.position.distanceTo(previous)<.4,'physical motion never teleports');previous.copy(vehicle.body.position);
    assert.ok(Math.abs(bot.input.steer-steer)<=2.5/60+1e-8);steer=bot.input.steer;
  }
  assert.equal(route.crossingsPassed,1);assert.equal(route.roadId,4);assert.equal(bot.mode,'cruise');
  assert.ok(vehicle.body.position.z>25);assert.ok(Math.abs(vehicle.body.position.x+2)<1);
});

test('physical steering slows before a sharp crossing rather than waiting until the bend',()=>{
  const route=new RoadTrafficCar(junction(),new Vector3(-10,0,0),()=>.999);
  const wheels=[[-1,-.7,-4],[1,-.7,-4],[-1,-.7,4],[1,-.7,4]].map(position=>({position:position as RoadPoint,rotation:[0,0,0] as RoadPoint,radius:.4,parameters:[]}));
  const vehicle=new TrafficVehicle(new Box3(new Vector3(-1.25,-.8,-6),new Vector3(1.25,2.5,6)),10000,wheels,{height:()=>0,normal:()=>new Vector3(0,1,0)});
  vehicle.place(route.position,route.direction,1.1);vehicle.body.velocity.copy(route.direction).multiplyScalar(20);
  const bot=new Bot(route,vehicle,()=>.5,20);bot.command(1/60);
  assert.equal(route.insideCrossing,false);assert.ok(bot.desiredSpeed<8);assert.equal(bot.input.brake,true);
});

test('lane changes use adjacent same-direction branch lanes and blend continuously',()=>{
  const graph=parallelRoads();
  const route=new RoadTrafficCar(graph,new Vector3(50,0,0),()=>0);
  assert.equal(route.tryChangeLane(route.position,30),true);assert.equal(route.roadId,3);assert.equal(route.changingLane,true);
  const point=new Vector3(),direction=new Vector3();route.targetAhead(0,point,direction);assert.ok(point.distanceTo(new Vector3(50,0,0))<1e-8,'no lateral teleport');
  route.targetAhead(15,point,direction);assert.ok(Math.abs(point.z-1.5)<1e-8);assert.ok(direction.x>0);
  route.follow(new Vector3(81,0,3));assert.equal(route.changingLane,false);assert.ok(Math.abs(route.position.z-3)<1e-8);
  const near=new RoadTrafficCar(graph,new Vector3(190,0,0));assert.equal(near.tryChangeLane(near.position,30),false);
  const blocked=new RoadTrafficCar(graph,new Vector3(50,0,0));assert.equal(blocked.tryChangeLane(blocked.position,30,()=>false),false);
  graph.others[1].refs[0]=999;graph.others[3].refs[0]=999;
  const opposite=new RoadTrafficCar(graph,new Vector3(50,0,0));assert.equal(opposite.tryChangeLane(opposite.position,30),false,'opposing lane is rejected');
});

test('a physical traffic car steers into the new lane without teleporting or reversing',()=>{
  const route=new RoadTrafficCar(parallelRoads(),new Vector3(50,0,0),()=>0);
  const wheels=[[-.86,-.747,-1.74],[.86,-.747,-1.74],[-.86,-.747,1.27],[.86,-.747,1.27]].map(position=>({position:position as RoadPoint,rotation:[0,0,0] as RoadPoint,radius:.36,parameters:[]}));
  const vehicle=new TrafficVehicle(new Box3(new Vector3(-1,-.8,-2.5),new Vector3(1,1.2,2.5)),1400,wheels,{height:()=>0,normal:()=>new Vector3(0,1,0)});
  vehicle.place(route.position,route.direction,1.107);vehicle.body.velocity.copy(route.direction).multiplyScalar(15/3.6);
  const bot=new Bot(route,vehicle,()=>.5),before=vehicle.body.position.clone();
  assert.equal(route.tryChangeLane(route.position,30),true);assert.ok(vehicle.body.position.equals(before));
  let previous=before.clone();
  for(let i=0;i<720;i++){bot.advance(1/60);assert.ok(vehicle.body.position.distanceTo(previous)<.15);previous.copy(vehicle.body.position);}
  assert.equal(route.changingLane,false);assert.equal(bot.mode,'cruise');assert.ok(Math.abs(vehicle.body.position.z-3)<.2);
});

test('speed regime changes only after leaving the crossing',()=>{
  const graph=junction();graph.nodes[0].group=0;const car=new RoadTrafficCar(graph,new Vector3(-1,0,0),()=>0);
  assert.equal(car.lastCrossingGroup,undefined);
  for(let i=0;i<20;i++)car.advance(.1);
  assert.equal(car.crossingsPassed,1);assert.equal(car.lastCrossingGroup,0);
});

test('traffic joins only explicit crossing links and follows grey curves in reverse', () => {
  const network = junction(), turns = trafficConnections(network).get(2)!;
  assert.deepEqual(turns.map(turn => turn.outgoing), [3, 4]); // road 5 overlaps, but is not linked
  const car = new RoadTrafficCar(network, new Vector3(-10, 0, 0), () => 0);
  assert.deepEqual(car.position.toArray(), [-10, 0, 0]); assert.ok(car.direction.x > .999);
  let sawCrossing = false; const previous = car.position.clone();
  for (let i = 0; i < 50; i++) {
    car.advance(.1); sawCrossing ||= car.phase.startsWith('crossing');
    assert.ok(previous.distanceTo(car.position) <= 15 / 3.6 * .1 + 1e-8); previous.copy(car.position);
  }
  assert.equal(sawCrossing, true); assert.equal(car.crossingsPassed, 1); assert.equal(car.roadId, 3);
  assert.ok(Math.abs(car.position.z - 2) < 1e-8); assert.ok(car.direction.x > .999);
  assert.ok(Math.abs(car.travelled - 15 / 3.6 * 5) < 1e-8);
});

test('random exit is selected once on approach, with different branches available', () => {
  let calls = 0;
  const car = new RoadTrafficCar(junction(), new Vector3(-10, 0, 0), () => { calls++; return .999; });
  car.advance(.1); assert.equal(car.nextRoad, 4); const selectedCalls = calls;
  for (let i = 0; i < 10; i++) car.advance(.1);
  assert.equal(calls, selectedCalls);
  for (let i = 0; i < 40; i++) car.advance(.1);
  assert.equal(car.roadId, 4); assert.equal(car.crossingsPassed, 1);
});

test('missing connected exit stops rather than jumping to another street; long frames stay bounded', () => {
  const network = junction(); network.others[1] = road(3, [3, 0, 2], [2, 0, 2]);
  const car = new RoadTrafficCar(network, new Vector3(-10, 0, 0), () => 0);
  car.advance(100); assert.ok(car.travelled <= car.speed * .25 + 1e-8);
  for (let i = 0; i < 200; i++) car.advance(.1);
  assert.equal(car.stopped, true); assert.deepEqual(car.position.toArray(), [3, 0, 2]);
  const at = car.position.clone(); car.advance(.1); assert.ok(car.position.equals(at));
  const disconnected = junction(); disconnected.nodes = [];
  assert.throws(() => new RoadTrafficCar(disconnected), /No connected/);
});

test('inline traffic wheel render keeps its resource and local orientation', () => {
  const config = parsePartConfig('render 0x1\ntype 10 sphere 0.36\nwheel 1 -0.7 2 0 0 0 1 0 1 0\nrender 0xa 0 0 0 3.142 0 0\nlod 1 2\ntype 10 sphere 0.36\nwheel -1 -0.7 2 0 0 0 1 0 1 0\nrender 0xb 0 0 0 0 0 0');
  assert.equal(config.wheels[0].render?.resource, 10); assert.equal(config.wheels[0].render?.pose?.rotation[0], 3.142);
  assert.equal(config.wheels[1].render?.resource, 11); assert.equal(config.render, 1);
});

test('following spawn walks upstream through explicit crossing links and keeps independent exit choices',()=>{
  const network=junction();network.others[0]=road(2,[0,0,0],[-100,0,0]);
  const lead=new RoadTrafficCar(network,new Vector3(-1,0,0),()=>0);
  for(let i=0;i<60;i++)lead.advance(.1);
  const rear=lead.spawnBehind(25,()=>.999);
  assert.ok(rear.position.x<lead.position.x-15);assert.equal(rear.roadId,2);
  const independent=new RoadTrafficCar(network,new Vector3(-10,0,0),()=>0).spawnBehind(0,()=>.999);
  const original=new RoadTrafficCar(network,new Vector3(-10,0,0),()=>0);
  independent.advance(.1);original.advance(.1);
  assert.equal(original.nextRoad,3);assert.equal(independent.nextRoad,4);
});
