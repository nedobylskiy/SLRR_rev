import { Matrix4, Mesh, Vector3, type Group, type BufferGeometry } from 'three';
import type { EnginePart } from '../engine/world';
import { modelMatrix } from '../engine/model-transform';
import { poseMatrix } from '../engine/transforms';
import { skinSavedPanel } from '../engine/vehicle-damage';

/** Keep the SCX reference separate so re-entering physics never binds an already dented mesh twice. */
export function restoreReferenceGeometry(group:Group) {
  group.userData.savedPanelApplied=false;
  for(const mesh of group.children) if(mesh instanceof Mesh){
    const geometry=mesh.geometry as BufferGeometry, original=geometry.userData.damageReference as Float32Array|undefined;
    if(original){geometry.getAttribute('position').array.set(original);geometry.getAttribute('position').needsUpdate=true;
      geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();}
  }
}
export function applySavedPanel(group:Group,part:EnginePart) {
  const state=part.savedDamage?.panel;
  if(group.userData.savedPanelApplied&&group.userData.savedPanelState===state)return;
  restoreReferenceGeometry(group);
  group.userData.savedPanelState=state;group.userData.savedPanelApplied=true;
  if(!state)return;
  const frame=modelMatrix(new Matrix4(),part.definition.config.renderPose&&poseMatrix(part.definition.config.renderPose));
  const inverse=frame.clone().invert();
  for(const mesh of group.children) if(mesh instanceof Mesh){
    const geometry=mesh.geometry as BufferGeometry,attribute=geometry.getAttribute('position');
    if(!geometry.userData.damageReference)geometry.userData.damageReference=new Float32Array(attribute.array);
    for(let i=0;i<attribute.count;i++){
      const point=new Vector3().fromBufferAttribute(attribute,i).applyMatrix4(frame);
      const deformed=skinSavedPanel(state,point).applyMatrix4(inverse);
      attribute.setXYZ(i,deformed.x,deformed.y,deformed.z);
    }
    attribute.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
  }
}
