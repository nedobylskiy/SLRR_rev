import {Vector3} from 'three';
import type {PedestrianWalk} from '../formats/pedestrian';
import type {WalkingZone} from './pedestrian-walking';
import {constrainedTransition,transitionGates,transitionPolygon} from './pedestrian-transition';
interface Route {target:WalkingZone;entry:0|1;points:Vector3[];polygons:Vector3[][];score:number;via:number[]}
/** Follow explicit blue-gate IDs through any intermediate yellow cells, never nearest unrelated geometry. */
export function forwardWalkingRoutes(source:WalkingZone,exit:0|1,from:Vector3,forward:Vector3,zones:WalkingZone[],rows:Map<number,PedestrianWalk>,point:(zone:WalkingZone,t:number)=>Vector3):Route[]{
  const byZone=new Map(zones.map(z=>[z.id,z])),first=rows.get(source.gates[exit].junction);if(!first)return [];
  const queue=[{row:first,previous:source.id,from,points:[from.clone()],polygons:[] as Vector3[][],via:[] as number[]}],result:Route[]=[];
  for(let processed=0;queue.length&&processed<128;processed++){
    const current=queue.shift()!;if(current.via.includes(current.row.id)||current.via.length>=12)continue;
    const via=[...current.via,current.row.id];
    for(const gate of transitionGates(current.row)){
      if(gate.id===current.previous||gate.id===source.id)continue;
      const target=byZone.get(gate.id);
      if(target){
        const entry=target.gates.findIndex(g=>g.junction===current.row.id);if(entry<0)continue;
        const to=point(target,entry),part=constrainedTransition(current.row,current.from,to);if(!part)continue;
        const direction=to.clone().sub(from).setY(0).normalize(),outgoing=point(target,entry===0?.02:.98).sub(to).setY(0).normalize();
        const points=[...current.points,...part.points.slice(1)],length=points.reduce((sum,p,i)=>sum+(i?p.distanceTo(points[i-1]):0),0);
        result.push({target,entry:entry as 0|1,points,polygons:[...current.polygons,part.polygon],score:direction.dot(forward)*.7+outgoing.dot(forward)*.3-length*.001,via});
      }else{
        const next=rows.get(gate.id);if(!next||via.includes(next.id)||!transitionPolygon(next))continue;
        const opposite=transitionGates(next).find(g=>g.id===current.row.id&&g.point.clone().setY(0).distanceTo(gate.point)<.1);if(!opposite)continue;
        const to=gate.point.clone().setY(current.from.y),part=constrainedTransition(current.row,current.from,to);if(!part)continue;
        queue.push({row:next,previous:current.row.id,from:to,points:[...current.points,...part.points.slice(1)],polygons:[...current.polygons,part.polygon],via});
      }
    }
  }
  // Preserve the direction of travel; random choice is only between equivalent forward exits.
  const best=Math.max(-Infinity,...result.map(r=>r.score));return result.filter(r=>r.score>=best-.05);
}
