import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SlrrJvm,jv} from 'slrr-jvm';
import {nearestRoadCrossing} from '../src/engine/road-nearest';
import {GroundRoadNative} from '../src/runtime/ground-road-native';
import type {RoadNetwork,RoadPoint} from '../src/formats/trc';

const graph=(...positions:RoadPoint[]):RoadNetwork=>({version:1,bytes:0,paths:[],others:[],nodes:positions.map((position,i)=>({id:i+1,group:i%2 as 0|1,position,links:[],lanes:[],raw:new Uint32Array(4)}))});
const vector=(x=0,y=0,z=0)=>jv('Vector3',{className:'java.lang.Vector3',fields:new Map([['x',jv('float',x)],['y',jv('float',y)],['z',jv('float',z)]])});

test('nearest crossing uses both pools and full 3D distance without a height filter',()=>{
 const network=graph([0,20,0],[4,0,0],[0,6,0]);
 assert.equal(nearestRoadCrossing(network,[0,0,0])?.id,2);
 assert.equal(nearestRoadCrossing(network,[0,14,0])?.id,1,'crossing six metres higher is not filtered out');
});

test('requested distance matches a radius, not a cutoff; stable ties keep earlier file order',()=>{
 const network=graph([4,0,0],[12,0,0]);
 assert.equal(nearestRoadCrossing(network,[0,0,0],10)?.id,2,'a crossing beyond the radius can win');
 assert.equal(nearestRoadCrossing(graph([8,0,0],[12,0,0]),[0,0,0],10)?.id,1);
 assert.equal(nearestRoadCrossing(graph([3,4,0],[-5,0,0]),[0,0,0])?.id,1);
 assert.equal(nearestRoadCrossing(network,[0,0,0],-10)?.id,1);
 assert.equal(nearestRoadCrossing(graph(),[0,0,0]),undefined);
 assert.equal(nearestRoadCrossing(network,[NaN,0,0]),undefined);
 assert.equal(nearestRoadCrossing(network,[0,0,0],Infinity),undefined);
});

test('native overloads use the receiver map and return independent Java vectors; unavailable graphs return null',async()=>{
 const jvm=new SlrrJvm({resolveImport:()=>null}),a=vector(),b=vector(),missing=vector();
 const maps=new Map([[a.value,graph([1,2,3])],[b.value,graph([90,80,70])]]);
 new GroundRoadNative(jvm,async receiver=>maps.get(receiver.value));
 const query=vector(),call=(receiver:typeof a,type:string)=>jvm.natives.invokeAsync('java.util.resource.GroundRef','getNearestCross',receiver,[query,jv(type,0)]);
 for(const type of ['int','float']){
  const first=(await call(a,type))!,second=(await call(b,type))!;
  assert.deepEqual(['x','y','z'].map(axis=>jvm.get(first,axis).value),[1,2,3]);
  assert.deepEqual(['x','y','z'].map(axis=>jvm.get(second,axis).value),[90,80,70]);
  jvm.set(first,'x',jv('float',999));assert.equal(jvm.get((await call(a,type))!,'x').value,1);
  assert.equal(jvm.get(query,'x').value,0);assert.equal((await call(missing,type))?.value,null);
 }
});
