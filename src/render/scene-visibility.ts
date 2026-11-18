import {Box3,Frustum,InstancedMesh,Matrix4,type Camera,type Object3D} from 'three';

export interface VisibilityObject {object:Object3D;bounds?:Box3;exclude?:boolean}
/** One primary-camera policy for color, reflections and shadow passes alike. */
export class SceneVisibility {
  private frustum=new Frustum();
  private projection=new Matrix4();
  private localBounds=new WeakMap<Object3D,{children:number;version:number;count:number;box:Box3}>();
  private hidden:{object:Object3D;parent:Object3D}[]=[];
  private box=new Box3();
  apply(camera:Camera,range:number,objects:Iterable<VisibilityObject>){
    this.restore();camera.updateWorldMatrix(true,false);
    this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    const seen=new Set<Object3D>();
    for(const {object,bounds,exclude}of objects){
      if(seen.has(object)||!object.visible||!object.parent)continue;seen.add(object);
      let visible=!exclude;
      if(visible){
        if(bounds)this.box.copy(bounds);
        else{
          object.updateWorldMatrix(true,false);
          let cached=this.localBounds.get(object);
          const version=object instanceof InstancedMesh?object.instanceMatrix.version:0;
          const count=object instanceof InstancedMesh?object.count:0;
          if(!cached||cached.children!==object.children.length||cached.version!==version||cached.count!==count||cached.box.isEmpty()){
            if(object instanceof InstancedMesh)object.computeBoundingBox();
            const box=new Box3().setFromObject(object);
            if(box.isEmpty())continue;
            box.applyMatrix4(object.matrixWorld.clone().invert()).expandByScalar(.5);
            cached={children:object.children.length,version,count,box};this.localBounds.set(object,cached);
          }
          this.box.copy(cached.box).applyMatrix4(object.matrixWorld);
        }
        visible=this.box.distanceToPoint(camera.position)<=range&&this.frustum.intersectsBox(this.box);
      }
      if(!visible){
        // Detach before ANY renderer traversal, including shadow cameras. Keep
        // ownership separately so this does not delete or reset the simulation.
        this.hidden.push({object,parent:object.parent!});object.visible=false;object.removeFromParent();
      }
    }
  }
  restore(){for(const {object,parent}of this.hidden){if(!object.parent)parent.add(object);object.visible=true;}this.hidden.length=0;}
}
