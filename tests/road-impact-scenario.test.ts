import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {roadImpactScenario} from '../src/engine/road-impact-scenario';
import {RaceDriver} from '../src/engine/race-driver';
import type {RoadNetwork,RoadPoint,RoadSegment} from '../src/formats/trc';

const segment=(start:RoadPoint,end:RoadPoint):RoadSegment=>({start,end,startTangent:end.map((v,i)=>v-start[i]) as RoadPoint,endTangent:end.map((v,i)=>v-start[i]) as RoadPoint,length:new Vector3(...start).distanceTo(new Vector3(...end)),raw:new Uint32Array(14),flag:0});
function network():RoadNetwork{
  const road=(id:number,start:RoadPoint,end:RoadPoint)=>({id,refs:[id+100,0],raw:new Uint32Array(12),extraRefs:[],tail:new Uint32Array(3),flag:0,segments:[segment(start,end)]});
  return {version:1,bytes:0,paths:[],others:[road(2,[150,2,0],[0,2,0]),road(3,[300,2,0],[152,2,0])],nodes:[{id:1,group:1,position:[150,2,0],raw:new Uint32Array(4),links:[{target:2,flag:1},{target:3,flag:0}],lanes:[{header:new Uint8Array(12),segment:segment([152,2,0],[150,2,0])}]}]};
}
test('city impact uses the nearest lane in the actual traffic direction and puts the target on that same lane',()=>{
  const scene=roadImpactScenario(network());
  assert.equal(scene.road,2);assert.deepEqual(scene.start.toArray(),[0,2,0]);
  assert.ok(scene.direction.x>.99);assert.ok(Math.abs(scene.target.x-60)<.01);
  assert.deepEqual(scene.target.toArray(),scene.route.points.at(-2));
  assert.deepEqual(scene.goal.toArray(),scene.route.points.at(-1));
  assert.ok(scene.goal.distanceTo(scene.target)>199,'AI finish remains beyond the collision, outside its braking zone');
  assert.ok(scene.route.points.every(p=>p[1]===2&&p[2]===0),'no centreline shortcut or junction crossing');
  assert.deepEqual(roadImpactScenario(network()).route,scene.route,'restart repeats the same approach');
});
test('an approach without enough room fails explicitly instead of spawning across a junction',()=>{
  assert.throws(()=>roadImpactScenario(network(),new Vector3(140,2,0),200),/enough room/);
});

test('the rival continues accelerating at the impact marker rather than braking for the finish',()=>{
  const scene=roadImpactScenario(network()),driver=new RaceDriver(()=>scene.route);
  const input=driver.update(`AI_race ${scene.goal.toArray().join(',')} 1`,scene.target.clone().addScaledVector(scene.direction,-5),-Math.PI/2,15,1/120);
  assert.equal(driver.status,'racing');assert.equal(input.brake,false);assert.ok(input.throttle>0);
});
