import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {TrafficSpawnIndex,type TrafficOccupant} from '../src/engine/traffic-stream';
import {trafficResidentActive,worldTrafficSpawn} from '../src/engine/traffic-residency';
import type {RoadNetwork,RoadPoint,RoadSegment} from '../src/formats/trc';

const segment=(start:RoadPoint,end:RoadPoint):RoadSegment=>{const tangent=end.map((n,i)=>n-start[i]) as RoadPoint;return{start,end,startTangent:tangent,endTangent:tangent,length:Math.hypot(...tangent),flag:0,raw:new Uint32Array(14)};};
function network():RoadNetwork{return{version:1,bytes:0,paths:[],others:[
  {id:1,refs:[101,0],flag:0,raw:new Uint32Array(12),tail:new Uint32Array(3),extraRefs:[],segments:[segment([1000,0,0],[0,0,0])]},
  {id:2,refs:[102,0],flag:0,raw:new Uint32Array(12),tail:new Uint32Array(3),extraRefs:[],segments:[segment([2000,0,0],[1002,0,0])]}
],nodes:[{id:3,group:1,position:[1000,0,0],raw:new Uint32Array(4),links:[{target:1,flag:1},{target:2,flag:0}],lanes:[{header:new Uint8Array(12),segment:segment([1002,0,0],[1000,0,0])}]}]};}

test('initial traffic is scattered over connected world lanes rather than around the player',()=>{
  let seed=73;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const index=new TrafficSpawnIndex(network()),player=new Vector3(10,0,0),occupied:TrafficOccupant[]=[];
  for(let i=0;i<25;i++){
    const spawn=worldTrafficSpawn(index,occupied,3,player,random);assert.ok(spawn);
    assert.equal(spawn.road,1);assert.equal(spawn.position.z,0);assert.ok(spawn.position.distanceTo(player)>40);
    assert.ok(occupied.every(other=>other.distanceTo(spawn.position)>17));
    occupied.push(Object.assign(spawn.position.clone(),{trafficRadius:3}));
  }
  assert.ok(Math.max(...occupied.map(p=>p.x))-Math.min(...occupied.map(p=>p.x))>700);
  assert.ok(occupied.some(p=>p.distanceTo(player)>500),'population exists before the player reaches distant roads');
});

test('residency wakes by player proximity, sleeps with hysteresis and preserves the same world position',()=>{
  const position=new Vector3(600,4,0),original=position.clone();let active=false;
  active=trafficResidentActive(position,new Vector3(),100,active);assert.equal(active,false);
  active=trafficResidentActive(position,new Vector3(510,0,0),100,active);assert.equal(active,true);
  for(let i=0;i<20;i++)assert.equal(trafficResidentActive(position,new Vector3(510,0,0),100,active),true,'camera-independent residency does not resample placement');
  active=trafficResidentActive(position,new Vector3(465,0,0),100,active);assert.equal(active,true);
  active=trafficResidentActive(position,new Vector3(440,0,0),100,active);assert.equal(active,false);
  active=trafficResidentActive(position,new Vector3(490,0,0),100,active);assert.equal(active,false);
  active=trafficResidentActive(position,new Vector3(510,0,0),100,active);assert.equal(active,true);
  assert.ok(position.equals(original),'sleep and wake never relocate the car');
});

test('an occupied graph leaves an empty population slot instead of overlapping an existing car',()=>{
  const index=new TrafficSpawnIndex(network());
  assert.equal(worldTrafficSpawn(index,[Object.assign(new Vector3(500,0,0),{trafficRadius:1000})],3,new Vector3()),undefined);
});
