import {BufferAttribute,BufferGeometry} from 'three';
import {mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';

/** Split only large static surfaces. Values are in world metres after SCX scaling. */
export function splitMapGeometry(geometry:BufferGeometry,cellSize=64):BufferGeometry[] {
  if(!Number.isFinite(cellSize)||cellSize<=0)throw new Error('Invalid map chunk size');
  geometry.computeBoundingBox();const box=geometry.boundingBox;
  if(!box||Math.max(box.max.x-box.min.x,box.max.z-box.min.z)<=cellSize*2||geometry.groups.length
    ||Object.keys(geometry.morphAttributes).length)return [geometry];
  const layout=Object.entries(geometry.attributes).map(([name,attribute])=>({name,attribute,offset:0}));
  let stride=0;for(const item of layout){item.offset=stride;stride+=item.attribute.itemSize;}
  const position=layout.find(item=>item.name==='position');if(!position)return [geometry];
  const px=position.offset,pz=px+2,eps=1e-8;
  const read=(index:number)=>layout.flatMap(({attribute})=>Array.from({length:attribute.itemSize},(_,i)=>attribute.getComponent(index,i)));
  const clip=(polygon:number[][],axis:number,edge:number,lower:boolean)=>{
    const out:number[][]=[];
    for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length];
      const ai=lower?a[axis]>=edge-eps:a[axis]<=edge+eps,bi=lower?b[axis]>=edge-eps:b[axis]<=edge+eps;
      if(ai)out.push(a);
      if(ai!==bi){const t=Math.max(0,Math.min(1,(edge-a[axis])/(b[axis]-a[axis])));out.push(a.map((v,j)=>v+(b[j]-v)*t));}
    }
    return out;
  };
  const cells=new Map<string,number[]>(),index=geometry.index;
  const count=index?.count??position.attribute.count;
  const start=Math.max(0,geometry.drawRange.start),end=Math.min(count,start+geometry.drawRange.count);
  for(let i=start;i+2<end;i+=3){
    const triangle=[0,1,2].map(j=>read(index?index.getX(i+j):i+j));
    const minX=Math.min(...triangle.map(v=>v[px])),maxX=Math.max(...triangle.map(v=>v[px]));
    const minZ=Math.min(...triangle.map(v=>v[pz])),maxZ=Math.max(...triangle.map(v=>v[pz]));
    const x0=Math.floor(minX/cellSize),x1=Math.max(x0,Math.floor((maxX-eps)/cellSize));
    const z0=Math.floor(minZ/cellSize),z1=Math.max(z0,Math.floor((maxZ-eps)/cellSize));
    // Preserve unsupported pathological assets instead of freezing on an unbounded grid.
    if((x1-x0+1)*(z1-z0+1)>4096)return [geometry];
    for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){
      let polygon=clip(triangle,px,x*cellSize,true);polygon=clip(polygon,px,(x+1)*cellSize,false);
      polygon=clip(polygon,pz,z*cellSize,true);polygon=clip(polygon,pz,(z+1)*cellSize,false);
      if(polygon.length<3)continue;
      const key=`${x},${z}`,values=cells.get(key)??[];
      for(let j=1;j+1<polygon.length;j++){
        const [a,b,c]=[polygon[0],polygon[j],polygon[j+1]];
        const u=[b[px]-a[px],b[px+1]-a[px+1],b[pz]-a[pz]],v=[c[px]-a[px],c[px+1]-a[px+1],c[pz]-a[pz]];
        if((u[1]*v[2]-u[2]*v[1])**2+(u[2]*v[0]-u[0]*v[2])**2+(u[0]*v[1]-u[1]*v[0])**2<1e-18)continue;
        values.push(...a,...b,...c);
      }
      if(values.length)cells.set(key,values);
    }
  }
  if(cells.size<2)return [geometry];
  return [...cells].map(([key,values])=>{
    const chunk=new BufferGeometry();chunk.name=`${geometry.name} [cell ${key}]`;
    for(const {name,attribute,offset} of layout){
      const array=new Float32Array(values.length/stride*attribute.itemSize);
      for(let i=0;i<values.length/stride;i++)for(let j=0;j<attribute.itemSize;j++)array[i*attribute.itemSize+j]=values[i*stride+offset+j];
      chunk.setAttribute(name,new BufferAttribute(array,attribute.itemSize));
    }
    const merged=mergeVertices(chunk,1e-6);chunk.dispose();merged.name=chunk.name;
    merged.computeBoundingBox();merged.computeBoundingSphere();return merged;
  });
}
