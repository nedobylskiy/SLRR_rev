import {BufferGeometry,Mesh,Vector3,type Material} from 'three';

export function isPaintSurface(material:Material){
  return !!material.userData.paintDefault&&material.visible&&!material.transparent&&material.opacity>=.999;
}
export function hasPaintSurface(mesh:Mesh){return (Array.isArray(mesh.material)?mesh.material:[mesh.material]).some(isPaintSurface);}

/** Restrict a projector to actual paint faces. A part's texture slot alone does
 * not make its glass, trim, or inward-facing triangles valid decal receivers. */
/** Without `direction`, every paint face of the material is kept (whole-surface UV checks). */
export function paintSurfaceGeometry(mesh:Mesh,direction:Vector3|undefined,wantedMaterial?:number):BufferGeometry|undefined {
  const source=mesh.geometry,positions=source.getAttribute('position'),index=source.index;
  const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
  const count=index?.count??positions.count,indices:number[]=[];
  const a=new Vector3(),b=new Vector3(),c=new Vector3(),normal=new Vector3();
  const begin=source.drawRange.start,end=Math.min(count,begin+source.drawRange.count);
  for(let offset=begin;offset+2<end;offset+=3){
    const group=source.groups.find(group=>offset>=group.start&&offset<group.start+group.count);
    const materialIndex=Array.isArray(mesh.material)?group?.materialIndex??0:0;
    if(wantedMaterial!==undefined&&materialIndex!==wantedMaterial)continue;
    const material=materials[materialIndex];
    if(!material||!isPaintSurface(material))continue;
    const ia=index?index.getX(offset):offset,ib=index?index.getX(offset+1):offset+1,ic=index?index.getX(offset+2):offset+2;
    a.fromBufferAttribute(positions,ia).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(positions,ib).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(positions,ic).applyMatrix4(mesh.matrixWorld);
    normal.subVectors(b,a).cross(c.sub(a)).normalize();
    if(direction&&normal.dot(direction)<=.05)continue;
    indices.push(ia,ib,ic);
  }
  if(!indices.length)return;
  const geometry=source.clone();geometry.clearGroups();geometry.setIndex(indices);geometry.setDrawRange(0,indices.length);return geometry;
}
