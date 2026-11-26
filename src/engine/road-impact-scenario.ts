import {Vector3} from 'three';
import type {RoadNetwork} from '../formats/trc';
import type {RoadRoute} from './road-route';
import {RoadTrafficCar,trafficConnections} from './road-traffic';

/** A repeatable lane near the origin, with enough room before its next junction. */
export function roadImpactScenario(network:RoadNetwork,origin=new Vector3(),distance=60){
  if(!Number.isFinite(distance)||distance<15)throw Error('Impact approach must be at least 15 metres');
  const connections=trafficConnections(network);
  let best:RoadTrafficCar|undefined,bestDistance=Infinity;
  for(const lane of network.others){
    if(!connections.get(lane.id)?.length)continue;
    const cursor=new RoadTrafficCar(network,origin,()=>0,lane.id);
    const remaining=lane.segments.reduce((sum,segment)=>sum+segment.length,0)-cursor.snapshot().at;
    if(remaining<distance+8)continue;
    const d=cursor.position.distanceToSquared(origin);
    if(d<bestDistance){bestDistance=d;best=cursor;}
  }
  if(!best)throw Error('No connected road near the origin has enough room for the impact approach');
  const start=best.position.clone(),direction=best.direction.clone(),target=new Vector3(),targetDirection=new Vector3();
  const points:RoadRoute['points']=[];
  for(let at=0;at<distance;at+=2){best.targetAhead(at,target,targetDirection);points.push(target.toArray());}
  best.targetAhead(distance,target,targetDirection);points.push(target.toArray());
  // Keep the impact point separate from the AI finish. The test must drive
  // through the stationary car, rather than brake to park beside its bumper.
  const goal=target.clone().addScaledVector(targetDirection,200);points.push(goal.toArray());
  return {road:best.roadId,start,direction,target:target.clone(),targetDirection:targetDirection.clone(),goal,approachMetres:distance,
    route:{points,length:distance+200,direction:direction.toArray(),roads:[best.roadId]} satisfies RoadRoute};
}
