import {Vector3} from 'three';
import type {PedestrianRecord,PedestrianWalk} from '../formats/pedestrian';

export const WALKING_CLEARANCE=.3;
const wallCache=new WeakMap<PedestrianWalk,[Vector3,Vector3][]>();
const distance=(a:Vector3,b:Vector3)=>Math.hypot(a.x-b.x,a.z-b.z);
const cross=(a:Vector3,b:Vector3,c:Vector3)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
const cache=new WeakMap<PedestrianWalk,Vector3[]|null>();
/** Closed boundary made from yellow walls and blue gates, in the junction's local XZ frame. */
export function transitionPolygon(row:PedestrianWalk):Vector3[]|undefined {
  if(cache.has(row))return cache.get(row)??undefined;
  const edges:[Vector3,Vector3][]=[];
  const visit=(r:PedestrianRecord)=>{if(r.kind===23)return;if(r.quad){const q=r.quad;edges.push([new Vector3(q[0]+row.origin[0],0,q[1]+row.origin[1]),new Vector3(q[2]+row.origin[0],0,q[3]+row.origin[1])]);}if(r.child)visit(r.child);};
  row.records.forEach(visit);if(edges.length<3){cache.set(row,null);return;}
  const first=edges.shift()!,polygon=[first[0],first[1]];
  while(edges.length){const end=polygon.at(-1)!,i=edges.findIndex(e=>e.some(p=>distance(p,end)<.02));if(i<0){cache.set(row,null);return;}
    const [a,b]=edges.splice(i,1)[0];polygon.push(distance(a,end)<.02?b:a);
  }
  if(distance(polygon[0],polygon.at(-1)!)>.02){cache.set(row,null);return;}
  polygon.pop();cache.set(row,polygon);return polygon;
}
export function insideTransition(point:Vector3,polygon:readonly Vector3[]){
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[j],b=polygon[i],length=distance(a,b);
    if(length>1e-8&&Math.abs(cross(a,b,point))/length<.015&&point.x>=Math.min(a.x,b.x)-.015&&point.x<=Math.max(a.x,b.x)+.015&&point.z>=Math.min(a.z,b.z)-.015&&point.z<=Math.max(a.z,b.z)+.015)return true;
    if((a.z>point.z)!==(b.z>point.z)&&point.x<(b.x-a.x)*(point.z-a.z)/(b.z-a.z)+a.x)inside=!inside;
  }return inside;
}
export function transitionWalls(row:PedestrianWalk){
  let walls=wallCache.get(row);if(walls)return walls;walls=[];
  const visit=(r:PedestrianRecord)=>{if(r.kind===21&&r.quad){const q=r.quad;walls!.push([new Vector3(q[0]+row.origin[0],0,q[1]+row.origin[1]),new Vector3(q[2]+row.origin[0],0,q[3]+row.origin[1])]);}if(r.child)visit(r.child);};row.records.forEach(visit);wallCache.set(row,walls);return walls;
}
export function transitionGates(row:PedestrianWalk){
  const gates:{id:number;point:Vector3}[]=[];
  const visit=(r:PedestrianRecord)=>{if(r.kind===22&&r.id!==undefined&&r.quad){const q=r.quad;gates.push({id:r.id,point:new Vector3((q[0]+q[2])/2+row.origin[0],0,(q[1]+q[3])/2+row.origin[1])});}if(r.child)visit(r.child);};row.records.forEach(visit);return gates;
}
function pointSegmentDistance(p:Vector3,a:Vector3,b:Vector3){const d=b.clone().sub(a),t=Math.max(0,Math.min(1,((p.x-a.x)*d.x+(p.z-a.z)*d.z)/Math.max(1e-9,d.x*d.x+d.z*d.z)));return distance(p,a.clone().addScaledVector(d,t));}
export function transitionWallClearance(point:Vector3,row:PedestrianWalk){return Math.min(Infinity,...transitionWalls(row).map(([a,b])=>pointSegmentDistance(point,a,b)));}
function clearOfWalls(a:Vector3,b:Vector3,walls:readonly [Vector3,Vector3][]){return walls.every(([c,d])=>Math.min(pointSegmentDistance(a,c,d),pointSegmentDistance(b,c,d),pointSegmentDistance(c,a,b),pointSegmentDistance(d,a,b))>=WALKING_CLEARANCE-1e-6);}
function segmentInside(a:Vector3,b:Vector3,polygon:readonly Vector3[]){
  if(!insideTransition(a,polygon)||!insideTransition(b,polygon))return false;
  for(let i=0;i<polygon.length;i++){const c=polygon[i],d=polygon[(i+1)%polygon.length];if(cross(a,b,c)*cross(a,b,d)<-1e-8&&cross(c,d,a)*cross(c,d,b)<-1e-8){
    const dx=b.x-a.x,dz=b.z-a.z,ex=d.x-c.x,ez=d.z-c.z,t=((c.x-a.x)*ez-(c.z-a.z)*ex)/(dx*ez-dz*ex);
    // SCX/gate endpoints differ by float rounding. Permit only a tiny entry/exit crossing.
    if(Math.min(t,1-t)*distance(a,b)>.02)return false;
  }}
  for(const t of [.25,.5,.75])if(!insideTransition(a.clone().lerp(b,t),polygon))return false;return true;
}
function curve(a:Vector3,c:Vector3,b:Vector3){
  const count=Math.max(16,Math.min(256,Math.ceil((distance(a,c)+distance(c,b))*5)));
  return Array.from({length:count+1},(_,i)=>{const t=i/count,u=1-t;return a.clone().multiplyScalar(u*u).addScaledVector(c,2*t*u).addScaledVector(b,t*t);});
}
function valid(points:Vector3[],polygon:readonly Vector3[],walls:readonly [Vector3,Vector3][]){return points.every((p,i)=>insideTransition(p,polygon)&&clearOfWalls(p,p,walls)&&(i===0||segmentInside(points[i-1],p,polygon)&&clearOfWalls(points[i-1],p,walls)));}
/** Prefer the smooth junction-centre arc; if it cuts outside, route around the authored walls and round safe corners. */
export function constrainedTransition(row:PedestrianWalk,from:Vector3,to:Vector3):{points:Vector3[];polygon:Vector3[]}|undefined {
  const polygon=transitionPolygon(row),walls=transitionWalls(row);if(!polygon||!insideTransition(from,polygon)||!insideTransition(to,polygon)||!clearOfWalls(from,from,walls)||!clearOfWalls(to,to,walls))return;
  const control=new Vector3(row.origin[0],(from.y+to.y)/2,row.origin[1]),arc=curve(from,control,to);
  let points=arc;
  if(!valid(arc,polygon,walls)){
    // Finite wall end caps matter: extending offset wall lines through an
    // almost collinear blue gate would incorrectly close that gate.
    const candidates=[...polygon];for(const wall of walls)for(const end of wall)for(let i=0;i<24;i++){const angle=i*Math.PI/12;candidates.push(end.clone().add(new Vector3(Math.cos(angle)*.31,0,Math.sin(angle)*.31)));}
    const nodes=[from,to,...candidates.filter(p=>insideTransition(p,polygon)&&clearOfWalls(p,p,walls))],cost=nodes.map(()=>Infinity),previous=nodes.map(()=>-1),done=new Set<number>();cost[0]=0;
    for(let step=0;step<nodes.length;step++){
      let current=-1;for(let i=0;i<nodes.length;i++)if(!done.has(i)&&(current<0||cost[i]<cost[current]))current=i;
      if(current<0||!Number.isFinite(cost[current]))break;if(current===1)break;done.add(current);
      for(let i=0;i<nodes.length;i++)if(i!==current&&!done.has(i)&&segmentInside(nodes[current],nodes[i],polygon)&&clearOfWalls(nodes[current],nodes[i],walls)){
        const next=cost[current]+distance(nodes[current],nodes[i]);if(next<cost[i]){cost[i]=next;previous[i]=current;}
      }
    }
    if(previous[1]<0)return;
    const path:Vector3[]=[];for(let i=1;i>=0;i=previous[i]){path.unshift(nodes[i]);if(i===0)break;}
    points=[from.clone()];
    for(let i=1;i<path.length-1;i++){
      const corner=path[i],radius=Math.min(.75,distance(path[i-1],corner)*.3,distance(corner,path[i+1])*.3);
      const a=corner.clone().lerp(path[i-1],radius/Math.max(1e-6,distance(corner,path[i-1]))),b=corner.clone().lerp(path[i+1],radius/Math.max(1e-6,distance(corner,path[i+1]))),rounded=curve(a,corner,b);
      if(valid(rounded,polygon,walls))points.push(...rounded);else points.push(corner.clone());
    }points.push(to.clone());if(!valid(points,polygon,walls))return;
  }
  // Original endpoints supply elevation; the transition walls are XZ data.
  const lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths[i-1]+distance(points[i-1],points[i]));
  const length=lengths.at(-1)!;points.forEach((p,i)=>p.y=from.y+(to.y-from.y)*(length>1e-8?lengths[i]/length:0));
  return {points,polygon};
}
