import {Box3,Mesh,Object3D} from 'three';

/** Bounds of the part's own SCX surfaces; children such as lamps are effects,
 * not part geometry or collision hulls. Position edits invalidate cached bounds. */
const versions=new WeakMap<Mesh,{attribute:unknown;version:number}>();
const scratch=new Box3();
export function partGeometryBounds(part:Object3D,target:Box3):Box3 {
  target.makeEmpty();part.updateWorldMatrix(true,true);
  for(const child of part.children){
    if(!(child instanceof Mesh))continue;
    const position=child.geometry.getAttribute('position');if(!position)continue;
    const cached=versions.get(child);
    if(!cached||cached.attribute!==position||cached.version!==position.version){
      child.geometry.computeBoundingBox();versions.set(child,{attribute:position,version:position.version});
    }
    if(child.geometry.boundingBox)target.union(scratch.copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld));
  }
  return target;
}
