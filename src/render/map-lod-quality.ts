import {Triangle,Vector3,type BufferGeometry} from 'three';

/** Geometric edges, ignoring duplicate vertices at UV/normal seams. Reject open/non-manifold shells. */
export function closedLodSurface(geometry:BufferGeometry):boolean {
  const position=geometry.getAttribute('position'),index=geometry.index;
  if(!position)return false;
  geometry.computeBoundingBox();const size=geometry.boundingBox!.getSize(new Vector3()),scale=size.length();
  if(!scale)return false;
  const epsilon=scale*1e-7,keys=Array.from({length:position.count},(_,i)=>
    [position.getX(i),position.getY(i),position.getZ(i)].map(v=>Math.round(v/epsilon)).join(','));
  const edges=new Map<string,{count:number;direction:number}>();let volume=0;
  const a=new Vector3(),b=new Vector3(),c=new Vector3(),cross=new Vector3();
  const count=index?.count??position.count;
  for(let i=0;i+2<count;i+=3){
    const ids=[0,1,2].map(j=>index?index.getX(i+j):i+j),triangle=ids.map(i=>keys[i]);
    if(new Set(triangle).size<3)continue;
    a.fromBufferAttribute(position,ids[0]);b.fromBufferAttribute(position,ids[1]);c.fromBufferAttribute(position,ids[2]);
    volume+=a.dot(cross.crossVectors(b,c))/6;
    for(let j=0;j<3;j++){
      const u=triangle[j],v=triangle[(j+1)%3],forward=u<v,key=forward?`${u}|${v}`:`${v}|${u}`;
      const edge=edges.get(key)??{count:0,direction:0};edge.count++;edge.direction+=forward?1:-1;edges.set(key,edge);
      if(edge.count>2)return false;
    }
  }
  return edges.size>0&&Math.abs(volume)>scale**3*1e-7&&[...edges.values()].every(e=>e.count===2&&e.direction===0);
}

/** Bidirectional sampled surface error; counts/attribute validity alone do not protect a facade. */
export function acceptableLodShape(source:BufferGeometry,reduced:BufferGeometry):boolean {
  if(!closedLodSurface(reduced))return false;
  source.computeBoundingBox();reduced.computeBoundingBox();
  const diagonal=source.boundingBox!.getSize(new Vector3()).length(),limit=diagonal*0.02;
  if(!diagonal)return false;
  const expanded=source.boundingBox!.clone().expandByScalar(limit);
  if(!expanded.containsBox(reduced.boundingBox!))return false;
  if(!reduced.boundingBox!.clone().expandByScalar(limit).containsBox(source.boundingBox!))return false;
  const covers=(from:BufferGeometry,to:BufferGeometry)=>{
    const p=from.getAttribute('position'),q=to.getAttribute('position'),indices=to.index;
    const n=indices?.count??q.count,point=new Vector3(),closest=new Vector3(),triangle=new Triangle();
    const points:Vector3[]=[];
    for(let i=0;i<p.count;i+=Math.max(1,Math.ceil(p.count/64)))points.push(new Vector3().fromBufferAttribute(p,i));
    const sourceIndex=from.index,count=sourceIndex?.count??p.count;
    for(let i=0;i+2<count;i+=3*Math.max(1,Math.ceil(count/192))){
      point.set(0,0,0);for(let j=0;j<3;j++)point.add(closest.fromBufferAttribute(p,sourceIndex?sourceIndex.getX(i+j):i+j));
      points.push(point.clone().multiplyScalar(1/3));
    }
    for(const sample of points){
      let distance=Infinity;
      for(let i=0;i+2<n;i+=3){
        triangle.a.fromBufferAttribute(q,indices?indices.getX(i):i);
        triangle.b.fromBufferAttribute(q,indices?indices.getX(i+1):i+1);
        triangle.c.fromBufferAttribute(q,indices?indices.getX(i+2):i+2);
        triangle.closestPointToPoint(sample,closest);distance=Math.min(distance,sample.distanceToSquared(closest));
        if(distance<=limit*limit)break;
      }
      if(distance>limit*limit)return false;
    }
    return true;
  };
  return covers(source,reduced)&&covers(reduced,source);
}
