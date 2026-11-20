import {Vector3} from 'three';
import {pedestrianFloor,type PedestrianWalk} from '../formats/pedestrian';
import {pedestrianRun} from './pedestrian-run';
import {WALKING_CLEARANCE} from './pedestrian-transition';
import {PedestrianBoundary} from './pedestrian-boundary';

interface Edge {points:Vector3[];target:number;gate:boolean;boundary:PedestrianBoundary}
interface Area {row:PedestrianWalk;edges:Edge[];runs:Edge[]}
export interface PedestrianThreat {position:Vector3;velocity:Vector3}
const cross=(x:number,z:number,ex:number,ez:number)=>x*ez-z*ex;
const flat=(a:Vector3,b:Vector3)=>Math.hypot(a.x-b.x,a.z-b.z);

/** Shared immutable world-space boundaries. Agents retain headings instead of
 * following a centre line; gates change ownership to the adjoining authored row. */
export class PedestrianAreas {
  readonly areas=new Map<number,Area>();
  constructor(rows:PedestrianWalk[]){
    for(const row of rows){const edges:Edge[]=[];
      for(const r of row.records){
        let points:Vector3[];
        if(r.kind===23)points=pedestrianRun(r);
        else if(r.quad){const q=r.quad;points=[new Vector3(q[0]+row.origin[0],0,q[1]+row.origin[1]),new Vector3(q[2]+row.origin[0],0,q[3]+row.origin[1])];for(const p of points)p.y=pedestrianFloor(row,p.x,p.z);}
        else continue;
        if(points.length>1)edges.push({points,target:r.id??-1,gate:r.id!==undefined&&r.id!==-1,boundary:new PedestrianBoundary(points)});
      }
      this.areas.set(row.id,{row,edges,runs:edges.filter(e=>e.points.length>2)});
    }
  }
  contains(id:number,p:Vector3){
    const area=this.areas.get(id);if(!area)return false;let inside=false;
    for(const edge of area.edges)for(let i=1;i<edge.points.length;i++){
      const a=edge.points[i-1],b=edge.points[i];
      if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)inside=!inside;
    }return inside;
  }
  floor(id:number,p:Vector3){const area=this.areas.get(id);if(!area)return p.y;
    // Corridor run samples carry their own elevation; junctions use the plane header.
    if(area.runs.length){let y=0,weight=0;for(const edge of area.runs){
      const n=edge.boundary.nearest(p,true),w=1/Math.max(.05,n.distance);y+=n.y*w;weight+=w;
    }return y/weight;}
    return pedestrianFloor(area.row,p.x,p.z);
  }
  constrain(walker:AreaWalker,before:Vector3){
    const previousArea=walker.zone.id;
    let area=this.areas.get(walker.zone.id);if(!area){walker.ok=false;return;}
    for(let pass=0;pass<3;pass++){
      let moved=false;
      for(const edge of area.edges){
        if(edge.gate){
          const a=edge.points[0],b=edge.points.at(-1)!,dx=b.x-a.x,dz=b.z-a.z;
          const old=cross(dx,dz,before.x-a.x,before.z-a.z),now=cross(dx,dz,walker.position.x-a.x,walker.position.z-a.z);
          if(old>=-1e-6&&now<0){const t=old/(old-now),x=before.x+(walker.position.x-before.x)*t,z=before.z+(walker.position.z-before.z)*t,u=((x-a.x)*dx+(z-a.z)*dz)/Math.max(1e-9,dx*dx+dz*dz);
            if(u>=-1e-5&&u<=1.00001){const target=this.areas.get(edge.target);if(!target){walker.ok=false;return;}walker.zone={id:edge.target};area=target;moved=true;break;}
          }continue;
        }
        const n=edge.boundary.nearest(walker.position),side=(walker.position.x-n.x)*n.nx+(walker.position.z-n.z)*n.nz;
        if(n.interior&&side<WALKING_CLEARANCE&&n.distance<3){walker.position.x+=n.nx*(WALKING_CLEARANCE-side);walker.position.z+=n.nz*(WALKING_CLEARANCE-side);}
      }
      if(!moved)break;
    }
    if(!this.contains(walker.zone.id,walker.position)){
      // Reject an exit around a wall end cap; only explicit gates may change rows.
      walker.zone={id:previousArea};walker.position.copy(before);walker.heading.negate();
    }
    walker.position.y=this.floor(walker.zone.id,walker.position);
  }
  step(walker:AreaWalker,dt:number,cars:readonly PedestrianThreat[],others:readonly AreaWalker[]){
    const area=this.areas.get(walker.zone.id);if(!area){walker.ok=false;return;}
    const p=walker.position,influences:{weight:number;x:number;z:number;edge:boolean}[]=[];
    for(const edge of area.edges){if(edge.gate)continue;const n=edge.boundary.nearest(p),weight=Math.max(0,1.875/(Math.max(0,n.distance-1)+.75)-.5);
      if(weight>0)influences.push({weight,x:n.nx,z:n.nz,edge:true});
    }
    for(const other of others){if(other===walker||!other.ok||Math.abs(other.position.y-p.y)>3)continue;const d=flat(p,other.position);if(d<4&&d>1e-4)influences.push({weight:Math.max(0,52.5/(d+6)-5.25),x:(p.x-other.position.x)/d,z:(p.z-other.position.z)/d,edge:false});}
    influences.sort((a,b)=>b.weight-a.weight);influences.length=Math.min(4,influences.length);
    let x=walker.heading.x*3,z=walker.heading.z*3,total=3,turnX=0,turnZ=0;walker.fleeing=false;
    for(const i of influences){x+=i.x*i.weight;z+=i.z*i.weight;total+=i.weight;if(i.edge){turnX+=i.x*i.weight;turnZ+=i.z*i.weight;}}
    for(const car of cars){if(Math.abs(car.position.y-p.y)>4)continue;const rx=p.x-car.position.x,rz=p.z-car.position.z,d=Math.hypot(rx,rz),speed=car.velocity.length(),fx=speed>.001?car.velocity.x/speed:0,fz=speed>.001?car.velocity.z/speed:0,lon=rx*fx+rz*fz,lat=-rx*fz+rz*fx;
      if(d<2.24&&d>.001){x+=rx/d*10;z+=rz/d*10;total+=10;walker.fleeing=true;}
      else if(speed>.001&&lon>0&&lon<speed*5&&Math.abs(lat)<5){const side=lat>=0?1:-1,w=10*(1-lon/(speed*5));x+=-fz*side*w;z+=fx*side*w;total+=w;walker.fleeing=true;}
    }
    x/=total;z/=total;const magnitude=Math.hypot(x,z);if(magnitude>0&&magnitude<1){x/=Math.sqrt(magnitude);z/=Math.sqrt(magnitude);}
    walker.heading.x+=turnX*.5/total;walker.heading.z+=turnZ*.5/total;walker.heading.normalize();
    const before=p.clone(),old=walker.direction.clone();p.x+=x*dt;p.z+=z*dt;this.constrain(walker,before);
    const distance=flat(p,before);walker.speed=dt>0?distance/dt:0;
    if(distance>1e-7){walker.direction.set(p.x-before.x,0,p.z-before.z).normalize();const angle=Math.min(Math.PI*distance,Math.acos(Math.max(-1,Math.min(1,old.dot(walker.direction)))));walker.gait=dt>0?(distance+angle*.5)/dt:0;}else walker.gait=0;
  }
}
export class AreaWalker {
  readonly position:Vector3;readonly direction:Vector3;readonly heading:Vector3;
  speed=0;gait=0;fleeing=false;ok=true;
  constructor(readonly network:PedestrianAreas,public zone:{id:number},position:Vector3,direction:Vector3){this.position=position.clone();this.heading=direction.clone().setY(0).normalize();this.direction=this.heading.clone();this.position.y=network.floor(zone.id,this.position);}
  step(dt:number,cars:readonly PedestrianThreat[],others:readonly AreaWalker[]=[]){let remaining=Math.min(.1,Math.max(0,dt));while(remaining>1e-8){const step=Math.min(1/30,remaining);this.network.step(this,step,cars,others);remaining-=step;}}
}
