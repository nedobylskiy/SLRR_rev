import {allocateMapPlacementIds,setMapPlacementIds} from './map-placement-ids';
import {Color,InstancedMesh,Matrix4,MeshStandardMaterial,Vector3,type Group,type BufferGeometry,type Frustum} from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {StreamPlacement} from './map-object-stream';
export interface FacadeSource {mesh:InstancedMesh;placements:StreamPlacement[]}
interface Pending {material:MeshStandardMaterial;source:InstancedMesh;geometries:BufferGeometry[];vertices:number}
/** One-time expansion by material across model/instance boundaries. No runtime instance compaction. */
export class GlobalFacadeBatches {
  readonly meshes:InstancedMesh[]=[];
  readonly sources=new Set<InstancedMesh>();
  sourceCopies=0;triangles=0;geometryBytes=0;skippedSources=0;
  constructor(private readonly parent:Group,sources:FacadeSource[],vertexLimit=250000,totalVertexLimit=4000000){
    const pending=new Map<string,Pending>(),color=new Color();let totalVertices=0;
    const flush=(entry:Pending)=>{
      if(!entry.geometries.length)return;
      const geometry=mergeGeometries(entry.geometries,false);
      for(const g of entry.geometries)g.dispose();entry.geometries=[];entry.vertices=0;
      if(!geometry)throw Error('Global facade geometry layouts differ');
      geometry.computeBoundingBox();geometry.computeBoundingSphere();
      const mesh=new InstancedMesh(geometry,entry.material,1);mesh.setMatrixAt(0,new Matrix4());mesh.instanceMatrix.needsUpdate=true;
      mesh.name=`Global facades / material ${entry.material.uuid.slice(0,8)} / batch ${this.meshes.length}`;
      mesh.matrixAutoUpdate=false;mesh.castShadow=entry.source.castShadow;mesh.receiveShadow=entry.source.receiveShadow;
      mesh.layers.mask=entry.source.layers.mask;mesh.renderOrder=entry.source.renderOrder;
      mesh.userData={staticMapCaster:entry.source.userData.staticMapCaster,globalFacadeBatch:true,mapOcclusionRole:'structure'};
      setMapPlacementIds(mesh,allocateMapPlacementIds(1));
      mesh.visible=false;mesh.computeBoundingBox();mesh.computeBoundingSphere();this.meshes.push(mesh);
      this.triangles+=(geometry.index?.count??geometry.getAttribute('position').count)/3;
      this.geometryBytes+=Object.values(geometry.attributes).reduce((n,a)=>n+a.array.byteLength,0)+(geometry.index?.array.byteLength??0);
    };
    try{
      for(const {mesh,placements} of sources){
        const material=mesh.material;
        if(!(material instanceof MeshStandardMaterial)||!material.userData.slrrUnifiedBuilding||!placements.length||!mesh.geometry.getAttribute('slrrBuildingPaintTint'))continue;
        const vertices=mesh.geometry.getAttribute('position').count;
        if(vertices>vertexLimit||totalVertices+vertices*placements.length>totalVertexLimit){this.skippedSources++;continue;}
        const key=JSON.stringify([material.userData.slrrBuildingTexture.uuid,material.customProgramCacheKey(),material.side,material.shadowSide,
          material.roughness,material.metalness,material.depthTest,material.depthWrite,material.blending,material.polygonOffset,material.polygonOffsetFactor,material.polygonOffsetUnits,
          mesh.layers.mask,mesh.renderOrder,mesh.castShadow,mesh.receiveShadow,mesh.userData.staticMapCaster,Object.keys(mesh.geometry.attributes).sort(),!!mesh.geometry.index]);
        let entry=pending.get(key);if(!entry){entry={material,source:mesh,geometries:[],vertices:0};pending.set(key,entry);}
        const palette=placements.some(p=>p.paintColor!==undefined);
        for(const placement of placements){
          if(entry.vertices+vertices>vertexLimit)flush(entry);
          const geometry=mesh.geometry.clone();geometry.applyMatrix4(placement.matrix);
          if(palette){color.setHex(placement.paintColor??0xffffff);const tint=geometry.getAttribute('slrrBuildingPaintTint');
            for(let i=0;i<tint.count;i++)tint.setXYZ(i,color.r,color.g,color.b);}
          entry.geometries.push(geometry);entry.vertices+=vertices;totalVertices+=vertices;this.sourceCopies++;
        }
        this.sources.add(mesh);
      }
      for(const entry of pending.values())flush(entry);
      for(const source of this.sources){source.userData.globalFacadeSource=true;source.visible=false;source.removeFromParent();}
    }catch(error){for(const entry of pending.values())for(const g of entry.geometries)g.dispose();this.dispose();throw error;}
  }
  update(frustum?:Frustum,focus?:Vector3,shadowRange=0,onChange?:(mesh:InstancedMesh)=>void){
    let changed=false;
    for(const mesh of this.meshes){
      const box=mesh.geometry.boundingBox!,primary=!frustum||frustum.intersectsBox(box);
      const distance=focus?Math.hypot(Math.max(box.min.x-focus.x,0,focus.x-box.max.x),Math.max(box.min.z-focus.z,0,focus.z-box.max.z)):Infinity;
      const visible=primary||shadowRange>0&&distance<=shadowRange;
      if(mesh.visible!==visible||mesh.userData.streamAuxiliary!==!primary){changed=true;onChange?.(mesh);}
      mesh.userData.streamAuxiliary=!primary;
      if(mesh.visible!==visible)changed=true;mesh.visible=visible;
      if(visible){if(mesh.parent!==this.parent)this.parent.add(mesh);}else mesh.removeFromParent();}
    return changed;
  }
  get visibleBatches(){return this.meshes.filter(m=>m.visible&&!m.userData.streamAuxiliary).length;}
  dispose(){for(const mesh of this.meshes){mesh.removeFromParent();mesh.geometry.dispose();mesh.dispose();}this.meshes.length=0;
    for(const source of this.sources)delete source.userData.globalFacadeSource;this.sources.clear();}
}
