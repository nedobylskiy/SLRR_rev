import { BufferGeometry, Group, Matrix4, Mesh, Vector3 } from 'three';
import type { TrafficCrush } from '../engine/traffic-vehicle';

/** Immutable template geometry is shared until the first dent; only this instance then owns skins. */
export class TrafficDamageView {
  private version=0;
  private skins:{mesh:Mesh;geometry:BufferGeometry;base:BufferGeometry;original:Float32Array;toRoot:Matrix4;fromRoot:Matrix4}[]=[];
  constructor(private group:Group,private crush:TrafficCrush){}
  update(){
    if(this.version===this.crush.version)return;
    if(!this.skins.length){
      this.group.updateMatrixWorld(true);const inverse=this.group.matrixWorld.clone().invert();
      this.group.traverse(object=>{
        if(!(object instanceof Mesh))return;
        for(let parent=object.parent;parent&&parent!==this.group;parent=parent.parent)if(parent.userData.trafficWheel)return;
        const base=object.geometry,geometry=base.clone(),toRoot=inverse.clone().multiply(object.matrixWorld);
        object.geometry=geometry;this.skins.push({mesh:object,geometry,base,original:new Float32Array(geometry.getAttribute('position').array),toRoot,fromRoot:toRoot.clone().invert()});
      });
    }
    const position=new Vector3(),delta=new Vector3();
    for(const skin of this.skins){
      const attribute=skin.geometry.getAttribute('position');
      for(let i=0;i<attribute.count;i++){
        position.fromArray(skin.original,i*3).applyMatrix4(skin.toRoot);this.crush.displacement(position,delta);position.add(delta).applyMatrix4(skin.fromRoot);attribute.setXYZ(i,position.x,position.y,position.z);
      }
      attribute.needsUpdate=true;skin.geometry.computeVertexNormals();skin.geometry.computeBoundingSphere();skin.geometry.computeBoundingBox();
    }
    this.version=this.crush.version;
  }
  dispose(){for(const skin of this.skins)skin.geometry.dispose();this.skins.length=0;}
  reset(){for(const skin of this.skins){skin.mesh.geometry=skin.base;skin.geometry.dispose();}this.skins.length=0;this.version=0;}
}
