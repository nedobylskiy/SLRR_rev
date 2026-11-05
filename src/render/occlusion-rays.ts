import {Box3,Ray,Triangle,Vector3,type BufferGeometry} from 'three';

export interface RayFace {id:number;triangle:Triangle;bounds:Box3;patches:number[]}
export interface RayBranch<T> {bounds:Box3;items?:T[];left?:RayBranch<T>;right?:RayBranch<T>}
export function rayTree<T extends {bounds:Box3}>(items:T[]):RayBranch<T>|undefined {
  if(!items.length)return;
  const bounds=new Box3();for(const item of items)bounds.union(item.bounds);
  if(items.length<=8)return {bounds,items};
  const size=bounds.getSize(new Vector3()),axis=size.x>=size.y&&size.x>=size.z?'x':size.y>=size.z?'y':'z';
  const sorted=[...items].sort((a,b)=>(a.bounds.min[axis]+a.bounds.max[axis])-(b.bounds.min[axis]+b.bounds.max[axis]));
  const mid=Math.floor(sorted.length/2);
  return {bounds,left:rayTree(sorted.slice(0,mid)),right:rayTree(sorted.slice(mid))};
}

/** Exact triangle intersections plus convex two-triangle patches; never bounding boxes as blockers. */
export class OccluderGeometry {
  private tree?:RayBranch<RayFace>;
  private point=new Vector3();
  constructor(geometry:BufferGeometry){
    const position=geometry.getAttribute('position'),index=geometry.index,faces:RayFace[]=[];
    const end=Math.min(index?.count??position.count,geometry.drawRange.start+geometry.drawRange.count);
    for(let i=geometry.drawRange.start;i+2<end;i+=3){
      const vertices=[0,1,2].map(j=>new Vector3().fromBufferAttribute(position,index?index.getX(i+j):i+j));
      const triangle=new Triangle(...vertices as [Vector3,Vector3,Vector3]);
      if(triangle.getArea()>1e-8)faces.push({id:faces.length,triangle,bounds:new Box3().setFromPoints(vertices),patches:[faces.length]});
    }
    const vertexKey=(v:Vector3)=>v.toArray().map(n=>Math.round(n*1e5)).join(',');
    const edges=new Map<string,{face:RayFace;a:Vector3;b:Vector3;c:Vector3}[]>();let patch=faces.length;
    for(const face of faces){
      const vertices=[face.triangle.a,face.triangle.b,face.triangle.c];
      for(let i=0;i<3;i++){
        const a=vertices[i],b=vertices[(i+1)%3],c=vertices[(i+2)%3],key=[vertexKey(a),vertexKey(b)].sort().join('|');
        const previous=edges.get(key)??[];
        for(const other of previous){
          const normal=face.triangle.getNormal(new Vector3()),d=other.c;
          if(Math.abs(normal.dot(d.clone().sub(a)))>1e-5)continue;
          const side=(p:Vector3,q:Vector3,r:Vector3)=>normal.dot(q.clone().sub(p).cross(r.clone().sub(p)));
          // The shared edge is a diagonal of a convex, coplanar quadrilateral.
          if(side(a,b,c)*side(a,b,d)<-1e-10&&side(c,d,a)*side(c,d,b)<-1e-10){face.patches.push(patch);other.face.patches.push(patch++);}
        }
        previous.push({face,a,b,c});edges.set(key,previous);
      }
    }
    this.tree=rayTree(faces);
  }
  nearest(ray:Ray,far:number):{distance:number;patches:number[]}|undefined {
    const stack=this.tree?[this.tree]:[];let best=far,result:{distance:number;patches:number[]}|undefined;
    while(stack.length){
      const node=stack.pop()!;
      const entry=ray.intersectBox(node.bounds,this.point);
      if(!entry||(!node.bounds.containsPoint(ray.origin)&&entry.distanceTo(ray.origin)>best))continue;
      if(node.items)for(const face of node.items){
        const hit=ray.intersectTriangle(face.triangle.a,face.triangle.b,face.triangle.c,false,this.point);
        if(hit){const distance=hit.distanceTo(ray.origin);if(distance<best){best=distance;result={distance,patches:face.patches};}}
      }else{if(node.left)stack.push(node.left);if(node.right)stack.push(node.right);}
    }return result;
  }
}

/** All box vertices plus centre must be behind the same convex opaque patch. */
export function occludedBox(bounds:Box3,origin:Vector3,hit:(point:Vector3)=>string[]|undefined):boolean {
  if(bounds.containsPoint(origin))return false;
  const points:Vector3[]=[];
  for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])points.push(new Vector3(x,y,z));
  points.push(bounds.getCenter(new Vector3()));let shared:Set<string>|undefined;
  for(const point of points){
    const patches=hit(point);if(!patches?.length)return false;
    shared=shared?new Set(patches.filter(p=>shared!.has(p))):new Set(patches);
    if(!shared.size)return false;
  }return true;
}
