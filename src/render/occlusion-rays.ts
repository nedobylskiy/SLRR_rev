import {Box3,Ray,Triangle,Vector3,type BufferGeometry} from 'three';

export interface RayFace {id:number;triangle:Triangle;bounds:Box3;patches:number[]}
export interface RayBranch<T> {bounds:Box3;items?:T[];left?:RayBranch<T>;right?:RayBranch<T>}
const vertexKey=(v:Vector3)=>v.toArray().map(n=>Math.round(n*1e5)).join(',');
function convexBoundary(faces:RayFace[]):Vector3[]|undefined {
  const edges=new Map<string,{a:Vector3;b:Vector3;count:number}>(),normal=faces[0].triangle.getNormal(new Vector3()),origin=faces[0].triangle.a;
  let area=0;
  for(const face of faces){
    if(face.triangle.getNormal(new Vector3()).dot(normal)<.999999)return;
    const vertices=[face.triangle.a,face.triangle.b,face.triangle.c];area+=face.triangle.getArea();
    for(const v of vertices)if(Math.abs(normal.dot(v.clone().sub(origin)))>1e-5)return;
    for(let i=0;i<3;i++){
      const a=vertices[i],b=vertices[(i+1)%3],key=[vertexKey(a),vertexKey(b)].sort().join('|');
      const edge=edges.get(key);if(edge){if(++edge.count>2)return;}else edges.set(key,{a,b,count:1});
    }
  }
  const boundary=[...edges.values()].filter(e=>e.count===1),adjacent=new Map<string,{key:string;point:Vector3}[]>();
  for(const {a,b} of boundary)for(const [from,to] of [[a,b],[b,a]]){
    const key=vertexKey(from),items=adjacent.get(key)??[];items.push({key:vertexKey(to),point:to});adjacent.set(key,items);
  }
  if(!boundary.length||[...adjacent.values()].some(items=>items.length!==2))return;
  const start=vertexKey(boundary[0].a),polygon=[boundary[0].a];let previous=start,current=vertexKey(boundary[0].b);
  while(current!==start&&polygon.length<=boundary.length){
    const point=adjacent.get(previous)!.find(item=>item.key===current)!.point;polygon.push(point);
    const next=adjacent.get(current)!.find(item=>item.key!==previous)!;previous=current;current=next.key;
  }
  if(current!==start||polygon.length!==boundary.length)return; // Holes/multiple loops are not filled.
  let orientation=0,signedArea=0;
  const simplified:Vector3[]=[];
  for(let i=0;i<polygon.length;i++){
    const a=polygon[(i+polygon.length-1)%polygon.length],b=polygon[i],c=polygon[(i+1)%polygon.length];
    const ab=b.clone().sub(a),bc=c.clone().sub(b),turn=normal.dot(ab.clone().cross(bc));
    if(Math.abs(turn)>1e-8){if(!orientation)orientation=Math.sign(turn);else if(turn*orientation<0)return;simplified.push(b);}
    else if(ab.dot(bc)<0)return;
    signedArea+=normal.dot(b.clone().cross(c))*.5;
  }
  if(simplified.length<3||Math.abs(Math.abs(signedArea)-area)>Math.max(1e-6,area*1e-6))return;
  return simplified;
}
export function rayTree<T extends {bounds:Box3}>(items:T[]):RayBranch<T>|undefined {
  if(!items.length)return;
  const bounds=new Box3();for(const item of items)bounds.union(item.bounds);
  if(items.length<=8)return {bounds,items};
  const size=bounds.getSize(new Vector3()),axis=size.x>=size.y&&size.x>=size.z?'x':size.y>=size.z?'y':'z';
  const sorted=[...items].sort((a,b)=>(a.bounds.min[axis]+a.bounds.max[axis])-(b.bounds.min[axis]+b.bounds.max[axis]));
  const mid=Math.floor(sorted.length/2);
  return {bounds,left:rayTree(sorted.slice(0,mid)),right:rayTree(sorted.slice(mid))};
}

/** Exact intersections and validated coplanar convex patches; never boxes as blockers. */
export class OccluderGeometry {
  private tree?:RayBranch<RayFace>;
  private point=new Vector3();
  private patches=new Map<number,RayFace[]>();
  private polygons=new Map<number,Vector3[]>();
  constructor(geometry:BufferGeometry){
    const position=geometry.getAttribute('position'),index=geometry.index,faces:RayFace[]=[];
    const end=Math.min(index?.count??position.count,geometry.drawRange.start+geometry.drawRange.count);
    for(let i=geometry.drawRange.start;i+2<end;i+=3){
      const vertices=[0,1,2].map(j=>new Vector3().fromBufferAttribute(position,index?index.getX(i+j):i+j));
      const triangle=new Triangle(...vertices as [Vector3,Vector3,Vector3]);
      if(triangle.getArea()>1e-8)faces.push({id:faces.length,triangle,bounds:new Box3().setFromPoints(vertices),patches:[faces.length]});
    }
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
    const parent=faces.map((_,i)=>i);
    const find=(i:number):number=>parent[i]===i?i:parent[i]=find(parent[i]);
    for(const items of edges.values())if(items.length===2){
      const [a,b]=items,n=a.face.triangle.getNormal(new Vector3()),other=b.face.triangle.getNormal(new Vector3());
      if(n.dot(other)<.999999||Math.abs(n.dot(b.c.clone().sub(a.a)))>1e-5)continue;
      const edge=a.b.clone().sub(a.a);
      if(n.dot(edge.clone().cross(a.c.clone().sub(a.a)))*n.dot(edge.clone().cross(b.c.clone().sub(a.a)))>=-1e-10)continue;
      parent[find(b.face.id)]=find(a.face.id);
    }
    const groups=new Map<number,RayFace[]>();
    for(const face of faces){const id=find(face.id),group=groups.get(id)??[];group.push(face);groups.set(id,group);}
    for(const group of groups.values())if(group.length>2){
      const polygon=convexBoundary(group);if(!polygon)continue;
      this.polygons.set(patch,polygon);for(const face of group)face.patches.push(patch);patch++;
    }
    for(const face of faces)for(const id of face.patches){const group=this.patches.get(id)??[];group.push(face);this.patches.set(id,group);}
    this.tree=rayTree(faces);
  }
  patchVertices(id:number):Vector3[]|undefined {
    let polygon=this.polygons.get(id);
    if(!polygon){const faces=this.patches.get(id);if(!faces)return;polygon=convexBoundary(faces);if(polygon)this.polygons.set(id,polygon);}
    return polygon;
  }
  intersections(ray:Ray,far:number,limit=8):{distance:number;patches:number[]}[] {
    const stack=this.tree?[this.tree]:[];let best=far;const results:{distance:number;patches:number[]}[]=[];
    while(stack.length){
      const node=stack.pop()!;
      const entry=ray.intersectBox(node.bounds,this.point);
      if(!entry||(!node.bounds.containsPoint(ray.origin)&&entry.distanceTo(ray.origin)>best))continue;
      if(node.items)for(const face of node.items){
        const hit=ray.intersectTriangle(face.triangle.a,face.triangle.b,face.triangle.c,false,this.point);
        if(hit){const distance=hit.distanceTo(ray.origin);if(distance<best){
          results.push({distance,patches:face.patches});results.sort((a,b)=>a.distance-b.distance);
          if(results.length>limit)results.length=limit;if(results.length===limit)best=results[results.length-1].distance;
        }}
      }else{if(node.left)stack.push(node.left);if(node.right)stack.push(node.right);}
    }return results;
  }
  nearest(ray:Ray,far:number){return this.intersections(ray,far,1)[0];}
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
