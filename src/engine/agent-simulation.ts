import {Box3,Vector3} from 'three';
import {RigidBody3D} from './rigid-body-3d';
import {RoadTrafficCar} from './road-traffic';
import {TrafficControl} from './traffic-control';
import {Bot,type BotVehicle} from './bot';
import {PedestrianSpawnIndex,type CrowdWalker} from './pedestrian-stream';
import {AreaWalker} from './pedestrian-areas';
import type {AgentRequest,AgentResult,BodyState} from './agent-worker-protocol';

function setBody(body:RigidBody3D,state:BodyState){body.position.fromArray(state.position);body.orientation.fromArray(state.orientation);body.velocity.fromArray(state.velocity);body.setAngularVelocity(new Vector3().fromArray(state.omega));}
function body(state:BodyState){const b=new RigidBody3D(state.mass,new Box3(new Vector3().fromArray(state.min),new Vector3().fromArray(state.max)),new Vector3().fromArray(state.center));setBody(b,state);return b;}
/** Worker-owned navigation state. Immutable graphs are sent once; ticks contain only nearby actor snapshots. */
export class AgentSimulation {
  constructor(private random=Math.random){}
  private control?:TrafficControl;
  private drivers=new Map<number,{revision:number;bot:Bot;proxy:BotVehicle&{collisionVersion:number;physicalSteering:boolean}}>();
  private index?:PedestrianSpawnIndex;
  private walkers=new Map<number,{revision:number;walker:CrowdWalker}>();
  update(request:AgentRequest):AgentResult|undefined {
    if(request.kind==='traffic-init'){this.control=new TrafficControl(request.network,[]);this.control.restore(request.control);this.drivers.clear();return;}
    if(request.kind==='pedestrian-init'){this.index=new PedestrianSpawnIndex(request.rows);this.walkers.clear();return;}
    if(request.kind==='traffic'){
      const control=this.control;if(!control)throw Error('Traffic worker not initialized');control.time=request.time;
      if(request.halts)control.setHalts(request.halts);
      const ids=new Set(request.agents.map(a=>a.id));for(const id of this.drivers.keys())if(!ids.has(id))this.drivers.delete(id);
      for(const state of request.agents){
        let entry=this.drivers.get(state.id);
        if(!entry||entry.revision!==state.revision){
          const route=new RoadTrafficCar(control.network,new Vector3().fromArray(state.body.position),this.random,state.cursor.road);route.restore(state.cursor);
          const proxy={body:body(state.body),collisionVersion:state.collision,physicalSteering:state.physical,wheelbase:state.wheelbase,maxSteerAngle:state.maxSteer,step(){},impact(){}};
          const bot=new Bot(route,proxy,this.random,state.speed,control);bot.mode=state.mode;
          entry={revision:state.revision,bot,proxy};this.drivers.set(state.id,entry);
        }
        setBody(entry.proxy.body,state.body);entry.proxy.collisionVersion=state.collision;entry.proxy.physicalSteering=state.physical;
      }
      const peers=[...this.drivers.values()].map(e=>e.proxy.body);if(request.peer)peers.push(body(request.peer));
      const agents=request.agents.map(state=>{const {bot}=this.drivers.get(state.id)!;bot.plan(Math.min(.1,request.dt),peers);
        return {id:state.id,revision:state.revision,collision:state.collision,haltsRevision:control.halts.revision,cursor:bot.route.snapshot(),input:bot.input,mode:bot.mode,rpm:bot.rpm,speed:bot.cruiseSpeed,desired:bot.desiredSpeed,status:bot.trafficStatus};});
      return {kind:'traffic',agents};
    }
    const index=this.index;if(!index)throw Error('Pedestrian worker not initialized');
    const ids=new Set(request.agents.map(a=>a.id));for(const id of this.walkers.keys())if(!ids.has(id))this.walkers.delete(id);
    for(const state of request.agents){let entry=this.walkers.get(state.id);if(!entry||entry.revision!==state.revision){
      const zone=index.zones.find(z=>z.id===state.zone);if(!zone)throw Error(`Missing pedestrian zone ${state.zone}`);
      const walker=index.walker({zone,t:state.t,lateral:state.lateral,position:new Vector3().fromArray(state.position)},this.random);
      walker.position.fromArray(state.position);walker.direction.fromArray(state.direction);
      if(walker instanceof AreaWalker){walker.zone={id:state.zone};walker.heading.fromArray(state.heading??state.direction);}
      else {walker.t=state.t;walker.sign=state.sign;}
      entry={revision:state.revision,walker};this.walkers.set(state.id,entry);
    }}
    const threats=request.threats.map(t=>({position:new Vector3().fromArray(t.position),velocity:new Vector3().fromArray(t.velocity)})),positions=threats.map(t=>t.position);
    const others=[...this.walkers.values()].map(e=>e.walker).filter((w):w is AreaWalker=>w instanceof AreaWalker);
    return {kind:'pedestrian',agents:request.agents.map(state=>{
      const walker=this.walkers.get(state.id)!.walker;
      if(walker instanceof AreaWalker)walker.step(request.dt,threats,others);else walker.step(request.dt,positions);
      return {id:state.id,revision:state.revision,zone:walker.zone.id,position:walker.position.toArray(),direction:walker.direction.toArray(),
        heading:walker instanceof AreaWalker?walker.heading.toArray():undefined,speed:walker.speed,gait:walker instanceof AreaWalker?walker.gait:walker.speed,
        ok:walker instanceof AreaWalker?walker.ok:true,t:walker instanceof AreaWalker?0:walker.t,sign:walker instanceof AreaWalker?1:walker.sign};
    })};
  }
}
