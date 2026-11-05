import { Box3, Color, Frustum, Group, InstancedMesh, Matrix4, Mesh, Sphere, Texture, Vector3, type Camera } from 'three';
import { MapMaterialPool } from './map-material-pool';
import { splitMapGeometry } from './map-geometry-chunks';

export interface StreamPlacement { matrix: Matrix4; position: Vector3; paintColor?: number; radius?: number; bounds?: { minX: number; maxX: number; minZ: number; maxZ: number } }
function distanceTo(placement: StreamPlacement, camera: Vector3) {
  const b = placement.bounds;
  if (b) return Math.hypot(Math.max(b.minX - camera.x, 0, camera.x - b.maxX), Math.max(b.minZ - camera.z, 0, camera.z - b.maxZ));
  return Math.max(0, Math.hypot(placement.position.x - camera.x, placement.position.z - camera.z) - (placement.radius ?? 0));
}
interface StreamType {
  placements: StreamPlacement[];
  load: (wanted: () => boolean) => Promise<Mesh[]>;
  priority: number;
  meshes?: InstancedMesh[];
  baseMeshes?:InstancedMesh[];
  chunkMeshes?:InstancedMesh[];
  meshDrawn:Map<InstancedMesh,number[]>;
  auxiliary:Map<InstancedMesh,InstancedMesh>;
  chunkBounds:Map<InstancedMesh,Map<number,Box3>>;
  loading: boolean;
  failed: boolean;
  active: number[];
  slots: Map<number, number>;
  pending: number[];
  boundsDirty: boolean;
  drawn: number[];
  candidates: number[];
  localBounds?: Sphere;
  instanceBounds: Map<number, Sphere>;
  primaryVisible: number;
  unusedSince?: number;
}

/** Keeps map-object geometry near the camera and uploads a bounded number of new instances per frame. */
export class MapObjectStream {
  revision = 0;
  private types: StreamType[] = [];
  private ordered: StreamType[] = [];
  private lastCell = '';
  private dirty = true;
  private disposed = false;
  private readonly frustum = new Frustum();
  private readonly projection = new Matrix4();
  private readonly lastProjection = new Matrix4();
  private readonly lastFocus = new Vector3(Infinity, Infinity, Infinity);
  private hadView = false;
  private viewDirty = true;
  private shadowRange = 0;
  private readonly instanceColor = new Color();
  private readonly materials = new MapMaterialPool();
  private inspectResident=false;
  private geometryCutoff=false;
  private prepareChunks=new Set<StreamType>();
  setGeometryCutoff(enabled:boolean){
    this.geometryCutoff=enabled;this.prepareChunks.clear();
    for(const type of this.types)if(type.meshes){
      if(enabled&&!type.chunkMeshes)this.prepareChunks.add(type);
      else this.selectMeshes(type);
    }
    this.viewDirty=true;
  }
  get chunkInfo(){return `Geometry cutoff: ${this.geometryCutoff?'on':'off'} · 64 m cells · preparation queue ${this.prepareChunks.size} · chunk batches ${this.types.reduce((n,t)=>n+(t.chunkMeshes?.filter(m=>m.userData.mapChunk).length??0),0)}`;}
  setInspectResident(enabled:boolean){this.inspectResident=enabled;this.viewDirty=true;}
  constructor(private readonly parent: Group, private distance = 500, readonly budget = 48) {}

  setRange(value: number) {
    if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid map stream range');
    this.distance = value; this.dirty = this.viewDirty = true;
  }

  setShadowRange(value: number) {
    this.shadowRange = value; this.viewDirty = true;
  }

  add(placements: StreamPlacement[], load: (wanted: () => boolean) => Promise<Mesh[]>) {
    this.types.push({ placements, load, priority: Infinity, loading: false, failed: false, active: [], slots: new Map(), pending: [], boundsDirty: false,
      drawn: [], candidates: [], instanceBounds: new Map(), primaryVisible:0,meshDrawn:new Map(),auxiliary:new Map(),chunkBounds:new Map() });
    this.dirty = true;
  }

  update(camera: Vector3, view?: Camera) {
    if (this.disposed) return;
    const next=this.prepareChunks.values().next().value;
    if(next){this.prepareChunks.delete(next);if(next.meshes&&this.geometryCutoff)this.selectMeshes(next);}
    const cell = `${Math.floor(camera.x / 25)},${Math.floor(camera.z / 25)}`;
    if (cell !== this.lastCell || this.dirty) {
      this.lastCell = cell; this.dirty = false;
      for (const type of this.types) {
        for (let slot = type.active.length - 1; slot >= 0; slot--) {
          const index = type.active[slot];
          if (distanceTo(type.placements[index], camera) > this.distance + 100) this.remove(type, slot);
        }
        const nearby: { index: number; distance: number }[] = [];
        for (let index = 0; index < type.placements.length; index++) {
          const distance = distanceTo(type.placements[index], camera);
          if (distance <= this.distance && !type.slots.has(index)) nearby.push({ index, distance });
        }
        nearby.sort((a, b) => a.distance - b.distance);
        type.pending = nearby.map(v => v.index);
        type.priority = nearby[0]?.distance ?? Infinity;
      }
      this.ordered = [...this.types].sort((a, b) => a.priority - b.priority);
    }
    const ordered = this.ordered;
    let available = 4 - this.types.filter(type => type.loading).length;
    for (const type of ordered) if (available > 0 && type.pending.length && !type.meshes && !type.loading && !type.failed) {
      this.load(type); available--;
    }
    for (const type of this.types) {
      if (type.active.length || type.pending.length || type.loading) type.unusedSince = undefined;
      else if (type.meshes) {
        type.unusedSince ??= performance.now();
        if (performance.now() - type.unusedSince > 5000) this.release(type);
      }
    }
    let remaining = this.budget;
    for (const type of ordered) {
      if (!type.meshes) continue;
      while (remaining && type.pending.length) {
        const index = type.pending.shift()!;
        if (type.slots.has(index)) continue;
        const slot = type.active.length;
        type.active.push(index); type.slots.set(index, slot);
        type.boundsDirty = true;
        remaining--;
      }
      if (!remaining) break;
    }
    let viewChanged = this.viewDirty || this.hadView !== !!view || !this.lastFocus.equals(camera);
    if (view) {
      view.updateWorldMatrix(true, false); this.parent.updateWorldMatrix(true, false);
      this.projection.multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse).multiply(this.parent.matrixWorld);
      viewChanged ||= !this.projection.equals(this.lastProjection);
      this.lastProjection.copy(this.projection);
      this.frustum.setFromProjectionMatrix(this.projection);
    }
    this.hadView = !!view; this.lastFocus.copy(camera); this.viewDirty = false;
    // Residency and rendering are independent: keep nearby off-screen instances
    // in RAM, but submit only the visible ones, even for a city-wide model type.
    for (const type of this.types) if (type.meshes && (viewChanged || type.boundsDirty)) this.draw(type, camera, !!view);
  }

  private draw(type: StreamType, focus: Vector3, cull: boolean) {
    const visible = type.candidates; visible.length = 0;
    const auxiliary:number[]=[];
    type.primaryVisible=0;
    for (const index of type.active) {
      let primary=distanceTo(type.placements[index], focus)<=this.distance;
      if (primary && cull) {
        let bounds = type.instanceBounds.get(index);
        if (!bounds) { bounds = type.localBounds!.clone().applyMatrix4(type.placements[index].matrix); type.instanceBounds.set(index, bounds); }
        if (!this.frustum.intersectsSphere(bounds)) primary=false;
      }
      if(primary)type.primaryVisible++;
      if(this.shadowRange>0&&distanceTo(type.placements[index],focus)<=Math.min(this.distance,this.shadowRange))auxiliary.push(index);
      if(!primary&&!this.inspectResident)continue;
      visible.push(index);
    }
    let changed=visible.length !== type.drawn.length || visible.some((index, slot) => type.drawn[slot] !== index);
    for (const mesh of type.meshes!) {
      let selected=visible;
      let extra=auxiliary;
      if(this.geometryCutoff&&!this.inspectResident){
        if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();
        const cache=type.chunkBounds.get(mesh)??new Map<number,Box3>();type.chunkBounds.set(mesh,cache);
        const accepts=(index:number,shadow:boolean)=>{
          let box=cache.get(index);
          if(!box){box=mesh.geometry.boundingBox!.clone().applyMatrix4(type.placements[index].matrix);cache.set(index,box);}
          const distance=Math.hypot(Math.max(box.min.x-focus.x,0,focus.x-box.max.x),Math.max(box.min.z-focus.z,0,focus.z-box.max.z));
          return distance<=this.distance&&(shadow?distance<=this.shadowRange:!cull||this.frustum.intersectsBox(box));
        };
        selected=visible.filter(index=>accepts(index,false));
        extra=auxiliary.filter(index=>accepts(index,true));
      }
      if(extra.length){const mainSet=new Set(selected);extra=extra.filter(index=>!mainSet.has(index));}
      const batches:[InstancedMesh,number[]][]=[[mesh,selected]];
      let proxy=type.auxiliary.get(mesh);
      if(extra.length&&!proxy){
        proxy=new InstancedMesh(mesh.geometry,mesh.material,type.placements.length);
        proxy.name=`${mesh.name} / auxiliary casters`;proxy.renderOrder=mesh.renderOrder;
        proxy.castShadow=mesh.castShadow;proxy.receiveShadow=mesh.receiveShadow;proxy.matrixAutoUpdate=false;
        proxy.userData.streamAuxiliary=true;proxy.count=0;proxy.visible=false;
        proxy.userData.staticMapCaster=mesh.userData.staticMapCaster;
        if(mesh.instanceColor)proxy.setColorAt(0,this.instanceColor.setHex(0xffffff));
        type.auxiliary.set(mesh,proxy);this.parent.add(proxy);
        const release=()=>{proxy!.removeFromParent();proxy!.dispose();type.meshDrawn.delete(proxy!);type.auxiliary.delete(mesh);mesh.removeEventListener('dispose',release);};
        mesh.addEventListener('dispose',release);
      }
      if(proxy)batches.push([proxy,extra]);
      for(const [batch,indices] of batches){
        const previous=type.meshDrawn.get(batch);
        if(!previous||indices.length!==previous.length||indices.some((index,slot)=>previous[slot]!==index)){
          changed=true;
          for (let slot = 0; slot < indices.length; slot++) {
            const placement = type.placements[indices[slot]];
            batch.setMatrixAt(slot, placement.matrix);
            if (batch.instanceColor) batch.setColorAt(slot, this.instanceColor.setHex(placement.paintColor ?? 0xffffff));
          }
          if (batch.instanceColor) batch.instanceColor.needsUpdate = true;
          batch.count = indices.length; batch.instanceMatrix.needsUpdate = true;
          // setMatrixAt/count do not invalidate Three's cached aggregate sphere.
          batch.computeBoundingSphere(); batch.visible = batch.count > 0;
          type.meshDrawn.set(batch,[...indices]);
        }
      }
    }
    if(changed)this.revision++;
    const old = type.drawn; type.drawn = visible; type.candidates = old;
    type.boundsDirty = false;
  }

  private remove(type: StreamType, slot: number) {
    const index = type.active[slot], last = type.active.pop()!;
    type.slots.delete(index);
    if (slot < type.active.length) {
      type.active[slot] = last; type.slots.set(last, slot);
    }
    type.boundsDirty = true;
  }

  private load(type: StreamType) {
    type.loading = true;
    const wanted = () => !this.disposed && (type.pending.length > 0 || type.active.length > 0);
    void type.load(wanted).then(parts => {
      type.loading = false;
      if (!wanted()) {
        const textures = new Set<Texture>();
        for (const part of parts) {
          part.geometry.dispose();
          for (const material of Array.isArray(part.material) ? part.material : [part.material]) {
            const map = 'map' in material ? material.map : undefined;
            if (map instanceof Texture) textures.add(map);
            if (material.userData.bakedLightmapTexture instanceof Texture) textures.add(material.userData.bakedLightmapTexture);
            material.dispose();
          }
        }
        for (const texture of textures) texture.dispose();
        return;
      }
      if (!parts.length) { this.dirty = true; return; }
      this.materials.acquire(parts);
      type.localBounds = new Sphere().makeEmpty();
      type.meshes = parts.map(part => {
        if (!part.geometry.boundingSphere) part.geometry.computeBoundingSphere();
        type.localBounds!.union(part.geometry.boundingSphere!);
        const mesh = new InstancedMesh(part.geometry, part.material, type.placements.length);
        mesh.name = part.name; mesh.renderOrder = part.renderOrder;
        mesh.castShadow = part.castShadow; mesh.receiveShadow = part.receiveShadow;
        mesh.userData.staticMapCaster=part.userData.staticMapCaster;
        if (type.placements.some(placement => placement.paintColor !== undefined)) mesh.setColorAt(0, this.instanceColor.setHex(0xffffff));
        mesh.count = 0; mesh.visible = false;
        // Placements are baked into instance matrices; these map batches have no
        // per-frame local transform to compose.
        mesh.matrixAutoUpdate = false;
        this.parent.add(mesh); return mesh;
      });
      type.baseMeshes=type.meshes;
      if(this.geometryCutoff)this.prepareChunks.add(type);
      type.loading = false;
      // Pending placements already describe the current focus. Completing one
      // model must not rescan the entire city index on the next frame.
    }).catch(error => { type.loading = false; type.failed = true; this.dirty = true; console.warn('Map object stream:', error); });
  }

  private selectMeshes(type:StreamType){
    if(!type.baseMeshes)return;
    if(this.geometryCutoff&&!type.chunkMeshes)type.chunkMeshes=type.baseMeshes.flatMap(base=>{
      const geometries=splitMapGeometry(base.geometry);
      if(geometries.length===1&&geometries[0]===base.geometry)return [base];
      return geometries.map((geometry,index)=>{
        const mesh=new InstancedMesh(geometry,base.material,type.placements.length);
        mesh.name=`${base.name} / chunk ${index}`;mesh.renderOrder=base.renderOrder;
        mesh.castShadow=base.castShadow;mesh.receiveShadow=base.receiveShadow;mesh.matrixAutoUpdate=false;
        mesh.userData.mapChunk=true;mesh.count=0;mesh.visible=false;
        mesh.userData.staticMapCaster=base.userData.staticMapCaster;
        if(base.instanceColor)mesh.setColorAt(0,this.instanceColor.setHex(0xffffff));return mesh;
      });
    });
    const selected=this.geometryCutoff?type.chunkMeshes!:type.baseMeshes;
    const retained=new Set(selected);
    for(const mesh of type.meshes??[])if(!retained.has(mesh)){
      mesh.removeFromParent();mesh.geometry.dispose();mesh.dispose();
    }
    type.meshes=selected;for(const mesh of selected)this.parent.add(mesh);
    type.meshDrawn.clear();type.boundsDirty=true;this.revision++;
  }

  get active() { return this.types.reduce((sum, type) => sum + type.active.length, 0); }
  get visible() { return this.types.reduce((sum, type) => sum + type.drawn.length, 0); }
  get primaryVisible() { return this.types.reduce((sum,type)=>sum+type.primaryVisible,0); }
  get auxiliaryVisible(){return this.types.reduce((sum,type)=>sum+[...type.auxiliary.values()].reduce((n,m)=>n+m.count,0),0);}
  get total() { return this.types.reduce((sum, type) => sum + type.placements.length, 0); }
  private release(type: StreamType) {
    if (type.meshes?.length) this.revision++;
    const geometries = new Set(), materials = new Set(), textures = new Set<Texture>();
    this.prepareChunks.delete(type);
    for (const mesh of new Set([...(type.baseMeshes??[]),...(type.chunkMeshes??[]),...(type.meshes??[])])) {
      mesh.removeFromParent(); mesh.dispose(); geometries.add(mesh.geometry);
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
    }
    for (const material of materials as Set<import('three').Material>) {
      if (this.materials.release(material)) continue;
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
      if (material.userData.bakedLightmapTexture instanceof Texture) textures.add(material.userData.bakedLightmapTexture);
      material.dispose();
    }
    for (const geometry of geometries as Set<import('three').BufferGeometry>) geometry.dispose();
    for (const texture of textures) texture.dispose();
    type.meshes = undefined; type.unusedSince = undefined; type.localBounds = undefined;
    type.baseMeshes=type.chunkMeshes=undefined;type.meshDrawn.clear();type.chunkBounds.clear();
    type.drawn.length = type.candidates.length = 0; type.instanceBounds.clear();
  }
  dispose() { this.disposed = true; for (const type of this.types) this.release(type); this.types = []; this.ordered = []; }
}
