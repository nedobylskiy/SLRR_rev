/** Run the production Web Worker bundle in a separate thread against installed City graphs. Run npm run build first. */
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Worker} from 'node:worker_threads';
import {Box3,Matrix4,Vector3} from 'three';
import {Assets} from '../src/assets';
import {gameRoot,walk,relativeGamePath,safeGamePath} from './game-files';
import {loadMapRoads} from '../src/engine/map-roads';
import {loadMapPedestrians} from '../src/engine/map-pedestrians';
import {TrafficSpawnIndex} from '../src/engine/traffic-stream';
import {RoadTrafficCar} from '../src/engine/road-traffic';
import {TrafficControl} from '../src/engine/traffic-control';
import {RigidBody3D} from '../src/engine/rigid-body-3d';
import {agentBody} from '../src/engine/agent-worker-client';
import {PedestrianSpawnIndex} from '../src/engine/pedestrian-stream';
import {zonePoint} from '../src/engine/pedestrian-walking';
import type {AgentRequest,AgentResult,TrafficAgentState,WalkerState} from '../src/engine/agent-worker-protocol';

const file=(await readdir('dist/assets')).find(p=>/^agent-worker-.*\.js$/.test(p));assert.ok(file,'Build the project first');
const url=pathToFileURL(resolve('dist/assets',file)).href;
const assets=new Assets((await walk(gameRoot)).map(p=>({path:relativeGamePath(p),size:0})),async p=>new Uint8Array(await readFile(await safeGamePath(p))));
const roads=await loadMapRoads(assets,'maps/city.rpk'),pedestrians=await loadMapPedestrians(assets,'maps/city.rpk');assert.ok(roads&&pedestrians);
const worker=new Worker(`const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;self.postMessage=m=>parentPort.postMessage(m);import(${JSON.stringify(url)}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`,{eval:true});
let sequence=0;
const send=(request:AgentRequest)=>worker.postMessage({id:++sequence,request});
const tick=(request:AgentRequest)=>new Promise<{result:AgentResult;workMs:number}>((resolve,reject)=>{
  const id=++sequence,timer=setTimeout(()=>{cleanup();reject(Error('Worker timed out'));},10000);
  const cleanup=()=>{clearTimeout(timer);worker.off('message',receive);worker.off('error',failed);};
  const failed=(error:Error)=>{cleanup();reject(error);};
  const receive=(reply:any)=>{if(reply.id!==id)return;cleanup();if(reply.error)reject(Error(reply.error));else resolve(reply);};
  worker.on('message',receive);worker.on('error',failed);worker.postMessage({id,request});
});
try{
  const control=new TrafficControl(roads.network,[]),spawns=new TrafficSpawnIndex(roads.network);
  send({kind:'traffic-init',network:roads.network,control:control.snapshot()});
  const agents:TrafficAgentState[]=Array.from({length:25},(_,id)=>{
    const spawn=spawns.any(()=>true)!;const route=new RoadTrafficCar(roads.network,spawn.position,Math.random,spawn.road);
    const body=new RigidBody3D(1400,new Box3(new Vector3(-1,-.5,-2),new Vector3(1,1,2)));
    body.setFrame(new Matrix4().makeRotationY(Math.atan2(-spawn.direction.x,-spawn.direction.z)).setPosition(spawn.position));body.velocity.copy(spawn.direction).multiplyScalar(7);
    return {id,revision:0,body:agentBody(body),cursor:route.snapshot(),collision:0,physical:true,wheelbase:3,maxSteer:.6,speed:7,mode:'cruise'};
  });
  let trafficMax=0;for(let i=0;i<30;i++){
    const reply=await tick({kind:'traffic',dt:1/30,time:i/30,agents});assert.equal(reply.result.kind,'traffic');trafficMax=Math.max(trafficMax,reply.workMs);
    if(reply.result.kind==='traffic'){assert.equal(reply.result.agents.length,25);for(const a of reply.result.agents)assert.ok(Number.isFinite(a.input.steer)&&Number.isFinite(a.input.throttle));}
  }
  send({kind:'pedestrian-init',rows:pedestrians.walk});
  const index=new PedestrianSpawnIndex(pedestrians.walk);assert.ok(index.zones.length>=25);
  const walkers:WalkerState[]=index.zones.slice(0,25).map((zone,id)=>({id,revision:0,zone:zone.id,position:zonePoint(zone,.5).toArray(),direction:zonePoint(zone,.51).sub(zonePoint(zone,.5)).normalize().toArray(),t:.5,sign:1,lateral:.5}));
  let pedestrianMax=0;for(let i=0;i<30;i++){
    const reply=await tick({kind:'pedestrian',dt:1/30,agents:walkers,threats:[]});assert.equal(reply.result.kind,'pedestrian');pedestrianMax=Math.max(pedestrianMax,reply.workMs);
    if(reply.result.kind==='pedestrian'){assert.equal(reply.result.agents.length,25);for(const a of reply.result.agents)assert.ok(a.position.every(Number.isFinite));}
  }
  console.log(JSON.stringify({gameRoot,roads:roads.network.others.length,zones:index.zones.length,traffic:25,pedestrians:25,ticksEach:30,trafficMaxWorkerMs:trafficMax,pedestrianMaxWorkerMs:pedestrianMax}));
}finally{await worker.terminate();}
