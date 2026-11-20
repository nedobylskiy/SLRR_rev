import {Box3,Matrix3,Mesh,Quaternion,Vector3,type Group} from 'three';
import type {EnginePart} from '../engine/world';
import type {PaintTarget} from '../engine/paint-stroke';
import {hasPaintSurface} from './paint-surface';

/** One projector shared by adjacent paintable panels of the picked vehicle. */
export function paintTargets(proxies:ReadonlyMap<EnginePart,Group>,hit:{id:number;local:number[];normal?:number[]},size:number):PaintTarget[]{
  const picked=[...proxies.keys()].find(part=>part.nativeId===hit.id);if(!picked||!hit.normal||!(size>0))return [];
  const root=(part:EnginePart)=>{while(part.parent)part=part.parent;return part;},car=root(picked);
  const frame=picked.matrix(),point=new Vector3(...hit.local).applyMatrix4(frame);
  const normal=new Vector3(...hit.normal).applyNormalMatrix(new Matrix3().getNormalMatrix(frame));
  const tangent=new Vector3(1,0,0).applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0,0,1),normal));
  const result:PaintTarget[]=[];
  for(const [part,group]of proxies){
    if(!part.nativeId||part.world.disposed||!group.visible||part.definition.config.texture===undefined||root(part)!==car)continue;
    group.updateWorldMatrix(true,true);
    const bounds=new Box3();group.traverseVisible(object=>{
      if(!(object instanceof Mesh)||object.userData.paintStroke||!hasPaintSurface(object))return;
      const revision=object.geometry.getAttribute('position')?.version;
      if(!object.geometry.boundingBox||object.geometry.userData.paintBoundsVersion!==revision){object.geometry.computeBoundingBox();object.geometry.userData.paintBoundsVersion=revision;}
      if(object.geometry.boundingBox)bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
    });
    // Circumscribed sphere of the decal box (size, size, size/2). Actual
    // clipping still happens against each panel's triangles in DecalGeometry.
    if(bounds.isEmpty()||bounds.distanceToPoint(point)>size*.75)continue;
    const inverse=part.matrix().invert();
    result.push({id:part.nativeId,position:point.clone().applyMatrix4(inverse).toArray(),
      normal:normal.clone().applyNormalMatrix(new Matrix3().getNormalMatrix(inverse)).toArray(),
      tangent:tangent.clone().transformDirection(inverse).toArray()});
  }
  return result;
}
