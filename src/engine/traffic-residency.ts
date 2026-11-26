import {Vector3} from 'three';
import {TrafficSpawnIndex,type TrafficOccupant} from './traffic-stream';

/** Initial world placement has no camera, heading or player-relative sector. */
export function worldTrafficSpawn(index:TrafficSpawnIndex,occupied:readonly TrafficOccupant[],radius:number,player:Vector3,random=Math.random){
  return index.any(spawn=>spawn.position.distanceTo(player)>Math.max(40,radius+15)&&occupied.every(other=>
    Math.abs(other.y-spawn.position.y)>4||Math.hypot(other.x-spawn.position.x,other.z-spawn.position.z)>radius+(other.trafficRadius??6)+8),random);
}

/** Dormant vehicles keep their pose, speed and route; only proximity wakes them. */
export function trafficResidentActive(position:Vector3,player:Vector3,radius:number,active:boolean){
  const distance=Math.hypot(position.x-player.x,position.z-player.z);
  return distance<=radius+(active?50:0);
}
