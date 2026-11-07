import {Box3,Color,Frustum,Group,InstancedMesh,Mesh,Vector3} from 'three';
import type {StreamPlacement} from './map-object-stream';

interface Cell {bounds:Box3;indices:number[];meshes:InstancedMesh[];primary:boolean;active:boolean}
/** Immutable instance buffers: switching cells never compacts or uploads matrices. */
export class MapCachedCells {
  private readonly cells:Cell[]=[];
  private readonly color=new Color();
  constructor(private readonly parent:Group,parts:Mesh[],placements:StreamPlacement[],readonly size:number){
    const grid=new Map<string,number[]>();
    placements.forEach((p,i)=>{const key=`${Math.floor(p.position.x/size)},${Math.floor(p.position.z/size)}`;
      const indices=grid.get(key)??[];indices.push(i);grid.set(key,indices);});
    const painted=placements.some(p=>p.paintColor!==undefined);
    for(const [key,indices] of grid){
      const bounds=new Box3(),meshes:InstancedMesh[]=[];
      for(const part of parts){
        if(!part.geometry.boundingBox)part.geometry.computeBoundingBox();
        const mesh=new InstancedMesh(part.geometry,part.material,indices.length);
        mesh.name=`${part.name} / cached cell ${key}`;mesh.renderOrder=part.renderOrder;
        mesh.castShadow=part.castShadow;mesh.receiveShadow=part.receiveShadow;mesh.layers.mask=part.layers.mask;
        mesh.userData={...part.userData,cachedMapCell:true};mesh.matrixAutoUpdate=false;mesh.visible=false;
        indices.forEach((index,slot)=>{
          mesh.setMatrixAt(slot,placements[index].matrix);
          if(painted)mesh.setColorAt(slot,this.color.setHex(placements[index].paintColor??0xffffff));
          bounds.union(part.geometry.boundingBox!.clone().applyMatrix4(placements[index].matrix));
        });
        mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
        mesh.computeBoundingBox();mesh.computeBoundingSphere();parent.add(mesh);meshes.push(mesh);
      }
      this.cells.push({bounds,indices,meshes,primary:false,active:false});
    }
  }
  update(focus:Vector3,range:number,frustum:Frustum|undefined,shadowRange:number,inspect:boolean,hidden:boolean){
    let changed=false;
    for(const cell of this.cells){
      const b=cell.bounds;
      const distance=Math.hypot(Math.max(b.min.x-focus.x,0,focus.x-b.max.x),Math.max(b.min.z-focus.z,0,focus.z-b.max.z));
      const nearby=distance<=range;
      const primary=!hidden&&nearby&&(inspect||!frustum||frustum.intersectsBox(b));
      const reserve=!hidden&&nearby&&shadowRange>0&&distance<=shadowRange;
      const active=primary||reserve;
      if(cell.primary!==primary||cell.active!==active)changed=true;
      cell.primary=primary;cell.active=active;
      for(const mesh of cell.meshes){
        mesh.visible=active;mesh.userData.streamAuxiliary=!primary;
        // Cached GPU buffers remain owned here. Off cells must also leave Three's
        // scene traversal/matrix updates, not merely skip their final draw calls.
        if(active){if(mesh.parent!==this.parent)this.parent.add(mesh);}else mesh.removeFromParent();
      }
    }
    return changed;
  }
  hide(){for(const cell of this.cells){cell.primary=cell.active=false;for(const mesh of cell.meshes){mesh.visible=false;mesh.removeFromParent();}}}
  get cellCount(){return this.cells.length;}
  get batchCount(){return this.cells.reduce((n,c)=>n+c.meshes.length,0);}
  get visibleCells(){return this.cells.filter(c=>c.primary).length;}
  get visibleInstances(){return this.cells.reduce((n,c)=>n+(c.primary?c.indices.length:0),0);}
  get auxiliaryInstances(){return this.cells.reduce((n,c)=>n+(c.active&&!c.primary?c.indices.length:0),0);}
  get instanceBytes(){return this.cells.reduce((n,c)=>n+c.meshes.reduce((n,m)=>n+m.instanceMatrix.array.byteLength+(m.instanceColor?.array.byteLength??0),0),0);}
  dispose(){for(const cell of this.cells)for(const mesh of cell.meshes){mesh.visible=false;mesh.removeFromParent();mesh.dispose();}this.cells.length=0;}
}
