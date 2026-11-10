import {Group,Matrix4,Mesh,Quaternion,Vector3} from 'three';
import type {EnginePart} from '../engine/world';
import {linkedSuspensionAnchors} from '../engine/linked-suspension';
import {SuspensionSkin} from './suspension-playground';

/** Visual-only replacement of the stock spring/shock mesh. Physics is untouched. */
export class VehicleSuspensionSkin {
  private primary:Mesh[];
  private previous=new Matrix4().makeScale(0,0,0);
  private previousLength=-1;
  private enabled=true;
  constructor(readonly part:EnginePart,readonly group:Group,readonly skin:SuspensionSkin){
    this.primary=group.children.filter((o):o is Mesh=>o instanceof Mesh);
    skin.debug.visible=false;skin.character.root.matrixAutoUpdate=false;
    for(const mesh of skin.character.meshes)mesh.frustumCulled=false;
    group.add(skin.character.root);
  }
  static kind(part:EnginePart){
    const path=part.definition.model?.path.replace(/\\/g,'/').toLowerCase();
    return path==='parts/running_gear/meshes/spring.scx'?'spring':path==='parts/running_gear/meshes/shock_absorber.scx'?'shock':undefined;
  }
  setEnabled(enabled:boolean){this.enabled=enabled;this.update();}
  update(){
    const character=this.skin.character.root;
    if(!this.enabled){character.visible=false;for(const mesh of this.primary)mesh.visible=true;return;}
    let root=this.part;while(root.parent)root=root.parent;
    const anchors=linkedSuspensionAnchors(root,this.part);
    if(!anchors){character.visible=false;for(const mesh of this.primary)mesh.visible=true;return;}
    const frame=this.part.matrix(),lower=anchors.lower.applyMatrix4(frame),axis=anchors.upper.applyMatrix4(frame).sub(lower),length=axis.length();
    const valid=length>=this.skin.span*.1&&length<=this.skin.span*3;
    character.visible=valid;for(const mesh of this.primary)mesh.visible=!valid;
    if(!valid)return;
    // Proxy carries the ordinary SCX centimetre/render-pose transform. Cancel it
    // before placing the metre-based BON endpoints in the same part hierarchy.
    const matrix=this.group.matrix.clone().invert().multiply(new Matrix4().compose(lower,new Quaternion().setFromUnitVectors(new Vector3(0,1,0),axis.divideScalar(length)),new Vector3(1,1,1)));
    if(!matrix.equals(this.previous)){character.matrix.copy(matrix);character.matrixWorldNeedsUpdate=true;this.previous.copy(matrix);}
    if(Math.abs(length-this.previousLength)>1e-6){this.skin.setPose(length/this.skin.span,0,false);this.previousLength=length;}
  }
  dispose(){for(const mesh of this.primary)mesh.visible=true;this.skin.dispose();}
}
