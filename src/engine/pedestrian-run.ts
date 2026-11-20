import {Vector3} from 'three';
import type {PedestrianRecord} from '../formats/pedestrian';

/** Original run construction: tangent directions matter, their stored lengths do not.
 * The initial unit-direction curve supplies the length used to rescale both tangents. */
export function pedestrianRun(record:PedestrianRecord,spacing=.5):Vector3[]{
  const nodes=record.points??[],out:Vector3[]=[];
  if(!record.directions)return nodes.map(p=>new Vector3(...p));
  for(let i=1;i<nodes.length;i++){
    const a=new Vector3(...nodes[i-1]),b=new Vector3(...nodes[i]);
    const fallback=b.clone().sub(a).normalize();
    const tangent=(index:number)=>{const d=record.directions?.[index];return d?new Vector3(...d).normalize():fallback.clone();};
    const u=tangent(i-1),v=tangent(i);
    const at=(t:number,scale:number)=>{const t2=t*t,t3=t2*t;return a.clone().multiplyScalar(2*t3-3*t2+1).addScaledVector(b,3*t2-2*t3).addScaledVector(u,(t3-2*t2+t)*scale).addScaledVector(v,(t3-t2)*scale);};
    let length=0,previous=a;for(let j=1;j<=100;j++){const p=at(j/100,1);length+=p.distanceTo(previous);previous=p;}
    const count=Math.max(1,Math.min(4096,Math.ceil(length/spacing)));
    if(!out.length)out.push(a);for(let j=1;j<=count;j++)out.push(at(j/count,length));
  }
  return out;
}
