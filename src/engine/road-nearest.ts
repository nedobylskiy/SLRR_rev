import type {RoadNetwork,RoadNode,RoadPoint} from '../formats/trc';

/** GroundRef distance is a desired radius, not a cutoff. Both pools participate; stable ties retain file order. */
export function nearestRoadCrossing(network:RoadNetwork,point:RoadPoint,radius=0):RoadNode|undefined {
  if(!point.every(Number.isFinite)||!Number.isFinite(radius))return;
  let selected:RoadNode|undefined,best=Infinity;
  for(const node of network.nodes){
    const distance=Math.hypot(node.position[0]-point[0],node.position[1]-point[1],node.position[2]-point[2]);
    const score=Math.abs(distance-radius);
    if(score<best){best=score;selected=node;}
  }
  return selected;
}
