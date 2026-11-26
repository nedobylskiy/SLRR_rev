import type {Vector3} from 'three';

interface Segment {a:Vector3;dx:number;dy:number;dz:number;length2:number;inverseLength:number;index:number}
interface Node {minX:number;minZ:number;maxX:number;maxZ:number;start:number;end:number;left?:Node;right?:Node}
export interface BoundaryPoint {distance:number;x:number;z:number;y:number;nx:number;nz:number;interior:boolean}

/** Immutable acceleration structure for the sampled walking boundary. Queries
 * still use the original segments, including their orientation and elevation. */
export class PedestrianBoundary {
  private readonly segments:Segment[]=[];
  private readonly root:Node;
  constructor(points:readonly Vector3[]){
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,length2=dx*dx+dz*dz;
      this.segments.push({a,dx,dy:b.y-a.y,dz,length2,inverseLength:length2>0?1/Math.sqrt(length2):0,index:i-1});
    }
    const build=(start:number,end:number):Node=>{
      const node:Node={minX:Infinity,minZ:Infinity,maxX:-Infinity,maxZ:-Infinity,start,end};
      for(let i=start;i<end;i++){const s=this.segments[i];
        node.minX=Math.min(node.minX,s.a.x,s.a.x+s.dx);node.maxX=Math.max(node.maxX,s.a.x,s.a.x+s.dx);
        node.minZ=Math.min(node.minZ,s.a.z,s.a.z+s.dz);node.maxZ=Math.max(node.maxZ,s.a.z,s.a.z+s.dz);
      }
      if(end-start>8){const mid=(start+end)>>>1;node.left=build(start,mid);node.right=build(mid,end);}
      return node;
    };
    this.root=build(0,this.segments.length);
  }
  nearest(p:Vector3,floor=false):BoundaryPoint {
    let best=Infinity,bestIndex=Infinity,x=0,z=0,y=p.y,nx=0,nz=0,interior=false;
    const distance2=(node:Node)=>{const dx=Math.max(node.minX-p.x,0,p.x-node.maxX),dz=Math.max(node.minZ-p.z,0,p.z-node.maxZ);return dx*dx+dz*dz;};
    const visit=(node:Node)=>{
      if(distance2(node)>best+1e-12)return;
      if(node.left&&node.right){
        const left=distance2(node.left),right=distance2(node.right);
        if(left<=right){visit(node.left);visit(node.right);}else{visit(node.right);visit(node.left);}return;
      }
      for(let i=node.start;i<node.end;i++){
        const s=this.segments[i];if(!floor&&s.length2<1e-16)continue;
        const raw=((p.x-s.a.x)*s.dx+(p.z-s.a.z)*s.dz)/(floor?Math.max(1e-9,s.length2):s.length2),t=Math.max(0,Math.min(1,raw));
        const qx=s.a.x+s.dx*t,qz=s.a.z+s.dz*t,dx=p.x-qx,dz=p.z-qz,d=dx*dx+dz*dz;
        if(d<best||(d===best&&s.index<bestIndex)){
          best=d;bestIndex=s.index;x=qx;z=qz;y=s.a.y+s.dy*t;
          nx=-s.dz*s.inverseLength;nz=s.dx*s.inverseLength;interior=raw>=0&&raw<=1;
        }
      }
    };
    visit(this.root);return {distance:Math.sqrt(best),x,z,y,nx,nz,interior};
  }
}
