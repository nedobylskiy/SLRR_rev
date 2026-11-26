import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SlrrJvm,jv} from 'slrr-jvm';
import {GameTypeNative} from '../src/runtime/game-type-native';
import {VehicleCrimeNative} from '../src/runtime/vehicle-crime-native';
import {roadSpeedZones} from '../src/engine/road-speed-zones';
import type {RoadNetwork,RoadPoint,RoadSegment} from '../src/formats/trc';

function graph():RoadNetwork {
  const segment=(a:RoadPoint,b:RoadPoint):RoadSegment=>({start:a,end:b,startTangent:[100,0,0],endTangent:[100,0,0],length:100,flag:0,raw:new Uint32Array(14)});
  return {version:1,bytes:0,paths:[],others:[0,1].map(i=>({id:i+1,refs:[],extraRefs:[],flag:0,raw:new Uint32Array(),tail:new Uint32Array(),segments:[segment([0,i*12,0],[100,i*12,0])]})),nodes:[0,1].map(i=>({id:i+3,group:(1-i) as 0|1,position:[0,i*12,0],links:[{target:i+1,flag:0}],lanes:[],raw:new Uint32Array()}))};
}
test('road zones use existing maxima, full height, off-road sentinel and cached index',()=>{
  const network=graph(),zones=roadSpeedZones(network);assert.equal(roadSpeedZones(network),zones);
  assert.equal(zones.limit({x:35,y:1,z:2}),35/3.6);
  assert.equal(zones.limit({x:35,y:13,z:2}),100/3.6);
  assert.equal(zones.limit({x:35,y:0,z:100}),-1);
  assert.equal(zones.limit({x:NaN,y:0,z:0}),-1);
  network.nodes.push({...network.nodes[0],id:5,group:0});
  // A fresh network uses the rural maximum if either road endpoint is rural.
  assert.equal(roadSpeedZones({...network}).limit({x:35,y:0,z:0}),100/3.6);
});
test('hasCrime resolves live car aliases and its own map, updating the zone after movement',async()=>{
  const jvm=new SlrrJvm({resolveImport:()=>null}),types=new GameTypeNative(jvm,()=>{});
  const create=()=>{const ref=jv('GameRef',{className:'java.util.resource.GameRef',fields:new Map()});jvm.natives.invoke('java.lang.GameType','createNativeInstance',ref,[]);return ref;};
  const map=create(),car=create(),other=create(),alias=create(),node=types.get(car)!;
  types.get(map)!.worldTreeRoot=true;node.setParent(types.get(map)!);node.position={x:40,y:0,z:0};
  jvm.natives.invoke('java.util.resource.ResourceRef','set',alias,[jv('ResourceRef',car.value)]);
  let requests=0;const network=graph();new VehicleCrimeNative(jvm,types,async ref=>{requests++;assert.equal(types.get(ref),types.get(map));return network;});
  const call=(ref=car)=>jvm.natives.invokeAsync('java.game.Vehicle','hasCrime',ref,[]);
  assert.equal((await call())?.value,35/3.6);assert.equal((await call(alias))?.value,35/3.6);
  node.position.y=12;assert.equal((await call())?.value,100/3.6,'no additional police tolerance in the native');
  assert.equal((await call(other))?.value,-1);assert.equal(requests,3);
  node.destroyed=true;assert.equal((await call())?.value,-1);
});
