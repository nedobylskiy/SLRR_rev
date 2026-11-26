import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {parseTrc,type RoadPoint} from '../src/formats/trc';
import {roadRoutes} from '../src/engine/road-route';
import {GroundRoadNative} from '../src/runtime/ground-road-native';
import {SlrrJvm,jv} from 'slrr-jvm';
import {safeGamePath} from './game-files';

const network=parseTrc(new Uint8Array(await readFile(await safeGamePath('maps/city/ai/city.trc'))));
const graph=roadRoutes(network),nodes=new Map(network.nodes.map(n=>[n.id,n]));
let checked=0,twoWay=0;
for(const path of network.paths){
  const a=nodes.get(path.refs[1]),b=nodes.get(path.refs[2]);if(!a||!b||a.id===b.id)continue;
  let directions=0;
  for(const [from,to]of [[a,b],[b,a]]){
  const lanes=network.others.filter(r=>r.refs[0]===path.id&&from.links.some(l=>l.target===r.id&&l.flag===0)&&to.links.some(l=>l.target===r.id&&l.flag!==0));
  if(!lanes.length)continue;directions++;
  const route=graph.query(from.position,to.position);assert.ok(route,`Path #${path.id} must support lane travel ${from.id} → ${to.id}`);
  assert.ok(route.length>0&&Number.isFinite(route.length));assert.ok(Math.abs(Math.hypot(...route.direction)-1)<1e-6);
  const direct=Math.hypot(...a.position.map((v,i)=>v-b.position[i]));assert.ok(route.length>=direct-1e-6);
  assert.ok(route.roads.length);checked++;
  }
  if(directions===2)twoWay++;
}
assert.ok(checked>100);
const jvm=new SlrrJvm({resolveImport:()=>null}),ground=jv('GroundRef',{className:'java.util.resource.GroundRef',fields:new Map()});
const native=new GroundRoadNative(jvm,async()=>network);
const vector=(p:RoadPoint)=>jv('Vector3',{className:'java.lang.Vector3',fields:new Map(['x','y','z'].map((axis,i)=>[axis,jv('float',p[i])]))});
const start:RoadPoint=[-359.9,10.4,-475.2],finish=network.nodes.reduce((best,n)=>Math.abs(Math.hypot(...n.position.map((v,i)=>v-start[i]))-600)<Math.abs(Math.hypot(...best.position.map((v,i)=>v-start[i]))-600)?n:best).position;
const args=[vector(start),vector(finish)],length=await jvm.natives.invokeAsync('java.util.resource.GroundRef','getRouteLength',ground,args),direction=await jvm.natives.invokeAsync('java.util.resource.GroundRef','getStartDirection',ground,args);
assert.ok(Number(length?.value)>0);assert.ok(direction?.value);
await jvm.natives.invokeAsync('java.util.resource.GroundRef','haltTrafficPath',ground,args);assert.ok(native.trafficHalts(ground).roads.length);
console.log(`PASS City: ${checked} directed road queries, ${twoWay} shared two-way street paths; career native route ${Number(length!.value).toFixed(1)} m; ${native.trafficHalts(ground).roads.length} race-excluded lanes.`);
