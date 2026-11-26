import test from 'node:test';
import assert from 'node:assert/strict';
import {Box3,Matrix4,Vector3} from 'three';
import {AgentSimulation} from '../src/engine/agent-simulation';
import {AgentWorkerClient,agentBody} from '../src/engine/agent-worker-client';
import type {AgentRequest,TrafficAgentState,WalkerState} from '../src/engine/agent-worker-protocol';
import {RoadTrafficCar} from '../src/engine/road-traffic';
import {TrafficControl} from '../src/engine/traffic-control';
import {RigidBody3D} from '../src/engine/rigid-body-3d';
import {TrafficVehicle} from '../src/engine/traffic-vehicle';
import {TrafficVehicleLod} from '../src/engine/traffic-stream';
import type {RoadNetwork,RoadPoint,RoadSegment} from '../src/formats/trc';
import type {PedestrianWalk} from '../src/formats/pedestrian';

function segment(a:RoadPoint,b:RoadPoint):RoadSegment{const tangent=b.map((v,i)=>v-a[i]) as RoadPoint;return {start:a,end:b,startTangent:tangent,endTangent:tangent,length:Math.hypot(...tangent),raw:new Uint32Array(14),flag:0};}
function network():RoadNetwork{return {version:1,bytes:0,paths:[],others:[
  {id:2,refs:[102,0],extraRefs:[],flag:0,raw:new Uint32Array(12),tail:new Uint32Array(3),segments:[segment([100,0,0],[0,0,0])]},
  {id:3,refs:[103,0],extraRefs:[],flag:0,raw:new Uint32Array(12),tail:new Uint32Array(3),segments:[segment([200,0,0],[102,0,0])]}
],nodes:[{id:1,group:1,position:[100,0,0],raw:new Uint32Array(4),links:[{target:2,flag:1},{target:3,flag:0}],lanes:[{header:new Uint8Array(12),segment:segment([102,0,0],[100,0,0])}]}]};}
function traffic(graph:RoadNetwork,x=10):TrafficAgentState{
  const route=new RoadTrafficCar(graph,new Vector3(x,0,0),()=>0),b=new RigidBody3D(1400,new Box3(new Vector3(-1,-.5,-2),new Vector3(1,1,2)));
  b.setFrame(new Matrix4().makeRotationY(-Math.PI/2).setPosition(x,0,0));b.velocity.set(5,0,0);
  return {id:1,revision:0,body:agentBody(b),cursor:route.snapshot(),collision:0,physical:true,wheelbase:3,maxSteer:.6,speed:10,mode:'cruise'};
}

test('rail motion stays continuous through a crossing with delayed 10 Hz worker plans',()=>{
  const graph=network(),sim=new AgentSimulation(()=>.5),route=new RoadTrafficCar(graph,new Vector3(90,0,0),()=>.5,2);
  sim.update({kind:'traffic-init',network:graph,control:new TrafficControl(graph,[]).snapshot()});
  const vehicle=new TrafficVehicle(new Box3(new Vector3(-1,-.5,-2),new Vector3(1,1,2)),1400,[],{height:()=>0,normal:()=>new Vector3(0,1,0)});
  vehicle.place(route.position,route.direction,1);vehicle.body.velocity.set(10,0,0);
  const lod=new TrafficVehicleLod(vehicle,route,1);let input={throttle:0,steer:0,brake:false} as import('../src/engine/driving-demo').DrivingInput;
  let pending:ReturnType<AgentSimulation['update']>,previous=vehicle.body.position.clone();
  for(let frame=0;frame<300;frame++){
    if(frame%6===0)pending=sim.update({kind:'traffic',dt:.1,time:frame/60,agents:[{id:1,revision:0,body:agentBody(vehicle.body),cursor:route.snapshot(),collision:0,physical:false,wheelbase:3,maxSteer:.6,speed:10,mode:'cruise'}]});
    if(frame%6===4&&pending?.kind==='traffic'){const plan=pending.agents[0];route.applyPlan(structuredClone(plan.cursor));input=plan.input;}
    lod.step(1/60,input);
    const advance=vehicle.body.position.x-previous.x;
    assert.ok(advance>.02&&advance<.5,`continuous rail progress despite delayed plans: ${advance}`);previous.copy(vehicle.body.position);
  }
  assert.equal(route.roadId,3);assert.equal(route.crossingsPassed,1);assert.ok(vehicle.body.position.x>120);
});
test('background driver follows the live body, reacts to a lead car and never integrates physical state',()=>{
  const graph=network(),sim=new AgentSimulation(()=>0),control=new TrafficControl(graph,[]),agent=traffic(graph);
  sim.update({kind:'traffic-init',network:structuredClone(graph),control:control.snapshot()});
  const run=(peer?:typeof agent.body)=>{const reply=sim.update(structuredClone({kind:'traffic',dt:1/30,time:0,agents:[agent],peer}));assert.equal(reply?.kind,'traffic');return reply!.kind==='traffic'?reply!.agents[0]:assert.fail();};
  const before=structuredClone(agent.body),free=run();assert.ok(free.input.throttle>0);assert.deepEqual(agent.body,before);
  const peer=structuredClone(agent.body);peer.position[0]+=7;peer.velocity=[0,0,0];const blocked=run(peer);assert.ok((blocked.input.brakeAxis??0)>0);assert.ok(blocked.desired<free.desired);
  agent.collision++;const impact=run();assert.equal(impact.mode,'impact');assert.equal(impact.input.throttle,0);assert.ok(impact.input.brake);
  // Replacing a pooled actor resets its behavior, rather than inheriting impact/recovery state.
  agent.revision++;agent.collision=0;assert.equal(run().mode,'cruise');
});
test('navigation cursors round-trip through structured clone during a crossing',()=>{
  const graph=network(),route=new RoadTrafficCar(graph,new Vector3(99.5,0,0),()=>0);
  route.advance(.24);assert.ok(route.insideCrossing||route.crossingsPassed>0);
  const copy=new RoadTrafficCar(structuredClone(graph),new Vector3(),()=>0);copy.restore(structuredClone(route.snapshot()));
  const a=new Vector3(),b=new Vector3(),direction=new Vector3();route.targetAhead(6,a,direction);copy.targetAhead(6,b,direction);
  assert.ok(a.distanceTo(b)<1e-8);assert.equal(copy.phase,route.phase);assert.equal(copy.crossingsPassed,route.crossingsPassed);
});
test('worker receives the exact signal cycle selected by the main world',()=>{
  const graph=network(),control=new TrafficControl(graph,[{kind:'signal',position:new Vector3(100,0,0)}],()=>0),copy=new TrafficControl(graph,[]);
  copy.restore(structuredClone(control.snapshot()));for(const time of [0,9.9,10,12.9,13,26]){control.time=copy.time=time;assert.equal(copy.state(1,102),control.state(1,102));assert.deepEqual(copy.rule(2),control.rule(2));}
});

test('worker honors race halts on green and tags replies with the applied mask revision',()=>{
  const graph=network(),sim=new AgentSimulation(()=>0),control=new TrafficControl(graph,[{kind:'signal',position:new Vector3(100,0,0)}],()=>0),agent=traffic(graph,98);
  agent.body.velocity=[0,0,0];sim.update({kind:'traffic-init',network:graph,control:control.snapshot()});
  const run=(revision:number,crossings:number[])=>{const reply=sim.update(structuredClone({kind:'traffic',dt:1/30,time:0,halts:{revision,roads:[],crossings},agents:[agent]}));assert.equal(reply?.kind,'traffic');return reply!.kind==='traffic'?reply!.agents[0]:assert.fail();};
  const held=run(1,[1]);assert.equal(held.desired,0);assert.ok(held.input.brake);assert.equal(held.haltsRevision,1);assert.match(held.status,/race traffic halt/);
  let released=false;for(let i=0;i<90;i++){const result=run(2,[]);assert.equal(result.haltsRevision,2);released ||= result.input.throttle>0;}assert.ok(released);
});
test('30 Hz worker steering drives a 60 Hz physical car through a connected crossing without teleporting',()=>{
  const graph=network(),sim=new AgentSimulation(()=>.5),control=new TrafficControl(graph,[]),route=new RoadTrafficCar(graph,new Vector3(10,0,0),()=>.5);
  sim.update({kind:'traffic-init',network:graph,control:control.snapshot()});
  const wheels=[[-.8,-.6,-1.4],[.8,-.6,-1.4],[-.8,-.6,1.4],[.8,-.6,1.4]].map(position=>({position:position as RoadPoint,rotation:[0,0,0] as RoadPoint,radius:.36,parameters:[]}));
  const vehicle=new TrafficVehicle(new Box3(new Vector3(-1,-.5,-2),new Vector3(1,1,2)),1400,wheels,{height:()=>0,normal:()=>new Vector3(0,1,0)});
  vehicle.place(route.position,route.direction,.9);vehicle.body.velocity.copy(route.direction).multiplyScalar(5);
  let input={throttle:0,steer:0,brake:false} as import('../src/engine/driving-demo').DrivingInput,previous=vehicle.body.position.clone();
  for(let frame=0;frame<1800;frame++){
    if(frame%2===0){const reply=sim.update({kind:'traffic',dt:1/30,time:frame/60,agents:[{id:1,revision:0,body:agentBody(vehicle.body),cursor:route.snapshot(),collision:vehicle.collisionVersion,physical:true,wheelbase:vehicle.wheelbase,maxSteer:.6,speed:10,mode:'cruise'}]});
      assert.equal(reply?.kind,'traffic');if(reply?.kind==='traffic'){input=reply.agents[0].input;route.restore(structuredClone(reply.agents[0].cursor));vehicle.setMode(reply.agents[0].mode);}
    }
    vehicle.step(1/60,input);assert.ok(vehicle.body.position.distanceTo(previous)<.5);previous.copy(vehicle.body.position);
  }
  assert.ok(route.crossingsPassed>=1);assert.equal(route.roadId,3);assert.ok(Math.abs(vehicle.body.position.z)<.5);
});
test('background steering preserves recovery-free passage of a long bus through a tight turn',()=>{
  const graph=network();graph.others[0].segments=[segment([100,0,0],[90,0,0])];graph.others[1].segments=[segment([102,0,102],[102,0,2])];graph.nodes[0].lanes[0].segment=segment([102,0,2],[100,0,0]);
  const sim=new AgentSimulation(()=>.5),route=new RoadTrafficCar(graph,new Vector3(90,0,0),()=>.5);sim.update({kind:'traffic-init',network:graph,control:new TrafficControl(graph,[]).snapshot()});
  const wheels=[[-1,-.7,-4],[1,-.7,-4],[-1,-.7,4],[1,-.7,4]].map(position=>({position:position as RoadPoint,rotation:[0,0,0] as RoadPoint,radius:.4,parameters:[]}));
  const vehicle=new TrafficVehicle(new Box3(new Vector3(-1.25,-.8,-6),new Vector3(1.25,2.5,6)),10000,wheels,{height:()=>0,normal:()=>new Vector3(0,1,0)});
  vehicle.place(route.position,route.direction,1.1);vehicle.body.velocity.copy(route.direction).multiplyScalar(15/3.6);
  let input={throttle:0,steer:0,brake:false} as import('../src/engine/driving-demo').DrivingInput,mode='cruise';
  for(let frame=0;frame<1800;frame++){
    if(frame%2===0){const result=sim.update({kind:'traffic',dt:1/30,time:frame/60,agents:[{id:1,revision:0,body:agentBody(vehicle.body),cursor:route.snapshot(),collision:0,physical:true,wheelbase:vehicle.wheelbase,maxSteer:.6,speed:15/3.6,mode:'cruise'}]});
      if(result?.kind==='traffic'){const state=result.agents[0];input=state.input;mode=state.mode;route.restore(structuredClone(state.cursor));vehicle.setMode(state.mode);}
    }vehicle.step(1/60,input);
  }
  assert.equal(route.crossingsPassed,1);assert.equal(mode,'cruise');assert.ok(vehicle.body.position.z>25);assert.ok(Math.abs(vehicle.body.position.x-102)<1);
});
const row:PedestrianWalk={id:1,box:[0,0,0,200,3,4],origin:[0,0,0,0],width:0,tag:4,links:[],records:[{kind:22,id:2,quad:[0,0,0,4],child:{kind:23,points:[[0,0,0],[200,0,0]]}},{kind:22,id:3,quad:[200,0,200,4],child:{kind:23,points:[[200,0,4],[0,0,4]]}}]};
test('worker retains pedestrian progress between snapshots and resets pooled walkers by revision',()=>{
  const sim=new AgentSimulation(()=>.5);sim.update({kind:'pedestrian-init',rows:[row]});
  const actor:WalkerState={id:1,revision:0,zone:1,position:[100,0,2],direction:[1,0,0],t:.5,sign:1,lateral:.5};
  const run=()=>{const reply=sim.update(structuredClone({kind:'pedestrian',dt:.1,agents:[actor],threats:[]}));assert.equal(reply?.kind,'pedestrian');return reply!.kind==='pedestrian'?reply!.agents[0]:assert.fail();};
  let result=run();for(let i=0;i<20;i++)result=run();assert.ok(result.position[0]>100.5);assert.ok(result.position[2]>=.3&&result.position[2]<=3.7);
  actor.revision++;actor.position=[20,0,2];actor.t=.1;result=run();assert.ok(result.position[0]<21);
  sim.update({kind:'pedestrian',dt:.1,agents:[],threats:[]});actor.position=[50,0,2];actor.t=.25;assert.ok(run().position[0]<51);
});
class FakeWorker {
  onmessage?:Worker['onmessage'];onerror?:Worker['onerror'];onmessageerror?:Worker['onmessageerror'];terminated=false;
  messages:{id:number;request:AgentRequest}[]=[];postMessage(message:{id:number;request:AgentRequest}){this.messages.push(structuredClone(message));}
  terminate(){this.terminated=true;}
  reply(id:number){this.onmessage?.call(this as unknown as Worker,{data:{id,result:{kind:'traffic',agents:[]}}} as MessageEvent);}
}
test('worker bridge bounds the queue, rejects late replies, times out and releases resources',()=>{
  const worker=new FakeWorker(),graph=network(),client=new AgentWorkerClient({kind:'traffic-init',network:graph,control:new TrafficControl(graph,[]).snapshot()},()=>worker as unknown as Worker);
  const request:AgentRequest={kind:'traffic',dt:1/30,time:0,agents:[]};
  assert.ok(client.request(request,100));for(let i=0;i<100;i++)assert.equal(client.request(request,101+i),false);assert.equal(worker.messages.length,2);
  worker.reply(999);assert.equal(client.take(),undefined);worker.reply(1);assert.equal(client.take()?.kind,'traffic');
  assert.equal(client.request(request,110),false);assert.ok(client.request(request,150));worker.reply(1);assert.equal(client.take(),undefined);
  assert.equal(client.ready(2200),false);assert.equal(client.available,false);assert.ok(worker.terminated);assert.match(client.error,/timed out/);
  client.dispose();assert.equal(client.request(request,3000),false);
  worker.reply(2);assert.equal(client.take(),undefined);
});
