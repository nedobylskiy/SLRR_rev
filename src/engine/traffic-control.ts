import { Vector3 } from 'three';
import type { RoadNetwork, RoadNode, RoadOther } from '../formats/trc';
import type { CfgPose } from '../formats/cfg';

export type SignalState='red'|'yellow'|'green';
export interface TrafficFixture { kind:'signal'|'stop'|'yield'; position:Vector3;pose?:CfgPose }
export interface TrafficRule { kind:TrafficFixture['kind']; crossing:number; branch:number }
interface CrossingCycle { branches:number[]; first:number }
export interface SignalBinding { fixture:TrafficFixture; crossing:number; branch:number }

/** One shared intersection state, consumed by lamps and all drivers. Timings follow gameplay observation. */
export class TrafficControl {
  time=0;
  readonly rules=new Map<number,TrafficRule>();
  readonly signals:SignalBinding[]=[];
  private cycles=new Map<number,CrossingCycle>();
  constructor(readonly network:RoadNetwork,fixtures:readonly TrafficFixture[],random=Math.random){
    const roads=new Map(network.others.map(road=>[road.id,road]));
    const incoming=(node:RoadNode)=>node.links.filter(link=>link.flag!==0).map(link=>roads.get(link.target)).filter((road):road is RoadOther=>!!road);
    for(const fixture of fixtures){
      const node=network.nodes.reduce<RoadNode|undefined>((best,node)=>!best||fixture.position.distanceToSquared(new Vector3(...node.position))<fixture.position.distanceToSquared(new Vector3(...best.position))?node:best,undefined);
      // Both pools contain visible signal heads in the installed City (e.g. A #24).
      // Keep nearest-node binding, but do not turn a real fixture off based on pool membership.
      if(!node)continue;
      const candidates=incoming(node);let selected:RoadOther|undefined,distance=Infinity;
      for(const road of candidates){const d=fixture.position.distanceToSquared(new Vector3(...road.segments[0].start));if(d<distance){selected=road;distance=d;}}
      if(!selected)continue;
      const branch=selected.refs[0]||selected.id;
      for(const road of candidates)if((road.refs[0]||road.id)===branch){
        const previous=this.rules.get(road.id);
        if(!previous||fixture.kind==='signal')this.rules.set(road.id,{kind:fixture.kind,crossing:node.id,branch});
      }
      if(fixture.kind==='signal')this.signals.push({fixture,crossing:node.id,branch});
    }
    for(const node of network.nodes){
      const controlled=this.signals.filter(signal=>signal.crossing===node.id);if(!controlled.length)continue;
      const branches=[...new Set(incoming(node).map(road=>road.refs[0]||road.id))];
      const signaled=new Set(controlled.map(signal=>signal.branch));
      const active=branches.filter(branch=>signaled.has(branch));
      this.cycles.set(node.id,{branches:active,first:Math.min(active.length-1,Math.max(0,Math.floor(random()*active.length)))});
      // A missing lamp on an otherwise regulated junction uses the requested five-second stop fallback.
      for(const road of incoming(node))if(!this.rules.has(road.id))this.rules.set(road.id,{kind:'stop',crossing:node.id,branch:road.refs[0]||road.id});
    }
  }
  advance(dt:number){if(Number.isFinite(dt)&&dt>0)this.time+=dt;}
  get phaseRevision(){const slot=Math.floor((this.time+1e-9)/25);return slot*2+(this.time-slot*25>=20-1e-9?1:0);}
  state(crossing:number,branch:number):SignalState {
    const cycle=this.cycles.get(crossing);if(!cycle||!cycle.branches.length)return 'red';
    const slot=Math.floor((this.time+1e-9)/25),active=cycle.branches[(cycle.first+slot)%cycle.branches.length];
    return active!==branch?'red':this.time-slot*25<20-1e-9?'green':'yellow';
  }
  rule(road:number){return this.rules.get(road);}
}

/** Resource names are evidence only for explicitly named signs; numbered decorative tabla resources are not guessed. */
export function trafficFixtureKind(alias:string,nativeClass?:string):TrafficFixture['kind']|undefined {
  if(nativeClass==='trlight')return 'signal';
  if(/(?:^|[ _\\/.-])(?:stop)(?:$|[ _\\/.-]|sign|\d)/i.test(alias))return 'stop';
  if(/(?:^|[ _\\/.-])(?:yield|give[_ -]?way)(?:$|[ _\\/.-]|sign|\d)/i.test(alias))return 'yield';
}
