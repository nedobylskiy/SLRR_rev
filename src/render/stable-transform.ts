import {Matrix4, type Object3D} from 'three';

/** Avoid forcing every descendant to rebuild its world matrix when this
 * container's local transform has not changed. Children still update normally. */
export function cacheUnchangedTransform(object:Object3D, enabled:()=>boolean=()=>true) {
  const original=object.updateMatrix;
  const composed=new Matrix4();
  // Streamed meshes often have matrixAutoUpdate=false and an authored local
  // matrix. A newly attached subtree must be evaluated even under a still root.
  object.addEventListener('childadded',event=>{event.child.matrixWorldNeedsUpdate=true;});
  object.updateMatrix=function(){
    if(!enabled()) { original.call(this); return; }
    composed.compose(this.position,this.quaternion,this.scale);
    if(!this.matrix.equals(composed)) {
      this.matrix.copy(composed);
      this.matrixWorldNeedsUpdate=true;
    }
  };
}
