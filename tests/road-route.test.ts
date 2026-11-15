import test from 'node:test';import assert from 'node:assert/strict';
import {SlrrJvm,jv} from 'slrr-jvm';import {Vector3} from 'three';
import {roadRoutes} from '../src/engine/road-route';import {GroundRoadNative} from '../src/runtime/ground-road-native';
import {TrafficControl} from '../src/engine/traffic-control';import {RoadTrafficCar} from '../src/engine/road-traffic';import {Bot} from '../src/engine/bot';import {RigidBody3D} from '../src/engine/rigid-body-3d';import {Box3,Matrix4} from 'three';
import type {RoadNetwork,RoadPoint,RoadSegment} from '../src/formats/trc';
function segment(a:RoadPoint,b:RoadPoint):RoadSegment{const tangent=b.map((v,i)=>v-a[i]) as RoadPoint;return {start:a,end:b,startTangent:tangent,endTangent:tangent,length:Math.hypot(...tangent),raw:new Uint32Array(14),flag:0};}
function graph():RoadNetwork {
 const positions:RoadPoint[]=[[0,0,0],[100,0,0],[100,0,100],[0,0,200],[800,0,800]];
 const nodes=positions.map((position,i)=>({id:i+1,group:1 as const,position,raw:new Uint32Array(4),links:[] as {target:number;flag:number}[],lanes:[] as RoadNetwork['nodes'][0]['lanes']}));
 const paths=[[1,2],[2,3],[1,4],[4,3],[2,1],[3,2]].map(([from,to],i)=>({id:10+i,refs:[100+i,from,to],raw:new Uint32Array(7),segments:[segment(positions[to-1],positions[from-1])]}));
 const others=paths.map((p,i)=>{nodes[p.refs[1]-1].links.push({target:100+i,flag:0});nodes[p.refs[2]-1].links.push({target:100+i,flag:1});return {id:100+i,refs:[p.id,0],raw:new Uint32Array(12),extraRefs:[],tail:new Uint32Array(3),flag:0,segments:p.segments};});
 return {version:1,bytes:0,nodes,paths,others};
}
const vec=(p:RoadPoint)=>jv('Vector3',{className:'java.lang.Vector3',fields:new Map(['x','y','z'].map((axis,i)=>[axis,jv('float',p[i])]))});
test('opposing lanes share one street path without forcing a detour or arbitrary endpoint direction',()=>{
 const network=graph();
 // Move the existing return lane onto the same centreline as the outbound lane.
 network.others.find(r=>r.id===104)!.refs[0]=10;
 network.paths=network.paths.filter(p=>p.id!==14);
 const routes=roadRoutes(network);
 for(const [start,finish,direction,road]of [
  [[0,0,0],[100,0,0],[1,0,0],100],
  [[100,0,0],[0,0,0],[-1,0,0],104],
  [[20,0,0],[80,0,0],[1,0,0],100],
  [[80,0,0],[20,0,0],[-1,0,0],104],
 ] as [RoadPoint,RoadPoint,RoadPoint,number][]){
  const route=routes.query(start,finish)!;
  assert.ok(Math.abs(route.length-Math.abs(start[0]-finish[0]))<1e-6);
  assert.deepEqual(route.direction,direction);assert.deepEqual(route.roads,[road]);
 }
});
test('a street without an opposing lane remains one-way',()=>{
 const network=graph();network.paths=network.paths.slice(0,1);network.others=network.others.slice(0,1);
 const routes=roadRoutes(network);
 assert.equal(routes.query([100,0,0],[0,0,0]),undefined);
 assert.equal(routes.query([80,0,0],[20,0,0]),undefined);
 assert.equal(routes.query([20,0,0],[80,0,0])!.length,60);
});
test('route length follows shortest connected roads in metres, not Euclidean distance or record count',()=>{
 const routes=roadRoutes(graph()),route=routes.query([0,0,0],[100,0,100])!;assert.ok(Math.abs(route.length-200)<1e-6);assert.deepEqual(route.direction,[1,0,0]);assert.deepEqual(route.roads,[100,101]);
 assert.ok(Math.abs(routes.query([20,0,0],[80,0,0])!.length-60)<1e-6);
 assert.deepEqual(routes.query([100,0,100],[0,0,0])!.direction,[0,0,-1]);
 assert.equal(routes.query([0,0,0],[800,0,800]),undefined);assert.equal(routes.query([NaN,0,0],[100,0,0]),undefined);
 assert.equal(routes.query([20,0,0],[20,0,0])!.length,0);assert.equal(roadRoutes(routes.network),routes);
 assert.deepEqual(new Set(routes.haltRoads(route)),new Set([100,101,104,105]),'night race clears both directions of the selected streets');
});
test('start direction remains along the road when the query point is beside the lane',()=>{
 const route=roadRoutes(graph()).query([20,0,3],[80,0,3])!;assert.deepEqual(route.direction,[1,0,0]);assert.ok(route.length>=60&&route.length<67);
});
test('ground natives return independent vectors, report absent routes and keep halts scoped to the receiver',async context=>{
 let now=0;context.mock.method(performance,'now',()=>now);
 const jvm=new SlrrJvm({resolveImport:()=>null}),a=vec([0,0,0]),b=vec([0,0,0]),missing=vec([0,0,0]),network=graph();
 const maps=new Map([[a.value,network],[b.value,network]]),native=new GroundRoadNative(jvm,async ref=>maps.get(ref.value));
 const start=vec([0,0,0]),finish=vec([100,0,100]);
 const call=(map:typeof a,name:string,args=[start,finish])=>jvm.natives.invokeAsync('java.util.resource.GroundRef',name,map,args);
 assert.equal((await call(a,'getRouteLength'))?.value,200);
 const plot=native.routeForPlot()!;assert.ok(plot.length>2);plot[0][0]=999;assert.equal(native.routeForPlot()![0][0],0);
 const first=(await call(a,'getStartDirection'))!,second=(await call(a,'getStartDirection'))!;assert.deepEqual(['x','y','z'].map(axis=>jvm.get(first,axis).value),[1,0,0]);jvm.set(first,'x',jv('float',-10));assert.equal(jvm.get(second,'x').value,1);
 assert.equal((await call(missing,'getRouteLength'))?.value,-1);assert.equal((await call(missing,'getStartDirection'))?.value,null);assert.equal((await call(a,'getStartDirection',[start,start]))?.value,null);
 await call(a,'haltTrafficPath');assert.deepEqual(new Set(native.trafficHalts(a).roads),new Set([100,101,104,105]));assert.deepEqual(native.trafficHalts(b).roads,[]);
 assert.equal(native.trafficHalts(a),native.trafficHalts(a),'unchanged masks are cached between frames');
 await call(a,'haltTrafficCross',[start,jv('float',15)]);assert.deepEqual(native.trafficHalts(a).crossings,[1]);
 now=15001;assert.deepEqual(native.trafficHalts(a).crossings,[]);assert.ok(native.trafficHalts(a).roads.length,'timed crossing expiry preserves path exclusions');
 const revision=native.trafficHalts(a).revision;await call(a,'clearHalts',[]);assert.ok(native.trafficHalts(a).revision>revision);assert.deepEqual(native.trafficHalts(a).roads,[]);assert.deepEqual(native.trafficHalts(a).crossings,[]);
 assert.equal(jvm.get(start,'x').value,0);
});
test('temporary race halt blocks a green crossing, does not expire as a five-second stop and does not trigger ramming',()=>{
 const network:RoadNetwork={version:1,bytes:0,paths:[],others:[
  {id:100,refs:[10,0],extraRefs:[],flag:0,raw:new Uint32Array(12),tail:new Uint32Array(3),segments:[segment([100,0,0],[0,0,0])]},
  {id:101,refs:[11,0],extraRefs:[],flag:0,raw:new Uint32Array(12),tail:new Uint32Array(3),segments:[segment([200,0,0],[102,0,0])]}
 ],nodes:[{id:2,group:1,position:[100,0,0],raw:new Uint32Array(4),links:[{target:100,flag:1},{target:101,flag:0}],lanes:[{header:new Uint8Array(12),segment:segment([102,0,0],[100,0,0])}]}]};
 const control=new TrafficControl(network,[{kind:'signal',position:new Vector3(100,0,0)}],()=>0);
 const route=new RoadTrafficCar(network,new Vector3(98,0,0),()=>0,100),body=new RigidBody3D(1400,new Box3(new Vector3(-1,-.5,-2),new Vector3(1,1,2)));
 body.setFrame(new Matrix4().makeRotationY(-Math.PI/2).setPosition(98,0,0));
 const vehicle={body,collisionVersion:0,step(){},impact(){}};const bot=new Bot(route,vehicle,()=>0,5,control);
 control.setHalts({revision:1,roads:[],crossings:[2]});for(let i=0;i<4000;i++)bot.command(1/60);
 assert.equal(bot.mode,'cruise');assert.equal(bot.desiredSpeed,0);assert.ok(bot.input.brake);assert.match(bot.trafficStatus,/race traffic halt/);assert.equal(route.insideCrossing,false);
 control.setHalts({revision:2,roads:[],crossings:[]});let released=false;for(let i=0;i<120;i++){bot.command(1/60);if(bot.input.throttle>0)released=true;}assert.ok(released);
 assert.equal(route.nextRoad,101);control.setHalts({revision:3,roads:[101],crossings:[]});bot.command(1/60);assert.equal(bot.desiredSpeed,0,'do not turn onto a race-excluded road from an open approach');
});
