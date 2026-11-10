import {Vector3} from 'three';
import type {PedestrianWalk} from '../formats/pedestrian';
import {buildWalkingZones,WalkingPedestrian,zonePoint,type WalkingZone} from './pedestrian-walking';
export interface PedestrianSpawn {zone:WalkingZone;t:number;lateral:number;position:Vector3}
export interface PedestrianObstacle {position:Vector3;radius:number;velocity?:Vector3}
const CELL=64;
/** Static corridor samples are indexed once; moving the player never rebuilds zones or skeletons. */
export class PedestrianSpawnIndex {
  readonly zones:WalkingZone[];private rows:Map<number,PedestrianWalk>;private cells=new Map<string,PedestrianSpawn[]>();
  constructor(rows:PedestrianWalk[]){
    this.zones=buildWalkingZones(rows);this.rows=new Map(rows.map(row=>[row.id,row]));
    for(const zone of this.zones){const steps=Math.max(1,Math.ceil(zone.length/8));for(let i=0;i<steps;i++)for(const lateral of [.25,.5,.75]){
      const t=(i+.5)/steps,position=zonePoint(zone,t,lateral),key=`${Math.floor(position.x/CELL)},${Math.floor(position.z/CELL)}`,cell=this.cells.get(key)??[];
      cell.push({zone,t,lateral,position});this.cells.set(key,cell);
    }}
  }
  choose(focus:Vector3,radius:number,occupied:readonly PedestrianObstacle[],offscreen?:(position:Vector3)=>boolean,random=Math.random){
    let choice:PedestrianSpawn|undefined,count=0,blind=false;
    for(let x=Math.floor((focus.x-radius)/CELL);x<=Math.floor((focus.x+radius)/CELL);x++)for(let z=Math.floor((focus.z-radius)/CELL);z<=Math.floor((focus.z+radius)/CELL);z++)for(const p of this.cells.get(`${x},${z}`)??[]){
      const distance=p.position.distanceTo(focus),hidden=offscreen?.(p.position)??false;
      if(distance>radius||distance<(hidden?12:35)||Math.abs(p.position.y-focus.y)>20)continue;
      if(occupied.some(o=>{if(Math.abs(o.position.y-p.position.y)>4)return false;const delta=p.position.clone().sub(o.position),v=o.velocity??new Vector3(),t=Math.max(0,Math.min(2,delta.dot(v)/Math.max(.001,v.lengthSq())));return delta.addScaledVector(v,-t).length()<o.radius+1.5;}))continue;
      if(hidden&&!blind){choice=undefined;count=0;blind=true;}else if(blind&&!hidden)continue;
      if(random()<1/++count)choice=p;
    }return choice;
  }
  walker(spawn:PedestrianSpawn,random=Math.random){return new WalkingPedestrian(spawn.zone,spawn.t,spawn.t<.5?-1:1,spawn.lateral,this.zones,this.rows,random);}
}
