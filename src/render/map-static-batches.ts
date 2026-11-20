import { Mesh, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Merge compatible opaque parts within a model and a spatial cell; Infinity
 * batches required ground by material across the whole compiled model. */
export function mergeStaticMapParts(parts:Mesh[],cellSize=128):Mesh[] {
  const groups=new Map<string,Mesh[]>(),retained:Mesh[]=[];
  for(const part of parts){
    const g=part.geometry,m=part.material;
    if(Array.isArray(m)||m.transparent||m.opacity<1||m.alphaTest>0||Object.keys(g.morphAttributes).length
      ||g.drawRange.start!==0||g.drawRange.count!==Infinity||Object.values(g.attributes).some(a=>'isInterleavedBufferAttribute' in a)){retained.push(part);continue;}
    g.computeBoundingBox();const box=g.boundingBox!;
    if(box.isEmpty()||box.getSize(new Vector3()).length()>cellSize*2||g.getAttribute('position').count>100000){retained.push(part);continue;}
    const center=box.getCenter(new Vector3());
    const layout=Object.entries(g.attributes).sort(([a],[b])=>a.localeCompare(b)).map(([name,a])=>
      `${name}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`).join('|');
    const key=[Math.floor(center.x/cellSize),Math.floor(center.z/cellSize),m.uuid,layout,!!g.index,
      part.renderOrder,part.castShadow,part.receiveShadow,part.userData.staticMapCaster,part.layers.mask].join(';');
    const group=groups.get(key)??[];group.push(part);groups.set(key,group);
  }
  const batches:[string,Mesh[]][]=[];
  for(const [key,group] of groups){
    if(Number.isFinite(cellSize)){batches.push([key,group]);continue;}
    let batch:Mesh[]=[],vertices=0;
    for(const part of group){const count=part.geometry.getAttribute('position').count;
      if(vertices+count>100000&&batch.length){batches.push([key,batch]);batch=[];vertices=0;}
      batch.push(part);vertices+=count;
    }
    if(batch.length)batches.push([key,batch]);
  }
  for(const [key,group] of batches){
    if(group.length<2||group.reduce((n,p)=>n+p.geometry.getAttribute('position').count,0)>100000){retained.push(...group);continue;}
    // Geometry is in the model's shared coordinate frame, as in MapObjectStream.
    const geometry=mergeGeometries(group.map(p=>p.geometry),false);
    if(!geometry){retained.push(...group);continue;}
    geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const first=group[0],mesh=new Mesh(geometry,first.material);
    mesh.name=`merged static ${key.split(';').slice(0,2).join(',')} / ${group.length} parts`;
    mesh.renderOrder=first.renderOrder;mesh.castShadow=first.castShadow;mesh.receiveShadow=first.receiveShadow;
    mesh.layers.mask=first.layers.mask;mesh.userData={...first.userData,mergedStatic:true,mergedSourceParts:group.length};
    retained.push(mesh);
  }
  return retained;
}
