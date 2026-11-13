import {Vector3} from 'three';
import type {TrafficPose} from './traffic-models';
import {TrafficSpawnIndex,trafficCruiseSpeed,type TrafficSpawn} from './traffic-stream';

export const DISTANT_RIVAL_INTERVAL=5000;
/** Five-second position estimates only: no models, suspension, contacts or per-frame navigation. */
export class DistantRivals {
 private states=new Map<number,{next:number;anchor:TrafficSpawn}>();
 constructor(private index:TrafficSpawnIndex,private random=Math.random){}
 forget(id:number){this.states.delete(id);}
 update(id:number,pose:TrafficPose,visible:boolean,focus:Vector3,near:number,now:number):boolean {
  if(visible){this.forget(id);return false;}
  const position=new Vector3(pose.position.x,pose.position.y,pose.position.z);
  let state=this.states.get(id);
  if(state&&now<state.next)return false;
  const established=!!state;
  const anchor=state&&state.anchor.position.distanceToSquared(position)<1?state.anchor:this.index.nearest(position);
  if(!anchor)return false;
  this.states.set(id,state={next:now+DISTANT_RIVAL_INTERVAL,anchor});
  if(Math.hypot(position.x-focus.x,position.z-focus.z)<=near)return false;
  // Initial off-graph Java placements must first be attached to a lane.
  let target=anchor;
  const speed=trafficCruiseSpeed(anchor.speedGroup,this.random);
  if(established&&position.distanceToSquared(anchor.position)<1){
   const radius=speed*DISTANT_RIVAL_INTERVAL/1000;
   target=this.index.choose(anchor.position,radius,[],this.random,.1,false,undefined,0,
    candidate=>candidate.position.distanceToSquared(anchor.position)<=radius*radius&&Math.abs(candidate.position.y-anchor.position.y)<4&&Math.hypot(candidate.position.x-focus.x,candidate.position.z-focus.z)>near)??anchor;
  }
  state.anchor=target;Object.assign(pose.position,target.position);
  pose.yaw=Math.atan2(-target.direction.x,-target.direction.z);
  Object.assign(pose.velocity,target.direction.clone().multiplyScalar(speed));
  return true;
 }
}
