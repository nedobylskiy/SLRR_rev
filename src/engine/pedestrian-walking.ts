import {pedestrianRun} from './pedestrian-run';
import {Vector3} from 'three';
import {WALKING_CLEARANCE,insideTransition} from './pedestrian-transition';
import {forwardWalkingRoutes} from './pedestrian-route';
import type {PedestrianRecord,PedestrianWalk} from '../formats/pedestrian';

interface Boundary {points:Vector3[];lengths:number[];length:number}
export interface WalkingGate {junction:number;point:Vector3}
export interface WalkingZone {id:number;sides:[Boundary,Boundary];gates:[WalkingGate,WalkingGate];length:number}
const flatDistance=(a:Vector3,b:Vector3)=>Math.hypot(a.x-b.x,a.z-b.z);
function boundary(points:Vector3[]):Boundary{const lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths[i-1]+points[i].distanceTo(points[i-1]));return {points,lengths,length:lengths.at(-1)!};}
function sample(side:Boundary,t:number){const d=Math.max(0,Math.min(1,t))*side.length;let i=1;while(i<side.lengths.length-1&&side.lengths[i]<d)i++;return side.points[i-1].clone().lerp(side.points[i],(d-side.lengths[i-1])/Math.max(1e-6,side.lengths[i]-side.lengths[i-1]));}
export function zonePoint(zone:WalkingZone,t:number,lateral=.5){
  const a=sample(zone.sides[0],t),b=sample(zone.sides[1],t),width=flatDistance(a,b),margin=Math.min(.5,Math.max(.15,WALKING_CLEARANCE/Math.max(1e-6,width)));
  // Approach the goal span through its middle, then fan out gradually after entry.
  // The two stored blue lines at a seam need not have matching lateral orientation.
  const blend=Math.min(1,Math.min(t,1-t)*zone.length/4),offset=.5+(lateral-.5)*blend;
  return a.lerp(b,Math.max(margin,Math.min(1-margin,offset)));
}
/** Experimental interpretation: paired type-23 boundaries form a corridor; type-22 IDs link its end gates. */
export function buildWalkingZones(rows:PedestrianWalk[]){
  const zones:WalkingZone[]=[];
  for(const row of rows){const runs:PedestrianRecord[]=[],spans:PedestrianRecord[]=[];const visit=(r:PedestrianRecord)=>{if(r.kind===23&&r.points)runs.push(r);if(r.kind===22&&r.id!==undefined&&r.quad)spans.push(r);if(r.child)visit(r.child);};row.records.forEach(visit);
    if(runs.length!==2||spans.length!==2)continue;
    const a=boundary(pedestrianRun(runs[0])),raw=pedestrianRun(runs[1]);
    if(flatDistance(a.points[0],raw[0])>flatDistance(a.points[0],raw.at(-1)!))raw.reverse();const b=boundary(raw);
    if(a.length<1||b.length<1)continue;
    const ends=[sample(a,0).lerp(sample(b,0),.5),sample(a,1).lerp(sample(b,1),.5)];
    const mid=(r:PedestrianRecord)=>new Vector3((r.quad![0]+r.quad![2])/2,0,(r.quad![1]+r.quad![3])/2);
    if(flatDistance(ends[0],mid(spans[0]))>flatDistance(ends[0],mid(spans[1])))spans.reverse();
    // Do not turn unrelated local spans into world-space corridor gates.
    if(ends.some((p,i)=>flatDistance(p,mid(spans[i]))>12))continue;
    zones.push({id:row.id,sides:[a,b],gates:ends.map((point,i)=>({junction:spans[i].id!,point})) as [WalkingGate,WalkingGate],length:(a.length+b.length)/2});
  }return zones;
}
interface Transition {from:Vector3;to:Vector3;path:Boundary;polygon:Vector3[];polygons:Vector3[][];via:number[];target:WalkingZone;entry:0|1;t:number;length:number}
export class WalkingPedestrian {
  readonly position=new Vector3();readonly direction=new Vector3(0,0,1);
  speed=0;fleeing=false;transition?:Transition;
  private cooldown=0;private baseSpeed:number;private fleeSpeed:number;
  constructor(public zone:WalkingZone,public t:number,public sign:1|-1,readonly lateral:number,private zones:WalkingZone[],private rows:Map<number,PedestrianWalk>,private random= Math.random){this.baseSpeed=.9+random()*.6;this.fleeSpeed=1.8+random()*1.2;this.position.copy(zonePoint(zone,t,lateral));}
  step(dt:number,cars:readonly Vector3[]){
    dt=Math.max(0,Math.min(.1,dt));this.cooldown=Math.max(0,this.cooldown-dt);
    let threat:Vector3|undefined,distance=12;for(const car of cars){const d=flatDistance(car,this.position);if(Math.abs(car.y-this.position.y)<4&&d<distance){distance=d;threat=car;}}
    this.fleeing=!!threat;const targetSpeed=threat?this.fleeSpeed:this.baseSpeed;this.speed+=Math.max(-dt*3,Math.min(dt*3,targetSpeed-this.speed));
    const before=this.position.clone();
    if(this.transition){const tr=this.transition;
      if(threat&&this.cooldown===0&&flatDistance(threat,tr.to)+2<flatDistance(threat,tr.from)){
        [tr.from,tr.to]=[tr.to,tr.from];tr.path=boundary([...tr.path.points].reverse());const zone=this.zone,entry=(this.sign>0?1:0) as 0|1;this.zone=tr.target;this.sign=tr.entry===0?-1:1;tr.target=zone;tr.entry=entry;tr.t=1-tr.t;this.cooldown=2;
      }
      tr.t=Math.min(1,tr.t+this.speed*dt/tr.length);
      this.position.copy(sample(tr.path,tr.t));tr.polygon=tr.polygons.find(p=>insideTransition(this.position,p))??tr.polygon;
      if(tr.t>=1){this.zone=tr.target;this.t=tr.entry;this.sign=tr.entry===0?1:-1;this.transition=undefined;}
    }else{
      const ahead=zonePoint(this.zone,Math.max(0,Math.min(1,this.t+this.sign*.02)),this.lateral).sub(this.position);
      if(threat&&this.cooldown===0&&ahead.dot(threat.clone().sub(this.position))>0){this.sign=this.sign===1?-1:1;this.cooldown=2;}
      this.t=Math.max(0,Math.min(1,this.t+this.sign*this.speed*dt/this.zone.length));this.position.copy(zonePoint(this.zone,this.t,this.lateral));
      if((this.sign===1&&this.t===1)||(this.sign===-1&&this.t===0))this.nextZone();
    }
    const movement=this.position.clone().sub(before);movement.y=0;if(movement.lengthSq()>1e-8)this.direction.copy(movement.normalize());
  }
  private nextZone(){
    const exit=this.sign===1?1:0,forward=zonePoint(this.zone,exit).sub(zonePoint(this.zone,exit===0?.02:.98)).setY(0).normalize();
    const routes=forwardWalkingRoutes(this.zone,exit,this.position,forward,this.zones,this.rows,zonePoint);
    if(!routes.length){this.sign=this.sign===1?-1:1;return;}
    const chosen=routes[Math.min(routes.length-1,Math.floor(this.random()*routes.length))],path=boundary(chosen.points),to=chosen.points.at(-1)!.clone();
    this.transition={from:this.position.clone(),to,path,polygon:chosen.polygons[0],polygons:chosen.polygons,via:chosen.via,target:chosen.target,entry:chosen.entry,t:0,length:Math.max(.01,path.length)};
  }
}
export function spawnWalkingPedestrians(rows:PedestrianWalk[],focus:Vector3,count=6,random=Math.random){
  const zones=buildWalkingZones(rows),byId=new Map(rows.map(r=>[r.id,r]));
  const candidates=zones.map(zone=>{let t=0,d=Infinity;for(let i=0;i<=100;i++){const point=zonePoint(zone,i/100);const distance=point.distanceToSquared(focus);if(distance<d){d=distance;t=i/100;}}return {zone,t,d};}).sort((a,b)=>a.d-b.d).filter(c=>c.d<150*150);
  return Array.from({length:Math.min(count,candidates.length*2)},(_,i)=>{const c=candidates[i%Math.min(3,candidates.length)];return new WalkingPedestrian(c.zone,Math.max(.05,Math.min(.95,c.t+(Math.floor(i/3)-.5)*.035)),c.t<.5?-1:1,.25+random()*.5,zones,byId,random);});
}
