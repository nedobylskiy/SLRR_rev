import {allocateMapPlacementIds,setMapPlacementIds} from './map-placement-ids';
import {CpuWorkProfile} from '../runtime/cpu-work-profile';
import {GlobalFacadeBatches} from './global-facade-batches';
import {MapCachedCells} from './map-cached-cells';
import { Box3, Color, Frustum, Group, InstancedMesh, Matrix4, Mesh, Sphere, Texture, Vector3, type Camera } from 'three';
import { MapMaterialPool } from './map-material-pool';
import { splitMapGeometry } from './map-geometry-chunks';
import {mergeStaticMapParts} from './map-static-batches';
import {MapAutoLod} from './map-auto-lod';

export interface StreamPlacement { movable?:boolean; matrix: Matrix4; position: Vector3; paintColor?: number; radius?: number; bounds?: { minX: number; maxX: number; minZ: number; maxZ: number } }
function distanceTo(placement: StreamPlacement, camera: Vector3) {
  const b = placement.bounds;
  if (b) return Math.hypot(Math.max(b.minX - camera.x, 0, camera.x - b.maxX), Math.max(b.minZ - camera.z, 0, camera.z - b.maxZ));
  return Math.max(0, Math.hypot(placement.position.x - camera.x, placement.position.z - camera.z) - (placement.radius ?? 0));
}
export {isMapTreeAlias} from './map-object-category';
import {mapObjectCategories,type MapObjectCategory} from './map-object-category';

export interface MapStreamChanges {fromRevision:number;revision:number;full:boolean;meshes:readonly InstancedMesh[]}
interface StreamType {
  preload:boolean;
  globalCompiled?:boolean;
  cachedCells?:MapCachedCells;
  loadPromise?:Promise<void>;
  category?:MapObjectCategory;
  placements: StreamPlacement[];
  placementIds:number[];
  shadowSelection?:Set<number>;
  cachedShadowRevision?:number;
  load: (wanted: () => boolean) => Promise<Mesh[]>;
  priority: number;
  meshes?: InstancedMesh[];
  baseMeshes?:InstancedMesh[];
  chunkMeshes?:InstancedMesh[];
  mergedMeshes?:InstancedMesh[];
  lodMeshes:Map<InstancedMesh,InstancedMesh>;
  farSlots:Set<number>;
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
  readonly workProfile=new CpuWorkProfile();
  revision = 0;
  shadowRevision=0;
  private occlusionDirty=new Set<InstancedMesh>();
  private occlusionFull=true;
  private occlusionConsumedRevision=0;
  consumeOcclusionChanges():MapStreamChanges{
    const changes={fromRevision:this.occlusionConsumedRevision,revision:this.revision,full:this.occlusionFull,meshes:[...this.occlusionDirty]};
    this.occlusionDirty.clear();this.occlusionFull=false;this.occlusionConsumedRevision=this.revision;return changes;
  }
  private invalidateOcclusion(){this.occlusionFull=true;this.revision++;this.shadowRevision++;}
  private markOcclusion=(mesh:InstancedMesh)=>{this.occlusionDirty.add(mesh);};
  /** Cooperative limit between whole model groups; Infinity retains synchronous tooling/tests. */
  frameBudgetMs=Infinity;
  private readonly scanQueue=new Set<StreamType>();
  private readonly drawQueue=new Set<StreamType>();
  get hasPendingWork(){return this.scanQueue.size>0||this.drawQueue.size>0;}
  get queueInfo(){return `budget ${Number.isFinite(this.frameBudgetMs)?this.frameBudgetMs+' ms':'unlimited'} · scan queue ${this.scanQueue.size} · draw queue ${this.drawQueue.size}`;}
  private types: StreamType[] = [];
  private placementTypes=new WeakMap<StreamPlacement,{type:StreamType;index:number}>();
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
  private mergeStatic=false;
  private autoLod=false;
  private tightFrustum=true;
  private materialSharing=true;
  private readonly hiddenCategories=new Set<MapObjectCategory>();
  setCategoryHidden(category:MapObjectCategory,hidden:boolean){
    if(hidden)this.hiddenCategories.add(category);else this.hiddenCategories.delete(category);
    this.viewDirty=true;
  }
  setTreesHidden(hidden:boolean){this.setCategoryHidden('trees',hidden);}
  get treeInfo(){return mapObjectCategories.map(category=>`${category}: ${this.hiddenCategories.has(category)?'hidden':'shown'} (resident ${this.types.filter(t=>t.category===category).reduce((n,t)=>n+(this.useCached(t)?t.placements.length:t.active.length),0)})`).join(' · ');}
  private cachedCellsEnabled=false;
  private cachedCellSize=128;
  private cellPreparation?:Promise<void>;
  private cellGeneration=0;
  async setCachedCells(enabled:boolean,size=this.cachedCellSize){
    if(size!==64&&size!==128)throw Error('Cached map cell size must be 64 or 128 m');
    if(size!==this.cachedCellSize){this.cellGeneration++;for(const t of this.types){t.cachedCells?.dispose();t.cachedCells=undefined;}}
    this.cachedCellSize=size;this.cachedCellsEnabled=enabled;
    if(!enabled)for(const t of this.types){t.cachedCells?.hide();t.meshDrawn.clear();t.boundsDirty=true;}
    this.dirty=this.viewDirty=true;this.invalidateOcclusion();
    if(enabled)await this.prepareCachedCells();
  }
  async prepareCachedCells(){
    // Serialize preparation and share original geometry/material ownership.
    if(this.cellPreparation){await this.cellPreparation;if(!this.cachedCellsEnabled||this.disposed)return;}
    if(!this.cachedCellsEnabled||this.disposed)return;
    const generation=this.cellGeneration,size=this.cachedCellSize;
    const queue=this.types.filter(t=>t.category&&!t.cachedCells&&!t.placements.some(p=>p.movable));
    const prepare=async()=>{
      for(;;){const type=queue.shift();if(!type||this.disposed||!this.cachedCellsEnabled||generation!==this.cellGeneration)return;
        if(!type.baseMeshes&&!type.failed)await (type.loadPromise??this.load(type,true));
        if(this.disposed||!this.cachedCellsEnabled||generation!==this.cellGeneration)return;
        if(type.baseMeshes&&!type.cachedCells){type.cachedCells=new MapCachedCells(this.parent,type.baseMeshes,type.placements,size,type.placementIds);this.viewDirty=true;this.invalidateOcclusion();}
      }
    };
    const work=Promise.all(Array.from({length:4},prepare)).then(()=>{});this.cellPreparation=work;
    try{await work;}finally{if(this.cellPreparation===work)this.cellPreparation=undefined;}
  }
  async preparePinnedModels(){
    const queue=this.types.filter(t=>t.preload&&!t.meshes&&!t.failed);
    await Promise.all(Array.from({length:4},async()=>{
      for(;;){const type=queue.shift();if(!type||this.disposed)return;await (type.loadPromise??this.load(type));}
    }));
  }
  private globalFacades?:GlobalFacadeBatches;
  compileGlobalFacades(){
    if(this.disposed||this.globalFacades)return;
    this.globalFacades=new GlobalFacadeBatches(this.parent,this.types.filter(t=>t.preload).flatMap(t=>(t.baseMeshes??[]).map(mesh=>({mesh,placements:t.placements}))));
    for(const type of this.types){
      type.globalCompiled=!!type.baseMeshes?.length&&type.baseMeshes.every(m=>m.userData.globalFacadeSource);
      for(const mesh of type.baseMeshes??[])if(mesh.userData.globalFacadeSource){
        const proxy=type.auxiliary.get(mesh),lod=type.lodMeshes.get(mesh);
        if(proxy){proxy.visible=false;proxy.removeFromParent();}if(lod){lod.visible=false;lod.removeFromParent();}
      }
      if(type.globalCompiled){type.pending=[];type.drawn=[];type.candidates=[];type.primaryVisible=0;this.prepareBatches.delete(type);this.prepareChunks.delete(type);}
      type.boundsDirty=true;
    }
    this.dirty=this.viewDirty=true;this.invalidateOcclusion();
  }
  get globalFacadeInfo(){const g=this.globalFacades;return `Global facade batches: ${g?'on':'off'}${g?` · source parts ${g.sources.size} / copies ${g.sourceCopies} → batches ${g.meshes.length} · visible ${g.visibleBatches} · ${g.triangles.toLocaleString('en-US')} triangles cached · buffers ${(g.geometryBytes/1048576).toFixed(1)} MiB · uncombined sources ${g.skippedSources}`:''}`;}
  private useCached(type:StreamType){return this.cachedCellsEnabled&&!!type.category&&!!type.cachedCells;}
  get cachedCellInfo(){const caches=this.types.flatMap(t=>t.cachedCells?[t.cachedCells]:[]);return `Precached object cells: ${this.cachedCellsEnabled?'on':'off'} · ${this.cachedCellSize} m · ${this.cellPreparation?'preparing':'ready'} · cells ${caches.reduce((n,c)=>n+c.cellCount,0)} · visible ${this.cachedCellsEnabled?caches.reduce((n,c)=>n+c.visibleCells,0):0} · cached batches ${caches.reduce((n,c)=>n+c.batchCount,0)} · instance buffers ${(caches.reduce((n,c)=>n+c.instanceBytes,0)/1048576).toFixed(1)} MiB`;}
  setMaterialSharing(enabled:boolean){this.materialSharing=enabled;}
  setTightFrustum(enabled:boolean){this.tightFrustum=enabled;this.viewDirty=true;}
  private prepareBatches=new Set<StreamType>();
  private readonly lod=new MapAutoLod(()=>{this.viewDirty=true;});
  setStaticBatching(enabled:boolean){
    this.mergeStatic=enabled;
    for(const type of this.types)if(type.baseMeshes){
      if(enabled&&!type.mergedMeshes)this.prepareBatches.add(type);else this.selectMeshes(type);
    }
    this.viewDirty=true;
  }
  setAutoLod(enabled:boolean){this.autoLod=enabled;this.viewDirty=true;}
  get optimizationInfo(){const prepared=this.types.filter(t=>t.mergedMeshes);return `Per-part frustum: ${this.tightFrustum?'on':'off'}; Static batching: ${this.mergeStatic?'on':'off'}${this.geometryCutoff?' (paused by geometry cutoff)':''} · ${this.prepareBatches.size} models queued · prepared parts ${prepared.reduce((n,t)=>n+(t.baseMeshes?.length??0),0)} → ${prepared.reduce((n,t)=>n+t.mergedMeshes!.length,0)}; Auto LOD ${this.autoLod?'on (far 200 m / near 160 m)':'off'} · ${this.lod.info}`;}
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
  constructor(private readonly parent: Group, private distance = 500, readonly budget = 48,private readonly clock=()=>performance.now()) {}

  setRange(value: number) {
    if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid map stream range');
    this.distance = value; this.dirty = this.viewDirty = true;
  }

  setShadowRange(value: number) {
    if(value!==this.shadowRange)this.shadowRevision++;
    this.shadowRange = value; this.viewDirty = true;
  }

  add(placements: StreamPlacement[], load: (wanted: () => boolean) => Promise<Mesh[]>, category:MapObjectCategory|boolean=false,preload=false) {
    const type:StreamType={ placementIds:allocateMapPlacementIds(placements.length),preload, category:category===true?'trees':category===false?undefined:category, placements, load, priority: Infinity, loading: false, failed: false, active: [], slots: new Map(), pending: [], boundsDirty: false,
      drawn: [], candidates: [], instanceBounds: new Map(), primaryVisible:0,meshDrawn:new Map(),auxiliary:new Map(),chunkBounds:new Map(),lodMeshes:new Map(),farSlots:new Set() };
    this.types.push(type);placements.forEach((placement,index)=>this.placementTypes.set(placement,{type,index}));
    this.dirty = true;
  }

  /** A moved prop invalidates its small model batch, not the city's static buffers. */
  placementsMoved(placements:readonly StreamPlacement[]){
    const affected=new Set<StreamType>();
    for(const placement of placements){const entry=this.placementTypes.get(placement);if(entry){entry.type.instanceBounds.delete(entry.index);affected.add(entry.type);}}
    for(const type of affected){type.meshDrawn.clear();type.chunkBounds.clear();type.boundsDirty=true;this.drawQueue.add(type);this.scanQueue.add(type);}
    if([...affected].some(type=>!type.placements.every(p=>p.movable)))this.shadowRevision++;
    this.viewDirty=true;
  }

  update(camera: Vector3, view?: Camera,continuation=false) {
    if (this.disposed) return;
    const started=this.clock(),deadline=started+this.frameBudgetMs;
    const profile=this.workProfile;let stamp=profile.start();profile.add("updates_count");
    if(continuation)profile.add("continuation_updates_count");
    if(!continuation){
    const pending=this.prepareBatches.values().next().value;
    if(pending&&this.mergeStatic&&!this.geometryCutoff){
      this.prepareBatches.delete(pending);
      if(pending.baseMeshes){
        pending.mergedMeshes=mergeStaticMapParts(pending.baseMeshes).map(part=>{
          if(part instanceof InstancedMesh)return part;
          const mesh=new InstancedMesh(part.geometry,part.material,pending.placements.length);
          mesh.name=part.name;mesh.renderOrder=part.renderOrder;mesh.castShadow=part.castShadow;mesh.receiveShadow=part.receiveShadow;
          mesh.userData={...part.userData};mesh.layers.mask=part.layers.mask;mesh.matrixAutoUpdate=false;mesh.count=0;mesh.visible=false;
          if(pending.placements.some(p=>p.paintColor!==undefined))mesh.setColorAt(0,this.instanceColor.setHex(0xffffff));
          return mesh;
        });this.selectMeshes(pending);
      }
    }
    const next=this.prepareChunks.values().next().value;
    if(next){this.prepareChunks.delete(next);if(next.meshes&&this.geometryCutoff)this.selectMeshes(next);}
    profile.end("prepare_geometry_ms",stamp);stamp=profile.start();
    const cell = `${Math.floor(camera.x / 25)},${Math.floor(camera.z / 25)}`;
    if (cell !== this.lastCell || this.dirty) {
      profile.add("residency_scans_count");
      this.lastCell = cell; this.dirty = false;
      for(const type of this.types)this.scanQueue.add(type);
    }
    }
    // Do not restart queued jobs on camera changes: each group uses the latest focus.
    let scans=0;
    const scanDeadline=started+this.frameBudgetMs*.35;
    for(const type of this.scanQueue){
      if(scans&&this.clock()>=scanDeadline)break;
      this.scanQueue.delete(type);this.scanType(type,camera);scans++;
    }
    if(scans)this.ordered=this.types.filter(t=>!t.globalCompiled).sort((a,b)=>a.priority-b.priority);
    profile.add('scan_groups_processed_count',scans);
    profile.end("residency_scan_sort_ms",stamp);stamp=profile.start();
    if(!continuation){
    const ordered = this.ordered;
    let available = 4 - this.types.filter(type => type.loading).length;
    for (const type of ordered) if (available > 0 && type.pending.length && !type.meshes && !type.loading && !type.failed) {
      profile.add("loads_started_count");this.load(type); available--;
    }
    for (const type of this.types) {
      if (type.preload || this.scanQueue.has(type) || this.cachedCellsEnabled&&type.category || type.active.length || type.pending.length || type.loading) type.unusedSince = undefined;
      else if (type.meshes) {
        type.unusedSince ??= performance.now();
        if (performance.now() - type.unusedSince > 5000) this.release(type);
      }
    }
    profile.end("dispatch_disposal_ms",stamp);stamp=profile.start();
    let remaining = this.budget;
    for (const type of ordered) {
      if (!type.meshes||type.globalCompiled||this.useCached(type)) continue;
      while (remaining && type.pending.length) {
        const index = type.pending.shift()!;
        if (type.slots.has(index)) continue;
        const slot = type.active.length;
        type.active.push(index); type.slots.set(index, slot);
        type.boundsDirty = true;
        profile.add("placements_activated_count");remaining--;
      }
      if (!remaining) break;
    }
    profile.end("activate_ms",stamp);stamp=profile.start();
    }
    let viewChanged = this.viewDirty || this.hadView !== !!view || !this.lastFocus.equals(camera);
    if (view) {
      view.updateWorldMatrix(true, false); this.parent.updateWorldMatrix(true, false);
      this.projection.multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse).multiply(this.parent.matrixWorld);
      viewChanged ||= !this.projection.equals(this.lastProjection);
      if(!continuation)this.lastProjection.copy(this.projection);
      this.frustum.setFromProjectionMatrix(this.projection);
    }
    if(!continuation){this.hadView = !!view; this.lastFocus.copy(camera); this.viewDirty = false;}
    profile.end("view_frustum_ms",stamp);stamp=profile.start();
    // Residency and rendering are independent: keep nearby off-screen instances
    // in RAM, but submit only the visible ones, even for a city-wide model type.
    for(const type of this.types)if(type.meshes&&(!continuation&&viewChanged||type.boundsDirty))this.drawQueue.add(type);
    let drawn=0;
    for(const type of this.drawQueue){
      if(drawn&&this.clock()>=deadline)break;
      this.drawQueue.delete(type);if(!type.meshes)continue;
      this.draw(type,camera,!!view);drawn++;
    }
    profile.add('draw_groups_processed_count',drawn);
    profile.add('scan_queue_remaining_count',this.scanQueue.size);profile.add('draw_queue_remaining_count',this.drawQueue.size);
    if(this.hasPendingWork)profile.add('budget_yields_count');
    profile.end("draw_batches_ms",stamp);stamp=profile.start();
    if(!continuation&&this.globalFacades&&(viewChanged||this.dirty)&&this.globalFacades.update(view&&!this.inspectResident?this.frustum:undefined,camera,this.shadowRange,this.markOcclusion))this.revision++;
    profile.end("global_facades_ms",stamp);
  }

  private scanType(type:StreamType,camera:Vector3){
    if(type.globalCompiled||this.useCached(type)){type.pending=[];return;}
    this.workProfile.add('residency_distance_tests_count',type.active.length+type.placements.length);
    for(let slot=type.active.length-1;slot>=0;slot--)if(distanceTo(type.placements[type.active[slot]],camera)>this.distance+100)this.remove(type,slot);
    const nearby:{index:number;distance:number}[]=[];
    for(let index=0;index<type.placements.length;index++){
      const distance=distanceTo(type.placements[index],camera);
      if(distance<=this.distance&&!type.slots.has(index))nearby.push({index,distance});
    }
    nearby.sort((a,b)=>a.distance-b.distance);type.pending=nearby.map(v=>v.index);type.priority=nearby[0]?.distance??Infinity;
  }

  private updateShadowSelection(type:StreamType,indices:readonly number[]){
    const previous=type.shadowSelection;
    if(previous&&previous.size===indices.length&&indices.every(index=>previous.has(index)))return;
    type.shadowSelection=new Set(indices);
    if(previous?.size||indices.length){this.shadowRevision++;this.workProfile.add('shadow_invalidations_count');}
  }

  private draw(type: StreamType, focus: Vector3, cull: boolean) {
    const profile=this.workProfile;const selectStart=profile.start();profile.add("types_drawn_count");
    if(type.globalCompiled){
      for(const mesh of [...type.meshes!,...type.auxiliary.values(),...type.lodMeshes.values()]){mesh.visible=false;mesh.removeFromParent();}
      type.boundsDirty=false;return;
    }
    if(this.useCached(type)){
      for(const mesh of [...type.meshes!,...type.lodMeshes.values(),...type.auxiliary.values()])mesh.visible=false;
      const cache=type.cachedCells!;
      const cachedStart=profile.start();
      if(cache.update(focus,this.distance,cull?this.frustum:undefined,this.shadowRange,this.inspectResident,!!type.category&&this.hiddenCategories.has(type.category),this.markOcclusion))this.revision++;
      profile.end("cached_cells_ms",cachedStart);
      if(type.cachedShadowRevision!==cache.shadowRevision){type.cachedShadowRevision=cache.shadowRevision;this.shadowRevision++;profile.add('shadow_invalidations_count');}
      type.primaryVisible=cache.visibleInstances;type.boundsDirty=false;return;
    }
    type.cachedCells?.hide();
    const visible = type.candidates; visible.length = 0;
    const auxiliary:number[]=[];
    type.primaryVisible=0;
    profile.add("visibility_placements_count",type.active.length);
    for (const index of type.active) {
      if(type.category&&this.hiddenCategories.has(type.category))continue;
      let primary=distanceTo(type.placements[index], focus)<=this.distance;
      if (primary && cull) {
        let bounds = type.instanceBounds.get(index);
        if (!bounds) { bounds = type.localBounds!.clone().applyMatrix4(type.placements[index].matrix); type.instanceBounds.set(index, bounds); }
        if (!this.frustum.intersectsSphere(bounds)) primary=false;
      }
      if(primary)type.primaryVisible++;
      if(this.autoLod){const distance=distanceTo(type.placements[index],focus);
        if(distance>200)type.farSlots.add(index);else if(distance<160)type.farSlots.delete(index);}
      if(this.shadowRange>0&&distanceTo(type.placements[index],focus)<=Math.min(this.distance,this.shadowRange))auxiliary.push(index);
      if(!primary&&!this.inspectResident)continue;
      visible.push(index);
    }
    const casts=type.meshes!.some(mesh=>mesh.userData.staticMapCaster??mesh.castShadow);
    this.updateShadowSelection(type,casts?auxiliary:[]);
    let changed=visible.length !== type.drawn.length || visible.some((index, slot) => type.drawn[slot] !== index);
    profile.end("placement_visibility_ms",selectStart);
    for (const mesh of type.meshes!) {
      if(mesh.userData.globalFacadeSource){mesh.visible=false;mesh.removeFromParent();continue;}
      const partStart=profile.start();profile.add("parts_selected_count");
      let selected=visible;
      let extra=auxiliary;
      if(this.tightFrustum&&cull&&!this.inspectResident&&!this.geometryCutoff){
        if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();
        const cache=type.chunkBounds.get(mesh)??new Map<number,Box3>();type.chunkBounds.set(mesh,cache);
        selected=visible.filter(index=>{
          let box=cache.get(index);
          if(!box){box=mesh.geometry.boundingBox!.clone().applyMatrix4(type.placements[index].matrix);cache.set(index,box);}
          return this.frustum.intersectsBox(box);
        });
      }
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
      const batches:[InstancedMesh,number[]][]=[];
      const material=Array.isArray(mesh.material)?undefined:mesh.material;
      const lodGeometry=this.autoLod&&!this.geometryCutoff&&!this.inspectResident&&!mesh.userData.mergedStatic
        &&material&&!material.transparent&&!material.alphaTest?this.lod.get(mesh.geometry):undefined;
      let lodMesh=type.lodMeshes.get(mesh);
      if(lodGeometry&&!lodMesh){
        lodMesh=new InstancedMesh(lodGeometry,mesh.material,type.placements.length);
        lodMesh.name=`${mesh.name} / generated LOD`;lodMesh.renderOrder=mesh.renderOrder;lodMesh.castShadow=mesh.castShadow;lodMesh.receiveShadow=mesh.receiveShadow;
        lodMesh.userData.staticMapCaster=mesh.userData.staticMapCaster;lodMesh.userData.mapOcclusionRole=mesh.userData.mapOcclusionRole;lodMesh.matrixAutoUpdate=false;lodMesh.visible=false;lodMesh.count=0;
        if(mesh.instanceColor)lodMesh.setColorAt(0,this.instanceColor.setHex(0xffffff));
        type.lodMeshes.set(mesh,lodMesh);this.parent.add(lodMesh);
        const release=()=>{lodMesh!.removeFromParent();lodMesh!.dispose();type.meshDrawn.delete(lodMesh!);type.lodMeshes.delete(mesh);mesh.removeEventListener('dispose',release);};
        mesh.addEventListener('dispose',release);
      }
      if(lodMesh){
        const far=lodGeometry?selected.filter(i=>type.farSlots.has(i)):[];
        if(far.length){const farSet=new Set(far);selected=selected.filter(i=>!farSet.has(i));}
        batches.push([lodMesh,far]);
      }
      batches.push([mesh,selected]);
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
      profile.end("part_selection_ms",partStart);
      for(const [batch,indices] of batches){
        const previous=type.meshDrawn.get(batch);
        if(!previous||indices.length!==previous.length||indices.some((index,slot)=>previous[slot]!==index)){
          const packStart=profile.start();
          setMapPlacementIds(batch,indices.map(index=>type.placementIds[index]));profile.add("batches_repacked_count");profile.add("matrices_written_count",indices.length);
          changed=true;
          for (let slot = 0; slot < indices.length; slot++) {
            const placement = type.placements[indices[slot]];
            batch.setMatrixAt(slot, placement.matrix);
            if (batch.instanceColor) batch.setColorAt(slot, this.instanceColor.setHex(placement.paintColor ?? 0xffffff));
          }
          if (batch.instanceColor) batch.instanceColor.needsUpdate = true;
          this.markOcclusion(batch);
          batch.count = indices.length; batch.instanceMatrix.needsUpdate = true;
          // setMatrixAt/count do not invalidate Three's cached aggregate sphere.
          profile.end("matrix_packing_ms",packStart);const sphereStart=profile.start();
          batch.computeBoundingSphere();profile.end("bounding_spheres_ms",sphereStart); batch.visible = batch.count > 0;
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

  private load(type: StreamType,precache=false):Promise<void> {
    type.loading = true;
    const wanted = () => !this.disposed && (type.preload || precache&&this.cachedCellsEnabled || type.pending.length > 0 || type.active.length > 0);
    const work=type.load(wanted).then(parts => this.workProfile.measure("async_finalize_ms",()=>{
      this.workProfile.add("loads_completed_count");
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
      if(this.materialSharing)this.materials.acquire(parts);
      type.localBounds = new Sphere().makeEmpty();
      type.meshes = parts.map(part => {
        if (!part.geometry.boundingSphere) part.geometry.computeBoundingSphere();
        type.localBounds!.union(part.geometry.boundingSphere!);
        const mesh = new InstancedMesh(part.geometry, part.material, type.placements.length);
        mesh.name = part.name; mesh.renderOrder = part.renderOrder;
        mesh.castShadow = part.castShadow; mesh.receiveShadow = part.receiveShadow;
        mesh.userData.staticMapCaster=part.userData.staticMapCaster;mesh.userData.mapOcclusionRole=part.userData.mapOcclusionRole;
        if (type.placements.some(placement => placement.paintColor !== undefined)) mesh.setColorAt(0, this.instanceColor.setHex(0xffffff));
        mesh.count = 0; mesh.visible = false;
        // Placements are baked into instance matrices; these map batches have no
        // per-frame local transform to compose.
        mesh.matrixAutoUpdate = false;
        this.parent.add(mesh); return mesh;
      });
      type.baseMeshes=type.meshes;
      if(this.mergeStatic)this.prepareBatches.add(type);
      if(this.geometryCutoff)this.prepareChunks.add(type);
      type.loading = false;
      // Pending placements already describe the current focus. Completing one
      // model must not rescan the entire city index on the next frame.
    })).catch(error => { type.loading = false; type.failed = true; this.dirty = true; console.warn('Map object stream:', error); }).finally(()=>{type.loadPromise=undefined;});
    type.loadPromise=work;return work;
  }

  private selectMeshes(type:StreamType){
    if(type.globalCompiled||!type.baseMeshes)return;
    if(this.geometryCutoff&&!type.chunkMeshes)type.chunkMeshes=type.baseMeshes.flatMap(base=>{
      const geometries=splitMapGeometry(base.geometry);
      if(geometries.length===1&&geometries[0]===base.geometry)return [base];
      return geometries.map((geometry,index)=>{
        const mesh=new InstancedMesh(geometry,base.material,type.placements.length);
        mesh.name=`${base.name} / chunk ${index}`;mesh.renderOrder=base.renderOrder;
        mesh.castShadow=base.castShadow;mesh.receiveShadow=base.receiveShadow;mesh.matrixAutoUpdate=false;
        mesh.userData.mapChunk=true;mesh.userData.globalFacadeSource=base.userData.globalFacadeSource;mesh.count=0;mesh.visible=false;
        mesh.userData.staticMapCaster=base.userData.staticMapCaster;mesh.userData.mapOcclusionRole=base.userData.mapOcclusionRole;
        if(base.instanceColor)mesh.setColorAt(0,this.instanceColor.setHex(0xffffff));return mesh;
      });
    });
    const selected=this.geometryCutoff?type.chunkMeshes!:this.mergeStatic&&type.mergedMeshes?type.mergedMeshes:type.baseMeshes;
    const retained=new Set(selected);
    for(const mesh of type.meshes??[])if(!retained.has(mesh)){
      mesh.removeFromParent();mesh.dispose();
    }
    type.meshes=selected;for(const mesh of selected)this.parent.add(mesh);
    type.meshDrawn.clear();type.boundsDirty=true;this.invalidateOcclusion();
  }

  get active() { return this.types.reduce((sum, type) => sum + (this.useCached(type)?type.placements.length:type.active.length), 0); }
  get visible() { return this.types.reduce((sum, type) => sum + (this.useCached(type)?type.cachedCells!.visibleInstances:type.drawn.length), 0); }
  get primaryVisible() { return this.types.reduce((sum,type)=>sum+type.primaryVisible,0); }
  get auxiliaryVisible(){return this.types.reduce((sum,type)=>sum+(this.useCached(type)?type.cachedCells!.auxiliaryInstances:[...type.auxiliary.values()].reduce((n,m)=>n+m.count,0)),0);}
  get total() { return this.types.reduce((sum, type) => sum + type.placements.length, 0); }
  private release(type: StreamType) {
    this.scanQueue.delete(type);this.drawQueue.delete(type);
    if (type.meshes?.length) this.invalidateOcclusion();
    type.cachedCells?.dispose();type.cachedCells=undefined;
    const geometries = new Set(), materials = new Set(), textures = new Set<Texture>();
    this.prepareChunks.delete(type);
    this.prepareBatches.delete(type);
    for (const mesh of new Set([...(type.baseMeshes??[]),...(type.chunkMeshes??[]),...(type.mergedMeshes??[]),...(type.meshes??[])])) {
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
    type.baseMeshes=type.chunkMeshes=type.mergedMeshes=undefined;type.shadowSelection=undefined;type.cachedShadowRevision=undefined;type.meshDrawn.clear();type.chunkBounds.clear();type.farSlots.clear();
    type.drawn.length = type.candidates.length = 0; type.instanceBounds.clear();
  }
  dispose() { this.disposed = true;this.occlusionDirty.clear();this.scanQueue.clear();this.drawQueue.clear(); this.globalFacades?.dispose();this.globalFacades=undefined;for (const type of this.types) this.release(type);this.lod.dispose(); this.types = []; this.ordered = []; }
}
