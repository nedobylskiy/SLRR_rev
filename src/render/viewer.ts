import {DEFAULT_DRIVING_HELPING,type DrivingHelping} from '../engine/driving-helping';
import {parseScxAsync} from '../formats/scx-worker-client';
import {DRIVING_PHYSICS_HZ,XPBD_ITERATIONS} from '../engine/physics-timing';
import {planBuildingBatches,isBuildingAlias,configureBuildingArrayMaterial} from './building-material-batch';
import {BuildingTextureArrays} from './building-texture-array';
import * as THREE from 'three';
import { previewMaterial } from './preview-material';
import { ptxTexture } from './ptx-texture';
import { AssetTextureSources, TextureSourceCache } from './texture-source-cache';
import { GraphicsDiagnostics } from './graphics-diagnostics';
import { InspectionCamera } from './inspection-camera';
import { MapDistanceCutoff } from './map-distance-cutoff';
import { MapBackfaceCulling } from './map-backface-culling';
import { MapRaycastOcclusion } from './map-raycast-occlusion';
import {MapGpuOcclusion} from './map-gpu-occlusion';
import { diffuseTextureIndex } from './diffuse-texture';
import { StaticMapShadows } from './static-map-shadows';
import { bakedLightmapUvs, configureBakedLightmap, stockGarageLightmap } from './baked-lightmap';
import { partPaint, partPaintTextures, type PartPaint } from './part-paint';
import { normalizePath } from '../assets';
import { cfgRenderVisible, applyCfgRenderChannels, drivingLightMask, isNightTime, configureCfgLampEmission } from './vehicle-lights';
import { createVehicleFlare } from './vehicle-flare';
import { createVehicleBeam, createHeadlightCameraFlare } from './vehicle-beam';
import { linkedRenderPose } from '../engine/linked-render';
import { selectLinkedRule } from '../engine/linked-slots';
import { defaultSuspensionDebug, suspensionDebugMatrix, suspensionCorner, debugRotation, rearArmAdjustment, type SuspensionDebugSettings } from './suspension-debug';
import { configureVehicleMaterial, type VehicleReflectionUniforms } from './vehicle-material';
import { VehicleReflections } from './vehicle-reflections';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DDSLoader } from 'three/addons/loaders/DDSLoader.js';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
import type { ScxModel, ScxMesh } from '../formats/scx';
import type { Assets } from '../assets';
import { scxDiffuseUsesAlpha, scxUsesVertexPaintMask } from '../formats/scx';
import { poseMatrix, type EnginePart, type EngineWorld } from '../engine/world';
import { modelMatrix } from '../engine/model-transform';
import { loadPartCollision } from '../engine/part-collision';
import { DrivingDemo } from '../engine/driving-demo';
import type { DrivingInput } from '../engine/driving-demo';
import { HoodLab } from './hood-lab';
import type { PartDefinition } from '../engine/world';
import { previewScope } from '../runtime/preview-scope';
import { CarCrashDemo } from '../engine/car-crash-demo';
import { PanelView } from './panel-view';
import { Vehicle3D } from '../engine/vehicle-3d';
import {RoutePlayback,RouteCheckpoints,routeBodyMatrix,routeSourceSummary,type RouteBenchmark,type RouteCamera,type RoutePose,type RouteMode} from '../engine/route-benchmark';
import type {DriveTelemetry} from '../engine/drive-telemetry';
import { groundRenderDefinition, groundRenderHasChildren, groundRenderIsRoom, isStockMapCollisionShell, mapRenderIds } from '../engine/map';
import { entryProperties } from '../formats/rpk';
import { MapTerrain } from '../engine/map-terrain';
import { MapCollision } from '../engine/map-collision';
import { mapObjectPlacements, mapObjectSeed, mapRenderResource, isNightMapRenderResource, parseIcfg } from '../engine/map-objects';
import { textureAlphaMode } from './texture-alpha';
import { stockContainerTexture } from './stock-container-texture';
import {mapObjectCategory,type MapObjectCategory} from './map-object-category';
import { MapObjectStream, type StreamPlacement } from './map-object-stream';
import { MapDebugView, type MapDebugLayer } from './map-debug-view';
import { TireEffects } from './tire-effects';
import { VehicleAudio } from '../audio/vehicle-audio';
import { RenderObject } from '../runtime/render-object';
import type { RenderLightSettings, RenderFlareSource } from '../runtime/render-ref-native';
import type { EnvironmentMapSource } from './environment-map';
import { FrameProfiler } from './frame-profiler';
import { SceneLighting } from './scene-lighting';
import { FollowCamera } from './follow-camera';
import { InertialCamera } from './inertial-camera';
import { createResourceLight, parseResourceLight, type ResourceLight } from './resource-light';
import type { JavaSceneCamera } from '../runtime/java-scene-camera';

export interface MapFogSettings { color: number; near: number; far: number }
const DEFAULT_MAP_FOG: MapFogSettings = { color: 0x8295a3, near: 260, far: 900 };
function transmissionCondition(part?: EnginePart) {
  if (!part) return 1;
  let total = 0, count = 0;
  const visit = (node: EnginePart) => { total += node.condition; count++; for (const child of node.children.values()) visit(child); };
  visit(part);
  return count ? total / count : 1;
}

const partRenderPose = (part: EnginePart) => part.renderAdjustment.clone().multiply(part.definition.config.renderPose ? poseMatrix(part.definition.config.renderPose) : new THREE.Matrix4());
function bindLinkedRender(group: THREE.Group, links: number[] | undefined, model: ScxModel, pose?: import('../formats/cfg').CfgPose, rules?: number[][]) {
  if (!links?.length) return;
  const bounds = new THREE.Box3(), renderPose = pose ? poseMatrix(pose) : new THREE.Matrix4();
  const point = new THREE.Vector3();
  for (const mesh of model.meshes) for (let i = 0; i < mesh.positions.length; i += 3)
    bounds.expandByPoint(point.fromArray(mesh.positions, i).multiplyScalar(0.01).applyMatrix4(renderPose));
  const meshBounds = new THREE.Box3();
  for (const mesh of model.meshes) for (let i = 0; i < mesh.positions.length; i += 3)
    meshBounds.expandByPoint(point.fromArray(mesh.positions, i));
  group.userData.linkedRender = { links, rules: rules ?? [links], bounds, renderPose, baseMatrix: group.matrix.clone(), meshCenter: meshBounds.getCenter(new THREE.Vector3()) };
}
function syncLinkedRenders(part: EnginePart, group: THREE.Group, debug?: SuspensionDebugSettings) {
  for (const child of group.children) {
    const binding = child.userData.linkedRender;
    if (!binding) continue;
    const links = selectLinkedRule(part, binding.rules);
    const pose = links && linkedRenderPose(part, links, binding.bounds);
    if (!pose) { child.matrix.copy(binding.baseMatrix); child.matrixWorldNeedsUpdate = true; continue; }
    // Single-anchor additional renders are the control arms; the CV shaft has
    // two anchors and must retain its independent rotation controls.
    if (!links![1]) {
      child.matrix.makeScale(100, 100, 100).multiply(partRenderPose(part).invert())
        .multiply(pose).multiply(binding.renderPose).multiply(new THREE.Matrix4().makeScale(0.01, 0.01, 0.01));
      if (debug && (suspensionCorner(part) ?? -1) >= 2) {
        const center = binding.meshCenter;
        const adjustment = rearArmAdjustment(debug, suspensionCorner(part)!);
        child.matrix.multiply(new THREE.Matrix4().makeTranslation(...adjustment.offset.map(value => value * 100) as [number, number, number]))
          .multiply(new THREE.Matrix4().makeTranslation(center.x, center.y, center.z))
          .multiply(debugRotation(adjustment.rotation))
          .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
      }
      child.matrixWorldNeedsUpdate = true;
      continue;
    }
    if (debug && debug.rearShaftRotation.some(value => value !== 0) && (suspensionCorner(part) ?? -1) >= 2) {
      const center = binding.bounds.getCenter(new THREE.Vector3());
      pose.multiply(new THREE.Matrix4().makeTranslation(center.x, center.y, center.z))
        .multiply(debugRotation(debug.rearShaftRotation))
        .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
    }
    child.matrix.makeScale(100, 100, 100).multiply(partRenderPose(part).invert())
      .multiply(pose).multiply(binding.renderPose).multiply(new THREE.Matrix4().makeScale(0.01, 0.01, 0.01));
    child.matrixWorldNeedsUpdate = true;
  }
}

export class Viewer {
  /** Optional garage alignment override; normal Java setsteer resumes when cleared. */
  calibrationSteering?: number;
  private suspensionDebug = defaultSuspensionDebug();
  private suspensionDebugActive = false;
  private visualPartMatrix(part: EnginePart) {
    return this.suspensionDebugActive ? suspensionDebugMatrix(part, this.suspensionDebug) : part.matrix();
  }
  setSuspensionDebug(settings: SuspensionDebugSettings) {
    this.suspensionDebug = structuredClone(settings);
    this.suspensionDebugActive = Object.values(settings).some((values: number[]) => values.some(value => value !== 0));
    for (const [part, group] of this.proxies) {
      group.matrix.copy(modelMatrix(this.visualPartMatrix(part), partRenderPose(part)));
      group.matrixWorldNeedsUpdate = true;
      syncLinkedRenders(part, group, this.suspensionDebug);
    }
  }
  readonly profiler: FrameProfiler;
  private performanceContext?:()=>string[];
  setPerformanceContext(read?:()=>string[]){this.performanceContext=read;}
  private readonly graphicsDiagnostics:GraphicsDiagnostics;
  private readonly inspection:InspectionCamera;
  private readonly rayOcclusion:MapRaycastOcclusion;
  private readonly gpuOcclusion:MapGpuOcclusion;
  setGpuOcclusionDebug(mode:string){this.gpuOcclusion.debugMode=mode;}
  setGpuOcclusionApply(enabled:boolean){this.gpuOcclusion.applyResults=enabled;}
  setGpuOcclusionFreeze(frozen:boolean){this.gpuOcclusion.freeze=frozen;}
  setGpuOcclusionInterval(frames:number){if(Number.isInteger(frames)&&frames>=1&&frames<=12)this.gpuOcclusion.intervalFrames=frames;}
  setGpuOcclusionEnabled(enabled:boolean){this.gpuOcclusion.setEnabled(enabled);if(enabled)this.rayOcclusion.setEnabled(false);}
  setRaycastOcclusionEnabled(enabled:boolean){this.rayOcclusion.setEnabled(enabled);}
  setRaycastOcclusionBudget(ms:number){if(Number.isFinite(ms)&&ms>=.5&&ms<=8)this.rayOcclusion.budgetMs=ms;}
  private inspectResident=false;
  private inspectionManualOverride=false;
  private mapPackPath?:string;
  private collisionOnlyMapMeshes=0;
  private excludedNightMapVariants=0;
  private excludedNightMapInstances=0;
  private geometryCutoff=false;
  private staticBatching=false;
  private autoMapLod=false;
  private tightMapFrustum=true;
  private globalFacadeBatching=false;
  private mapGlobalFacadeBatching=false;
  setGlobalFacadeBatching(enabled:boolean){this.globalFacadeBatching=enabled;if(enabled)this.unifiedBuildingMaterials=true;}
  private unifiedBuildingMaterials=false;
  private mapUnifiedBuildingMaterials=false;
  private readonly unifiedBuildingOutputs=new Map<THREE.Material,{parts:number}>();
  private readonly buildingTextureArrays=new BuildingTextureArrays();
  setUnifiedBuildingMaterials(enabled:boolean){this.unifiedBuildingMaterials=enabled;}
  private unifyBuildingParts(parts:THREE.Mesh[],warnings:string[]){
    const plans=planBuildingBatches(parts),replaced=new Set<THREE.Mesh>(),outputs:THREE.Mesh[]=[];
    for(const plan of plans){
      let array:ReturnType<BuildingTextureArrays['acquire']>|undefined,material:THREE.MeshStandardMaterial|undefined;
      try{
        array=this.buildingTextureArrays.acquire(this.renderer,plan.materials);
        const source=plan.materials[0],first=plan.parts[0];
        material=new THREE.MeshStandardMaterial({color:0xffffff,roughness:source.roughness,metalness:source.metalness,
          side:THREE.DoubleSide,shadowSide:THREE.DoubleSide,depthTest:source.depthTest,depthWrite:source.depthWrite,
          blending:source.blending,polygonOffset:source.polygonOffset,polygonOffsetFactor:source.polygonOffsetFactor,polygonOffsetUnits:source.polygonOffsetUnits});
        this.lighting.configureMaterial(material,true,false);this.mapDistanceCutoff.configure(material);this.staticMapShadows.configure(material);
        this.mapBackfaces.configure(material,plan.geometry);configureBuildingArrayMaterial(material,array.texture);
        const mesh=new THREE.Mesh(plan.geometry,material);mesh.name=`${first.name} / unified ${plan.parts.length} parts`;
        mesh.castShadow=first.castShadow;mesh.receiveShadow=first.receiveShadow;mesh.renderOrder=first.renderOrder;mesh.layers.mask=first.layers.mask;
        mesh.userData={...first.userData,unifiedBuilding:true};outputs.push(mesh);for(const p of plan.parts)replaced.add(p);
        const owned=array,ownedMaterial=material;
        this.unifiedBuildingOutputs.set(material,{parts:plan.parts.length});
        material.addEventListener('dispose',()=>{owned.release();this.unifiedBuildingOutputs.delete(ownedMaterial);});
      }catch(error){array?.release();material?.dispose();plan.geometry.dispose();warnings.push(`Unified building ${plan.parts[0].name}: ${String(error)}`);}
    }
    const retained=parts.filter(p=>!replaced.has(p)),materials=new Set<THREE.Material>(),geometries=new Set<THREE.BufferGeometry>(),textures=new Set<THREE.Texture>();
    for(const part of replaced){geometries.add(part.geometry);for(const m of Array.isArray(part.material)?part.material:[part.material])materials.add(m);}
    const keptMaterials=new Set(retained.flatMap(p=>Array.isArray(p.material)?p.material:[p.material]));
    const keptTextures=new Set([...keptMaterials].flatMap(m=>[...Object.values(m),...Object.values(m.userData)].filter((v):v is THREE.Texture=>v instanceof THREE.Texture)));
    for(const geometry of geometries)if(!retained.some(p=>p.geometry===geometry))geometry.dispose();
    for(const m of materials)if(!keptMaterials.has(m)){
      for(const value of [...Object.values(m),...Object.values(m.userData)])if(value instanceof THREE.Texture&&!keptTextures.has(value))textures.add(value);
      m.dispose();
    }
    for(const texture of textures)texture.dispose();
    return [...retained,...outputs];
  }
  private precachedObjectCells=false;
  private objectCellSize=128;
  async setPrecachedObjectCells(enabled:boolean,size=128){
    this.precachedObjectCells=enabled;this.objectCellSize=size;
    this.rayOcclusion.reset();this.gpuOcclusion.reset();
    await this.mapStream?.setCachedCells(enabled,size);
    this.nextStreamUpdate=-Infinity;this.staticMapShadows.reset();this.vehicleReflections.reset();
  }
  private hideMapTrees=false;
  private readonly hiddenMapCategories=new Set<MapObjectCategory>();
  setMapObjectCategoryHidden(category:MapObjectCategory,hidden:boolean){
    if(hidden)this.hiddenMapCategories.add(category);else this.hiddenMapCategories.delete(category);
    this.mapStream?.setCategoryHidden(category,hidden);this.nextStreamUpdate=-Infinity;
    this.staticMapShadows.reset();this.vehicleReflections.reset();this.rayOcclusion.reset();this.gpuOcclusion.reset();
  }
  setMapTreesHidden(hidden:boolean){this.hideMapTrees=hidden;this.setMapObjectCategoryHidden('trees',hidden);}
  private sharedMapMaterials=true;
  private earlyMapCulling=true;
  setMapRenderProfile(optimized:boolean,tightFrustum=optimized){
    this.sharedMapMaterials=optimized;this.earlyMapCulling=optimized;this.setTightMapFrustumEnabled(tightFrustum);
  }
  setTightMapFrustumEnabled(enabled:boolean){this.tightMapFrustum=enabled;this.mapStream?.setTightFrustum(enabled);this.nextStreamUpdate=-Infinity;}
  setStaticBatchingEnabled(enabled:boolean){this.staticBatching=enabled;this.mapStream?.setStaticBatching(enabled);this.nextStreamUpdate=-Infinity;}
  setAutoMapLodEnabled(enabled:boolean){this.autoMapLod=enabled;this.mapStream?.setAutoLod(enabled);this.nextStreamUpdate=-Infinity;}
  private readonly mapDistanceCutoff=new MapDistanceCutoff();
  private readonly mapBackfaces=new MapBackfaceCulling();
  private streamThrottle=true;
  private streamIntervalMs=100;
  private nextStreamUpdate=-Infinity;
  private farPlaneEnabled=false;
  private normalCameraFar=1000;
  setFarPlaneEnabled(enabled:boolean){this.farPlaneEnabled=enabled;this.updateFarPlane();this.nextStreamUpdate=-Infinity;}
  private updateFarPlane(){
    const far=this.farPlaneEnabled&&this.mapStream?Math.max(this.camera.near+.001,Math.min(this.normalCameraFar,this.mapStreamRange)):this.normalCameraFar;
    if(this.camera.far!==far){this.camera.far=far;this.camera.updateProjectionMatrix();}
  }
  setStreamThrottleEnabled(enabled:boolean){this.streamThrottle=enabled;this.nextStreamUpdate=-Infinity;}
  setStreamIntervalMs(ms:number){
    if(!Number.isFinite(ms)||ms<0)return;
    this.streamIntervalMs=ms;this.nextStreamUpdate=-Infinity;
  }
  private updateMapStream(now:number){
    if(!this.mapStream)return;
    const continuation=this.streamThrottle&&now<this.nextStreamUpdate;
    if(continuation&&!this.mapStream.hasPendingWork)return;
    this.mapStream.update(this.mapStreamFocus??this.camera.position,this.camera,continuation);
    if(!continuation)this.nextStreamUpdate=now+this.streamIntervalMs;
  }
  setMapBackfaceCullingEnabled(enabled:boolean){this.mapBackfaces.setEnabled(enabled);}
  private experimentalHubGeometry = false;
  setExperimentalHubGeometry(enabled: boolean) {
    this.experimentalHubGeometry = enabled;
    for (const part of this.proxies.keys()) part.world.experimentalHubGeometry = enabled;
  }
  private updateCutoff(){this.mapDistanceCutoff.enabled.value=this.geometryCutoff&&!(this.inspection.enabled&&this.inspectResident)?1:0;}
  setGeometryCutoffEnabled(enabled:boolean){this.geometryCutoff=enabled;this.mapStream?.setGeometryCutoff(enabled);this.updateCutoff();}
  setGraphicsDiagnosticsEnabled(enabled:boolean){this.graphicsDiagnostics.enabled=enabled;this.profiler.setDetailedGpu(enabled);}
  setInspectionCameraEnabled(enabled:boolean){this.inspectionManualOverride=true;this.inspection.replay=false;this.inspection.setEnabled(enabled,this.controls.target);if(enabled){this.inspection.camera.far=this.normalCameraFar;this.inspection.camera.updateProjectionMatrix();}this.mapStream?.setInspectResident(enabled&&this.inspectResident);this.updateCutoff();}
  setInspectResidentEnabled(enabled:boolean){this.inspectResident=enabled;this.mapStream?.setInspectResident(this.inspection.enabled&&enabled);this.updateCutoff();}
  resetInspectionCamera(){this.inspection.reset(this.controls.target);this.inspection.camera.far=this.normalCameraFar;this.inspection.camera.updateProjectionMatrix();}
  graphicsDebugLines(){return [
    `FPS ${this.fps}`,
    `Detailed diagnostics: ${this.graphicsDiagnostics.enabled?'on':'off'} · displayed vehicles ${new Set([...this.proxies.keys()].map(p=>p.world)).size} · vehicle part proxies ${this.proxies.size}`,
    `Map: ${this.mapPackPath??'none'} · primary camera: ${this.camera.position.toArray().map(n=>n.toFixed(2)).join(', ')} · streaming focus: ${(this.mapStreamFocus??this.camera.position).toArray().map(n=>n.toFixed(2)).join(', ')}`,
    `Static environment: ${this.environmentPath??'none'}`,
    `Lighting ${this.lighting.dynamic.value?'on':'off'} · vertex colors ${this.lighting.vertexColors.value?'on':'off'} · dynamic shadows ${this.lighting.shadows?'on':'off'} · baked ${this.bakedLightmaps.value?'on':'off'} · brake helping ${this.drivingHelping.brake.toFixed(2)} · steer helping ${this.drivingHelping.steer.toFixed(2)} · clutch helping ${this.drivingHelping.clutch.toFixed(2)} · acceleration helping ${this.drivingHelping.acceleration.toFixed(2)} · ABS ${this.drivingHelping.abs.toFixed(2)} · headlights plain spots · shadow filter ${this.renderer.shadowMap.type===THREE.BasicShadowMap?'hard (night)':'soft'} ${this.sunLight.shadow.mapSize.x}² · reflections ${this.vehicleReflections.enabled?'on':'off'}`,
    `Unified building materials: ${this.mapUnifiedBuildingMaterials?'on':'off'}${this.unifiedBuildingMaterials!==this.mapUnifiedBuildingMaterials?' (reload map to apply selection)':''} · prepared parts ${[...this.unifiedBuildingOutputs.values()].reduce((n,v)=>n+v.parts,0)} → ${this.unifiedBuildingOutputs.size} · array storage ≈ ${(this.buildingTextureArrays.bytes/1048576).toFixed(1)} MiB (${this.buildingTextureArrays.count} shared arrays)`,
    `Map variants: daytime only · excluded night batches ${this.excludedNightMapVariants} · component instances ${this.excludedNightMapInstances}`,
    `Collision-only map meshes excluded from rendering: ${this.collisionOnlyMapMeshes}`,
    `Map back-face culling: ${this.mapBackfaces.enabled?'on':'off'} (opaque, consistent winding only; two-sided shadows)`,
    `Map render preparation: shared materials ${this.sharedMapMaterials?'on':'off'} · early main-pass culling ${this.earlyMapCulling?'on':'off'}`,
    `Experimental hub geometry: ${this.experimentalHubGeometry?'on':'off'} (pose only; supported independent arm/hub 0/-1; unsupported corners retain legacy pose)`,
    `Streamer updates: ${this.streamThrottle?`interval ${this.streamIntervalMs} ms`:'every frame'}`,
    `Far plane: ${this.farPlaneEnabled?'on':'off'} · primary camera far ${this.camera.far.toFixed(1)} m`,
    `Auxiliary map caster instances (excluded from main color): ${this.mapStream?.auxiliaryVisible??0}`,
    ...(this.mapStream?[this.mapStream.chunkInfo,this.mapStream.optimizationInfo,this.mapStream.treeInfo,this.mapStream.cachedCellInfo,this.mapStream.globalFacadeInfo]:[]),
    ...this.rayOcclusion.lines(),...this.gpuOcclusion.lines(),
    ...(this.inspection.enabled?[`Observer camera · streamer/culling still use primary camera`,
      `Observer position: ${this.inspection.camera.position.toArray().map(n=>n.toFixed(2)).join(', ')} · far ${this.inspection.camera.far.toFixed(1)} m`,
      `Primary submissions: ${this.mapStream?.primaryVisible??0} · observer batch: ${this.mapStream?.visible??0} · resident: ${this.mapStream?.active??0}`]:[]),
    ...this.graphicsDiagnostics.lines(this.scene),
    ...(this.physicsWork?[this.physicsWork]:[]),...this.performanceContext?.()??[]];}
  physicsWork = '';
  private frameDuration = 1000 / 60;
  private previousFrame?: number;
  get fps() { return Math.round(1000 / this.frameDuration); }
  get streamInfo() { return this.mapStream ? `Map instances: submitted ${this.mapStream.visible} · resident ${this.mapStream.active} · indexed ${this.mapStream.total} · ${this.mapStream.queueInfo}` : ''; }
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.01, 1000);
  private controls: OrbitControls;
  private model = new THREE.Group();
  private javaRenderRoot = new THREE.Group();
  private javaRenderNodes = new Map<number, THREE.Group>();
  private javaRenderModels = new Map<number, THREE.Group>();
  private javaSkyDomeNodes = new Map<number, { group: THREE.Group; offset: THREE.Vector3 }>();
  private javaRenderTypes = new Map<number, string>();
  private javaRenderRequests = new Map<number, number>();
  private javaRenderRevisions = new Map<number, number>();
  private javaRenderTemplates = new Map<string, Promise<THREE.Group>>();
  private javaRenderLights = new Map<number, { key: string; group: THREE.Group }>();
  private javaLightDefinitions = new Map<string, Promise<ResourceLight | null>>();
  private proxies = new Map<EnginePart, THREE.Group>();
  private internalView = false;
  private readonly vehicleReflections = new VehicleReflections();
  private readonly reflectionUniforms: VehicleReflectionUniforms = {
    environment: { value: null }, available: { value: 0 }, dynamic: { value: 0 },
  };
  setRealReflectionsEnabled(enabled: boolean) {
    this.vehicleReflections.enabled = enabled; this.reflectionUniforms.dynamic.value = enabled ? 1 : 0;
    if (!enabled) this.vehicleReflections.reset();
  }
  private inertialCameraEnabled = false;
  setInertialCameraEnabled(enabled: boolean) { this.inertialCameraEnabled = enabled; }
  private collisionMeshes = new Map<EnginePart, number[]>();
  private alphaModes = new Map<string, ReturnType<typeof textureAlphaMode>>();
  private skyFogUniforms = new Set<{ color: THREE.Color; enabled: { value: number } }>();
  private mapFogEnabled = true;
  private grid = new THREE.GridHelper(12, 24, 0x46515a, 0x222c34);
  private driveGrid = new THREE.GridHelper(2000, 1000, 0x798893, 0x45535b);
  private ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: 0x171f25, roughness: 1, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  private frame?: (now: number) => void;
  private afterFrame?:()=>void;
  private frameCapture?:{resolve:(blob:Blob)=>void;reject:(reason:Error)=>void};
  captureFrame(){return new Promise<Blob>((resolve,reject)=>{
    if(this.frameCapture){reject(Error('A frame capture is already pending'));return;}
    this.frameCapture={resolve,reject};
  });}
  private routeStatus?:string;
  private routeReferenceLines:string[]=[];
  private renderRecorder?:DriveTelemetry;
  benchmarkDebugLines(){
    const info=this.renderer.info.render,size=this.renderer.getDrawingBufferSize(new THREE.Vector2());
    return [this.routeStatus??'Route benchmark idle',`FPS ${this.fps}`,...this.routeReferenceLines,`Draw calls ${info.calls} · triangles ${info.triangles.toLocaleString('en-US')}`,
      `Drawing buffer ${size.x} × ${size.y}`, 'Java game loop / OSD: off · live counters refresh every 500 ms',...this.rayOcclusion.lines(),...this.gpuOcclusion.lines(),...(this.physicsWork?[this.physicsWork]:[]),...this.profiler.lines()];
  }
  private stopDriving?: () => void;
  private scriptCamera?: () => JavaSceneCamera | null;
  private scriptCameraId?: number;
  setJavaSceneCamera(reader?: () => JavaSceneCamera | null) {
    if (this.scriptCameraId !== undefined && !this.stopDriving) this.controls.enabled = true;
    this.scriptCamera = reader; this.scriptCameraId = undefined;
  }
  private generation = 0;
  private mapStream?: MapObjectStream;
  private mapTextures = new TextureSourceCache();
  private vehicleTextures = new AssetTextureSources();
  private mapStreamRange = 500;
  get streamRange() { return this.mapStreamRange; }
  setMapStreamRange(value: number) {
    if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid map stream range');
    this.mapStreamRange = value;
    this.mapStream?.setRange(value);
    this.updateFarPlane();this.nextStreamUpdate=-Infinity;
  }
  private mapStreamFocus?: THREE.Vector3;
  private mapDebug?: MapDebugView;
  private mapFog: MapFogSettings = { ...DEFAULT_MAP_FOG };
  private environmentTexture?: THREE.Texture;
  private environmentPath?:string;
  private environmentRevision = 0;
  private ambientLight = new THREE.HemisphereLight(0xe5efff, 0x47524b, 2.5);
  private sunLight = new THREE.DirectionalLight(0xffddb8, 3);
  private lighting = new SceneLighting();
  private drivingHelping:DrivingHelping={...DEFAULT_DRIVING_HELPING};
  setDrivingHelping(settings:DrivingHelping){
    for(const key of ['brake','steer','clutch','acceleration','abs'] as const){
      if(!Number.isFinite(settings[key])||settings[key]<0||settings[key]>1)throw Error('Driving helping must be between 0 and 1');
      this.drivingHelping[key]=settings[key];
    }
  }
  private bakedLightmaps = { value: 0 };
  private staticMapShadows = new StaticMapShadows();
  private staticMapRoot?: THREE.Group;
  setBakedLightmapsEnabled(enabled: boolean) {
    this.bakedLightmaps.value = this.staticMapShadows.enabled.value = enabled ? 1 : 0;
    this.mapStream?.setShadowRange(enabled ? 150 : 0);
  }
  setShadowMapsEnabled(enabled: boolean) {
    this.lighting.shadows = enabled;
    this.renderer.shadowMap.enabled = enabled;
    this.sunLight.castShadow = enabled;
    this.mapStream?.setShadowRange(this.bakedLightmaps.value ? 150 : 0);
    this.scene.traverse(object => {
      if (object instanceof THREE.Mesh) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => { material.needsUpdate = true; });
      }
    });
  }
  setDynamicLightingEnabled(enabled: boolean) { this.lighting.dynamic.value = enabled ? 1 : 0; }
  setVertexColorsEnabled(enabled: boolean) { this.lighting.vertexColors.value = enabled ? 1 : 0; }
  private sunFlare?: Lensflare;
  private sunFlareTexture?: THREE.Texture;
  private sunFlareRevision = 0;
  private observer: ResizeObserver;
  getViewportSize(): { width: number; height: number } {
    return { width: this.container.clientWidth || this.renderer.domElement.clientWidth || 1,
      height: this.container.clientHeight || this.renderer.domElement.clientHeight || 1 };
  }
  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.profiler = new FrameProfiler(this.renderer);
    this.graphicsDiagnostics=new GraphicsDiagnostics(this.renderer,this.profiler);
    this.rayOcclusion=new MapRaycastOcclusion(this.renderer);
    this.gpuOcclusion=new MapGpuOcclusion(this.renderer);
    this.mapBackfaces.setEnabled(true);
    this.setBakedLightmapsEnabled(true);
    this.setShadowMapsEnabled(true);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x11171c);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.lighting.configureSun(this.sunLight);
    this.lighting.configureMaterial(this.ground.material);
    this.ground.receiveShadow = true;
    container.append(this.renderer.domElement);
    this.camera.position.set(4, 3, 6);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.inspection=new InspectionCamera(container,this.camera);this.scene.add(this.inspection.helpers);
    this.scene.add(this.ambientLight);
    this.sunLight.position.set(3, 5, 4); this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);
    this.scene.add(this.grid);
    this.driveGrid.visible = false; this.scene.add(this.driveGrid);
    this.ground.rotation.x = -Math.PI / 2; this.ground.position.y = -0.002; this.ground.visible = false; this.scene.add(this.ground);
    this.scene.add(this.model);
    this.scene.add(this.javaRenderRoot);
    this.observer = new ResizeObserver(() => {
      const { clientWidth: w, clientHeight: h } = container;
      this.renderer.setSize(w, h); this.camera.aspect = w / Math.max(h, 1); this.camera.updateProjectionMatrix();
    }); this.observer.observe(container);
    this.renderer.setAnimationLoop(now => {
      this.profiler.captureCpuFrame=!!this.renderRecorder?.status.recording;
      this.mapStream?.workProfile.setEnabled(this.profiler.captureCpuFrame);
      this.gpuOcclusion.workProfile.setEnabled(this.profiler.captureCpuFrame);
      this.profiler.beginFrame(now);
      try {
      this.profiler.measure('GPU occlusion CPU',()=>this.gpuOcclusion.beginFrame());
      if (document.hidden) this.previousFrame = undefined;
      if (this.previousFrame !== undefined && now > this.previousFrame) {
        this.profiler.recordFrame(now - this.previousFrame);
        this.frameDuration += ((now - this.previousFrame) - this.frameDuration) * 0.1;
      }
      this.previousFrame = document.hidden ? undefined : now;
      this.graphicsDiagnostics.beginFrame();
      this.profiler.measure('Simulation + vehicle visuals', () => this.frame?.(now));
      const scriptCamera = !this.stopDriving ? this.scriptCamera?.() : null;
      if (scriptCamera) {
        const factor = this.scriptCameraId !== scriptCamera.id || !scriptCamera.smoothing ? 1
          : 1 - Math.exp(-Math.min(this.frameDuration, 100) / 1000 / scriptCamera.smoothing);
        this.scriptCameraId = scriptCamera.id;
        this.controls.enabled = false;
        this.camera.position.lerp(scriptCamera.position, factor);
        this.controls.target.lerp(scriptCamera.target, factor);
        this.camera.lookAt(this.controls.target);
        this.camera.fov = scriptCamera.fov; this.camera.near = scriptCamera.near; this.normalCameraFar = scriptCamera.far;
        this.updateFarPlane();
        this.camera.updateProjectionMatrix();
      } else {
        if (this.scriptCameraId !== undefined) { this.scriptCameraId = undefined; if (!this.stopDriving) this.controls.enabled = true; }
        if (this.controls.enabled) this.controls.update();
      }
      this.updateFarPlane();
      this.mapDistanceCutoff.focus.value.copy(this.mapStreamFocus??this.camera.position);
      this.mapDistanceCutoff.radius.value=this.mapStreamRange;
      this.profiler.measure('Streaming CPU', () => this.updateMapStream(now));
      this.profiler.measure('Occlusion CPU',()=>this.rayOcclusion.prepare(this.camera,this.staticMapRoot));
      const size=this.getViewportSize();
      this.inspection.update(size.width,size.height,this.mapStreamFocus??this.camera.position,this.mapStreamRange);
      const renderCamera=this.inspection.enabled?this.inspection.camera:this.camera;
      for (const { group, offset } of this.javaSkyDomeNodes.values())
        group.position.copy(this.camera.position).add(offset);
      this.lighting.updateSun(this.sunLight, this.mapStreamFocus ?? this.controls.target);
      if (this.sunFlare) this.sunFlare.position.copy(this.camera.position)
        .addScaledVector(this.lighting.direction, 500);
      this.profiler.beginGpu();
      this.inspection.helpers.visible=false;
      try {
        this.profiler.measure('Static shadow bake CPU', () => this.graphicsDiagnostics.pass('Static bake',()=>this.staticMapShadows.update(this.renderer,this.staticMapRoot,
          this.mapStreamFocus ?? this.controls.target,this.lighting.direction,this.mapStream?.shadowRevision ?? 0,now)));
        this.profiler.measure('Reflections CPU', () => this.graphicsDiagnostics.pass('Reflections',()=>this.vehicleReflections.update(this.renderer, this.scene,
          this.mapStreamFocus ?? this.controls.target, [...this.proxies.values()], now)));
      } finally {this.inspection.helpers.visible=this.inspection.enabled;}
      for (const { group, offset } of this.javaSkyDomeNodes.values())
        group.position.copy(renderCamera.position).add(offset);
      if(this.sunFlare)this.sunFlare.position.copy(renderCamera.position).addScaledVector(this.lighting.direction,500);
      this.gpuOcclusion.observerView=this.inspection.enabled;
      this.profiler.measure('GPU occlusion CPU',()=>this.graphicsDiagnostics.pass('GPU occlusion',()=>this.gpuOcclusion.prepare(this.camera,this.staticMapRoot,this.geometryCutoff||this.inspection.enabled&&this.inspectResident||this.rayOcclusion.enabled,this.mapStream?.revision??0,this.mapStream?.consumeOcclusionChanges())));
      this.profiler.measure('Render CPU', () => this.graphicsDiagnostics.pass('Main color',()=>
        this.gpuOcclusion.renderMain(()=>this.rayOcclusion.renderMain(this.inspection.enabled&&this.inspectResident,()=>this.renderer.render(this.scene,renderCamera),this.earlyMapCulling?this.staticMapRoot:undefined))));
      this.profiler.measure('GPU occlusion debug CPU',()=>this.gpuOcclusion.renderDebug(renderCamera));
      this.profiler.endGpu();
      this.profiler.measure('GPU occlusion CPU',()=>this.gpuOcclusion.endFrame());
      }finally{
        this.profiler.endGpu();this.profiler.endFrame();
        if(this.renderRecorder?.status.recording){const size=this.renderer.getDrawingBufferSize(new THREE.Vector2());
          this.renderRecorder.recordRenderFrame(now,{...this.renderer.info.render,width:size.x,height:size.y},document.hidden);
          const timings=this.profiler.frameTimings(),workFields:Record<string,number>={};
          // Completed async stream finalization belongs to the interval since the previous drain.
          for(const [prefix,work] of [['stream_',this.mapStream?.workProfile],['hiz_',this.gpuOcclusion.workProfile]] as const)
            if(work)for(const [key,value] of Object.entries(work.drain()))workFields[prefix+key]=value;
          this.renderRecorder.recordPerformanceFrame(now,timings,document.hidden,workFields);}
        this.afterFrame?.();
        const capture=this.frameCapture;if(capture){this.frameCapture=undefined;
          this.renderer.domElement.toBlob(blob=>blob?capture.resolve(blob):capture.reject(Error('Frame capture failed')),'image/png');}
      }
    });
  }
  clear() {
    this.frameCapture?.reject(Error('Scene cleared'));this.frameCapture=undefined;
    this.rayOcclusion.reset();this.gpuOcclusion.reset();
    this.mapPackPath=undefined;
    this.collisionOnlyMapMeshes=0;this.excludedNightMapVariants=this.excludedNightMapInstances=0;
    // Loads from a previous scene retain their own pool until their clones dispose.
    this.mapTextures = new TextureSourceCache();
    this.vehicleTextures = new AssetTextureSources();
    this.staticMapShadows.reset();this.staticMapRoot=undefined;
    this.vehicleReflections.reset();
    this.sunFlareRevision++;
    this.sunFlare?.removeFromParent(); this.sunFlare = undefined;
    this.sunFlareTexture?.dispose(); this.sunFlareTexture = undefined;
    this.javaRenderRoot.clear(); this.javaRenderNodes.clear(); this.javaRenderModels.clear(); this.javaSkyDomeNodes.clear();
    this.javaRenderLights.clear(); this.javaLightDefinitions.clear();
    this.javaRenderTypes.clear(); this.javaRenderRequests.clear();
    this.javaRenderRevisions.clear();
    this.skyFogUniforms.clear();
    for (const promise of this.javaRenderTemplates.values())
      void promise.then(group => this.disposeGroup(group)).catch(() => undefined);
    this.javaRenderTemplates.clear();
    this.stopDriving?.(); this.proxies.clear(); this.collisionMeshes.clear(); this.alphaModes.clear();
    this.mapStream?.dispose(); this.mapStream = undefined;
    this.mapDebug?.dispose(); this.mapDebug = undefined;
    this.scene.fog = null; this.scene.background = null;
    this.internalView = false;
    this.generation++;
    this.grid.visible = true; this.driveGrid.visible = false; this.ground.visible = false;
    this.camera.near = 0.01; this.normalCameraFar = 1000; this.updateFarPlane(); this.camera.updateProjectionMatrix();
    this.model.traverse(obj => {
      if (obj instanceof THREE.Sprite) { obj.material.map?.dispose(); obj.material.dispose(); return; }
      if (!(obj instanceof THREE.Mesh)) return;
      obj.geometry.dispose();
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.forEach(material => { material.map?.dispose(); material.userData.detailTexture?.dispose(); material.userData.reflectionTexture?.dispose(); material.userData.bakedLightmapTexture?.dispose(); material.dispose(); });
    });
    this.model.clear();
  }
  async upsertJavaRenderObject(node: RenderObject, assets: Assets): Promise<void> {
    const generation = this.generation;
    let group = this.javaRenderNodes.get(node.id);
    if (node.resourceType !== 3) {
      group?.removeFromParent(); this.javaRenderNodes.delete(node.id);
      this.javaRenderModels.delete(node.id);
      this.javaRenderLights.get(node.id)?.group.removeFromParent(); this.javaRenderLights.delete(node.id);
      this.javaSkyDomeNodes.delete(node.id);
      this.javaRenderTypes.delete(node.id); this.javaRenderRequests.delete(node.id);
      this.javaRenderRevisions.delete(node.id);
      return;
    }
    if (!group) {
      group = new THREE.Group();
      this.javaRenderNodes.set(node.id, group);
      const modelGroup = new THREE.Group();
      modelGroup.name = `${node.alias} model`;
      group.add(modelGroup);
      this.javaRenderModels.set(node.id, modelGroup);
    }
    const parent = node.parent instanceof RenderObject
      ? this.javaRenderNodes.get(node.parent.id) ?? this.javaRenderRoot : this.javaRenderRoot;
    if (group.parent !== parent) parent.add(group);
    group.name = node.alias;
    group.userData.resourceTypeId = node.typeId;
    group.position.set(node.position.x, node.position.y, node.position.z);
    group.rotation.set(node.orientation.p, node.orientation.y, node.orientation.r, 'YXZ');
    const modelGroup = this.javaRenderModels.get(node.id)!;
    const revision = (this.javaRenderRevisions.get(node.id) ?? 0) + 1;
    this.javaRenderRevisions.set(node.id, revision);
    modelGroup.scale.set(0.01 * node.meshScale.x, 0.01 * node.meshScale.y, 0.01 * node.meshScale.z);
    // Navigator tiles and car markers belong to the OSD map, not the 3D world.
    const isNavigatorOverlay = node.alias === 'navigator_segment' || node.alias === 'marker';
    if (isNavigatorOverlay || node.renderType?.sceneLightManaged || previewScope(node)) {
      group.visible = false;
      modelGroup.clear();
      this.javaRenderTypes.delete(node.id);
      this.javaRenderRequests.set(node.id, (this.javaRenderRequests.get(node.id) ?? 0) + 1);
      this.javaRenderLights.get(node.id)?.group.removeFromParent(); this.javaRenderLights.delete(node.id);
      return;
    }
    const lightIdentity = node.renderResource;
    if (lightIdentity && (!node.renderType?.resourceType || node.renderType.resourceType === 13)) {
      const key = `${lightIdentity.pack.toLowerCase()}:${lightIdentity.id}`;
      let definition = this.javaLightDefinitions.get(key);
      if (!definition) {
        definition = assets.resource(lightIdentity.pack, lightIdentity.id).then(({ entry }) => parseResourceLight(entry));
        this.javaLightDefinitions.set(key, definition);
        void definition.catch(() => { if (this.javaLightDefinitions.get(key) === definition) this.javaLightDefinitions.delete(key); });
      }
      const light = await definition;
      if (generation !== this.generation || this.javaRenderRevisions.get(node.id) !== revision
        || this.javaRenderNodes.get(node.id) !== group || !group.parent) return;
      if (light) {
        if (node.renderType) node.renderType.resourceType = 13;
        modelGroup.clear(); this.javaRenderTypes.delete(node.id);
        this.javaRenderRequests.set(node.id, (this.javaRenderRequests.get(node.id) ?? 0) + 1);
        this.javaSkyDomeNodes.delete(node.id); group.visible = true;
        if (this.javaRenderLights.get(node.id)?.key !== key) {
          this.javaRenderLights.get(node.id)?.group.removeFromParent();
          const lights = createResourceLight(light);
          group.add(lights); this.javaRenderLights.set(node.id, { key, group: lights });
        }
        return;
      }
    }
    this.javaRenderLights.get(node.id)?.group.removeFromParent(); this.javaRenderLights.delete(node.id);
    group.visible = true;
    // Scene.java names map sky shells "egbolt-*". The original renderer keeps these
    // shells around the camera; leaving one at map origin makes it look like a hill.
    const isSkyDome = /^egbolt[-_]/i.test(node.alias);
    if (isSkyDome) {
      const offset = new THREE.Vector3(node.position.x, node.position.y, node.position.z);
      this.javaSkyDomeNodes.set(node.id, { group, offset });
      group.position.copy(this.camera.position).add(offset);
      group.renderOrder = -1000;
    } else {
      this.javaSkyDomeNodes.delete(node.id);
      group.renderOrder = 0;
    }
    for (const child of node.children) if (child instanceof RenderObject) {
      const childGroup = this.javaRenderNodes.get(child.id);
      if (childGroup && childGroup.parent !== group) group.add(childGroup);
    }

    // A render instance is just a transform until its RPK resource is resolved and its SCX is loaded.
    const identity = node.renderResource;
    // Navigator tiles are per-instance clones whose textures are replaced by the Java script.
    // Keep this interpretation scoped to those aliases; other RenderRefs retain existing semantics.
    const overrides = node.alias === 'navigator_segment' ? node.renderType : null;
    const overrideKey = overrides ? [...overrides.resourceReplacements]
      .map(([source, target]) => `${source.toString(16)}>${target.toString(16)}@${overrides.resourceReplacementPacks.get(source) ?? ''}`)
      .sort().join(',') : '';
    const key = identity ? `${identity.pack.toLowerCase()}:${identity.id}|${overrideKey}` : '';
    if (this.javaRenderTypes.get(node.id) === key) return;
    this.javaRenderTypes.set(node.id, key);
    modelGroup.clear();
    const request = (this.javaRenderRequests.get(node.id) ?? 0) + 1;
    this.javaRenderRequests.set(node.id, request);
    if (!identity) return;

    const templateKey = `${key}|${isSkyDome ? 'sky' : 'model'}`;
    let templatePromise = this.javaRenderTemplates.get(templateKey);
    if (!templatePromise) {
      templatePromise = (async () => {
        const model = await assets.modelForResource(identity.pack, identity.id, new Set(), overrides ? {
          replacements: overrides.resourceReplacements,
          replacementPacks: overrides.resourceReplacementPacks,
          sourcePacks: overrides.resourceReplacementSourcePacks,
        } : undefined);
        const parsed = await parseScxAsync(await assets.read(model.path));
        const template = new THREE.Group();
        const warnings = await this.append(parsed, assets, model.textures, template, generation);
        if (isSkyDome) template.traverse(object => {
          if (!(object instanceof THREE.Mesh)) return;
          object.renderOrder = -1000;
          object.castShadow = false; object.receiveShadow = false;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach(material => this.configureSkyMaterial(material));
        });
        if (generation !== this.generation) this.disposeGroup(template);
        if (warnings.length) console.warn(`Java RenderRef ${node.alias}: ${warnings.join('; ')}`);
        return template;
      })();
      this.javaRenderTemplates.set(templateKey, templatePromise);
      void templatePromise.catch(() => {
        if (this.javaRenderTemplates.get(templateKey) === templatePromise) this.javaRenderTemplates.delete(templateKey);
      });
    }
    const template = await templatePromise;
    if (generation !== this.generation || this.javaRenderRequests.get(node.id) !== request
      || this.javaRenderNodes.get(node.id) !== group || !group.parent) return;
    modelGroup.add(template.clone(true));
  }
  setMapFog(settings: MapFogSettings) {
    if (!Number.isInteger(settings.color) || settings.color < 0 || settings.color > 0xffffff || !Number.isFinite(settings.near) || !Number.isFinite(settings.far) || settings.near < 0 || settings.far <= settings.near) throw new Error('Invalid map fog settings');
    this.mapFog = { ...settings };
    for (const fog of this.skyFogUniforms) fog.color.setHex(settings.color);
    if (this.mapFogEnabled) this.scene.fog = new THREE.Fog(settings.color, settings.near, settings.far);
    this.scene.background = new THREE.Color(settings.color);
  }
  setMapFogEnabled(enabled: boolean) {
    this.mapFogEnabled = enabled;
    this.scene.fog = enabled ? new THREE.Fog(this.mapFog.color, this.mapFog.near, this.mapFog.far) : null;
    for (const fog of this.skyFogUniforms) fog.enabled.value = enabled ? 1 : 0;
  }
  setSceneLight(settings: RenderLightSettings) {
    for (const color of [settings.diffuse, settings.ambient, settings.specular])
      if (!Number.isInteger(color) || color < 0 || color > 0xffffff) throw new Error('Invalid scene light color');
    this.sunLight.color.setHex(settings.diffuse);
    this.ambientLight.color.setHex(settings.ambient);
    this.ambientLight.groundColor.setHex(settings.ambient);
    // Three.js standard materials have no per-light specular color; retain it for future material work.
    this.sunLight.userData.specularColor = settings.specular;
  }
  async setSceneFlare(source: RenderFlareSource): Promise<void> {
    const revision = ++this.sunFlareRevision;
    let phase = 'PTX header';
    try {
    const bytes = source.bytes;
    if (!source.path.toLowerCase().endsWith('.ptx') || bytes.length < 40)
      throw new Error(`Unsupported flare texture: ${source.path}`);
    // SL2 PTX stores a color JPEG and a separate grayscale alpha JPEG after its 36-byte header.
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const colorSize = header.getUint32(20, true), alphaSize = header.getUint32(24, true);
    if (!colorSize || !alphaSize || 36 + colorSize + alphaSize > bytes.length)
      throw new Error(`Invalid flare PTX: ${source.path}`);
    phase = 'JPEG decode';
    const loadJpeg = (part: Uint8Array) => createImageBitmap(new Blob([Uint8Array.from(part)], { type: 'image/jpeg' }));
    const [color, alpha] = await Promise.all([
      loadJpeg(bytes.subarray(36, 36 + colorSize)),
      loadJpeg(bytes.subarray(36 + colorSize, 36 + colorSize + alphaSize)),
    ]);
    if (revision !== this.sunFlareRevision) { color.close(); alpha.close(); return; }
    phase = 'alpha compositing';
    // The upper-left 128x128 tile is the game's sun glow; the remaining tiles are smaller ghosts.
    const size = Math.min(128, color.width, color.height, alpha.width, alpha.height);
    const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) { color.close(); alpha.close(); throw new Error('Flare canvas unavailable'); }
    context.drawImage(color, 0, 0); const pixels = context.getImageData(0, 0, size, size);
    context.clearRect(0, 0, size, size); context.drawImage(alpha, 0, 0);
    const mask = context.getImageData(0, 0, size, size);
    for (let i = 0; i < pixels.data.length; i += 4) pixels.data[i + 3] = mask.data[i];
    context.putImageData(pixels, 0, 0); color.close(); alpha.close();
    phase = 'lens flare setup';
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    if (source.sunDirection) this.lighting.direction.set(source.sunDirection.x, source.sunDirection.y, source.sunDirection.z).normalize();
    const tint = new THREE.Color((source.color >>> 8) & 0xffffff);
    const flare = new Lensflare();
    const renderFlare = flare.onBeforeRender;
    // Lensflare copies the framebuffer for occlusion; time it separately so
    // driver stalls here are distinguishable from ordinary scene submission.
    flare.onBeforeRender = (...args) => this.profiler.measure('Sun flare CPU', () => renderFlare.apply(flare, args));
    const glowSize = Math.max(48 + source.minSize * 16, Math.min(384, 96 + source.maxSize * 16));
    flare.addElement(new LensflareElement(texture, glowSize, 0, tint));
    const ghosts = Math.min(5, Math.max(0, Math.floor(source.flareCount / 3)), Math.max(0, source.rayCount));
    for (let i = 0; i < ghosts; i++)
      flare.addElement(new LensflareElement(texture, Math.max(24, glowSize * (0.15 + i * 0.07)),
        (i + 1) / (ghosts + 1), tint.clone().multiplyScalar(0.35)));
    this.sunFlare?.removeFromParent(); this.sunFlareTexture?.dispose();
    this.sunFlare = flare; this.sunFlareTexture = texture; this.scene.add(flare);
    } catch (reason) {
      const description = reason instanceof Error ? reason.message || reason.name : String(reason);
      throw new Error(`Scene flare ${phase} failed (${source.path}): ${description || 'unknown error'}`, { cause: reason });
    }
  }
  async setGlobalEnvmap(source: EnvironmentMapSource | null): Promise<void> {
    const revision = ++this.environmentRevision;
    if (!source) {
      this.reflectionUniforms.environment.value = null; this.reflectionUniforms.available.value = 0;
      this.scene.environment = null;this.environmentPath=undefined;
      this.environmentTexture?.dispose(); this.environmentTexture = undefined;
      return;
    }
    const texture = await this.texture(source.bytes, source.path);
    if (revision !== this.environmentRevision) { texture.dispose(); return; }
    texture.colorSpace = THREE.SRGBColorSpace;
    // Original skydome envmaps are 2D panoramas (DDS caps have no cubemap faces).
    // Equirectangular lookup is the closest supported Three.js projection here.
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    const previous = this.environmentTexture;
    this.environmentTexture = texture;this.environmentPath=source.path;
    this.reflectionUniforms.environment.value = texture; this.reflectionUniforms.available.value = 1;
    this.scene.environment = texture;
    previous?.dispose();
  }
  async restoreRouteEnvironment(metadata:Record<string,unknown>,assets:Assets){
    if(typeof metadata.environment_map==='string'){
      const path=metadata.environment_map;
      await this.setGlobalEnvmap(path?{path,bytes:await assets.read(path)}:null);
      return;
    }
    // Old route files omit Scene.java's environment state. Use a deterministic
    // stock daytime environment, not whichever garage/map happened to run first.
    const {entry}=await assets.resource('maps/skydome.rpk',0x26);
    const path=entryProperties(entry).find(property=>property.key==='sourcefile')?.value;
    if(!path)throw Error('Stock daytime environment texture is missing');
    await this.setGlobalEnvmap({path,bytes:await assets.read(path)});
  }
  showMapDebug(layer: MapDebugLayer, visible: boolean) { this.mapDebug?.show(layer, visible); }
  dispose() {
    this.profiler.dispose();this.gpuOcclusion.dispose();
    this.environmentRevision++;
    this.scene.environment = null;
    this.environmentTexture?.dispose(); this.environmentTexture = undefined;
    this.renderer.setAnimationLoop(null); this.observer.disconnect(); this.controls.dispose(); this.clear();
    this.scene.traverse(object => {
      if (object instanceof THREE.GridHelper) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach(m => m.dispose()); }
    });
    this.renderer.dispose(); this.renderer.domElement.remove();
    this.ground.geometry.dispose(); this.ground.material.dispose();
  }
  async show(model: ScxModel, assets: Assets, textures: string[]): Promise<string[]> {
    this.clear(); const generation = this.generation;
    const warnings = await this.append(model, assets, textures, this.model, generation);
    if (generation === this.generation) this.fit();
    return warnings;
  }
  removeWorld(world: EngineWorld): void {
    for (const [part, group] of this.proxies) if (part.world === world) {
      group.removeFromParent(); this.disposeGroup(group);
      this.proxies.delete(part); this.collisionMeshes.delete(part);
    }
  }
  /** Build an isolated inventory mesh tree; never publish its objects/lights into the world. */
  async createPreviewWorld(world: EngineWorld, assets: Assets): Promise<THREE.Group> {
    const root = new THREE.Group(), generation = this.generation;
    try {
      for (const part of world.parts.values()) {
        const model = part.definition.model;
        if (!model) continue;
        const paint = await partPaint(part, assets);
        const group = new THREE.Group(); group.matrixAutoUpdate = false;
        group.matrix.copy(modelMatrix(part.matrix(), partRenderPose(part))); root.add(group);
        await this.append(await parseScxAsync(await assets.read(model.path)), assets, model.textures, group, generation, false, () => true, undefined, paint);
        const pose = part.definition.config.renderPose ? poseMatrix(part.definition.config.renderPose) : new THREE.Matrix4();
        for (const extra of part.definition.additionalModels ?? []) {
          const sub = new THREE.Group(); sub.matrixAutoUpdate = false;
          sub.matrix.copy(pose.clone().invert().multiply(extra.pose ? poseMatrix(extra.pose) : new THREE.Matrix4()));
          sub.userData.lightFlags = extra.flags ?? 0; sub.visible = cfgRenderVisible(extra.flags, world.lightMask);
          group.add(sub);
          const extraModel = await parseScxAsync(await assets.read(extra.model.path));
          bindLinkedRender(sub, extra.links, extraModel, extra.pose, extra.linkRules);
          await this.append(extraModel, assets, extra.model.textures, sub, generation, false, () => true, undefined, paint);
          configureCfgLampEmission(sub, extra.flags);
        }
        syncLinkedRenders(part, group);
      }
      root.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const unlit = (source: THREE.MeshStandardMaterial) => {
            const material = previewMaterial(source);
          source.userData.reflectionTexture?.dispose();
          source.dispose(); return material;
        };
        object.material = Array.isArray(object.material) ? object.material.map(unlit) : unlit(object.material);
        object.castShadow = object.receiveShadow = false;
      });
      return root;
    } catch (error) { this.disposeGroup(root); throw error; }
  }
  disposePreviewWorld(group: THREE.Group): void { this.disposeGroup(group); }
  private async updatePartPaint(part: EnginePart, assets: Assets): Promise<void> {
    if (part.definition.config.texture === undefined) return;
    const group = this.proxies.get(part);
    if (!group) return;
    const key = part.paintTexture ? `${part.paintTexture.pack}:${part.paintTexture.id}` : 'default';
    if (group.userData.paintKey === key) return;
    const paint = await partPaint(part, assets);
    if (!paint) return;
    const materials: THREE.MeshStandardMaterial[] = [];
    group.traverse(object => { if (object instanceof THREE.Mesh) {
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        if (material.userData.paintDefault) materials.push(material);
    } });
    for (const material of materials) {
      const texture = await this.vehicleTextures.acquire(assets, paint.to,
        async () => this.texture(await assets.read(paint.to), paint.to));
      if (part.world.disposed || this.proxies.get(part) !== group) { texture.dispose(); return; }
      texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      if (material.map) { texture.repeat.copy(material.map.repeat); texture.offset.copy(material.map.offset); material.map.dispose(); }
      material.map = texture; material.needsUpdate = true;
    }
    group.userData.paintKey = key;
  }
  syncWorldVisuals(world: EngineWorld): void {
    this.profiler.measure('Vehicle mesh sync CPU',()=>this.syncWorldVisualsCore(world));
  }
  private syncWorldVisualsCore(world:EngineWorld):void {
    for (const [part, group] of this.proxies) if (part.world === world) {
      if (world.parts.get(part.id) !== part) {
        group.removeFromParent(); this.disposeGroup(group);
        this.proxies.delete(part); this.collisionMeshes.delete(part);
        continue;
      }
      group.matrix.copy(modelMatrix(this.visualPartMatrix(part), partRenderPose(part)));
      group.matrixWorldNeedsUpdate = true;
      group.visible = !group.userData.partLoading && this.partVisible(part);
      applyCfgRenderChannels(group, world.lightMask);
      syncLinkedRenders(part, group, this.suspensionDebug);
    }
  }
  pickJavaPart(clientX: number, clientY: number): { id: number; local: number[]; world: number[] } | undefined {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1,
      1 - (clientY - rect.top) / rect.height * 2), this.camera);
    const groups = [...this.proxies].filter(([part, group]) => part.nativeId && group.visible);
    this.scene.updateMatrixWorld(true);
    const hit = ray.intersectObjects(groups.map(([, group]) => group), true)[0];
    if (!hit) return;
    const entry = groups.find(([, group]) => { for (let node: THREE.Object3D | null = hit.object; node; node = node.parent) if (node === group) return true; return false; });
    if (!entry) return;
    return { id: entry[0].nativeId!, local: hit.point.clone().applyMatrix4(entry[0].matrix().invert()).toArray(), world: hit.point.toArray() };
  }
  async showWorld(world: EngineWorld, assets: Assets, keepScene = false, publishTogether = false): Promise<string[]> {
    world.experimentalHubGeometry = this.experimentalHubGeometry;
    if (!keepScene) this.clear();
    const generation = this.generation, warnings: string[] = [];
    const staged: THREE.Group[] = [];
    for (const part of world.parts.values()) {
      if (this.proxies.has(part)) { await this.updatePartPaint(part, assets); continue; }
      const model = part.definition.model;
      if (!model) continue;
      const paint = await partPaint(part, assets);
      const parsed = await parseScxAsync(await assets.read(model.path));
      const collision = await loadPartCollision(assets, part.definition);
      if (generation !== this.generation || world.disposed) return warnings;
      const group = new THREE.Group(); group.name = `${part.id}: ${part.definition.alias}`;
      if (publishTogether) { group.visible = false; group.userData.partLoading = true; staged.push(group); }
      group.matrixAutoUpdate = false; group.matrix.copy(modelMatrix(this.visualPartMatrix(part), partRenderPose(part))); this.model.add(group);
      this.proxies.set(part, group);
      this.collisionMeshes.set(part, collision);
      warnings.push(...await this.append(parsed, assets, model.textures, group, generation, false, () => true, undefined, paint, true));
      if (generation !== this.generation) return warnings;
      const primaryPose = part.definition.config.renderPose ? poseMatrix(part.definition.config.renderPose) : new THREE.Matrix4();
      for (const extra of part.definition.additionalModels ?? []) {
        const submodel = new THREE.Group();
        submodel.matrixAutoUpdate = false;
        submodel.matrix.copy(primaryPose.clone().invert().multiply(extra.pose ? poseMatrix(extra.pose) : new THREE.Matrix4()));
        submodel.userData.lightFlags = extra.flags ?? 0; submodel.visible = cfgRenderVisible(extra.flags, world.lightMask);
        group.add(submodel);
        const extraModel = await parseScxAsync(await assets.read(extra.model.path));
        bindLinkedRender(submodel, extra.links, extraModel, extra.pose, extra.linkRules);
        warnings.push(...await this.append(extraModel, assets, extra.model.textures, submodel, generation, false, () => true, undefined, paint, true));
        configureCfgLampEmission(submodel, extra.flags);
        if (generation !== this.generation) return warnings;
      }
      for (const light of part.definition.lights ?? []) {
        // A light is commonly placed at the lens centre, inside its SCX bounds.
        // Clear that lens before depth testing, rather than drawing through walls.
        let lensRadius = 0;
        for (const mesh of parsed.meshes) for (let i = 0; i < mesh.positions.length; i += 3)
          lensRadius = Math.max(lensRadius, Math.hypot(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]) * 0.01);
        const flare = await createVehicleFlare(light.source, assets, Math.min(0.25, lensRadius), light.flags);
        if (generation !== this.generation || world.disposed) { flare.material.map?.dispose(); flare.material.dispose(); return warnings; }
        const lamp = new THREE.Group(); lamp.name = 'CFG lamp flare'; lamp.matrixAutoUpdate = false;
        // Cancel centimetre mesh scaling: RPK light positions are in metres.
        lamp.matrix.makeScale(100, 100, 100).multiply(partRenderPose(part).invert())
          .multiply(light.pose ? poseMatrix(light.pose) : new THREE.Matrix4());
        lamp.userData.lightFlags = light.flags ?? 0; lamp.visible = cfgRenderVisible(light.flags, world.lightMask);
        lamp.add(flare); group.add(lamp);
        if (light.source.beam && ((light.flags ?? 0) & 4)) {
          try {
            const beam = createVehicleBeam(light.source);
            if (generation !== this.generation || world.disposed) {
              beam?.userData.disposeVehicleLight?.(); return warnings;
            }
            if (beam) lamp.add(beam);
            lamp.add(createHeadlightCameraFlare(light.source, flare, Math.min(0.25, lensRadius)));
          } catch (error) { warnings.push(`Headlight projector ${part.definition.alias}: ${String(error)}`); }
        }
      }
    }
    if (generation === this.generation && !world.disposed) {
      for (const group of staged) delete group.userData.partLoading;
      this.syncWorldVisuals(world);
    }
    if (generation === this.generation && !keepScene) this.fit();
    return warnings;
  }
  async showMap(packPath: string, assets: Assets, progress?: (done: number, total: number) => void, keepWorld = false,
    options?: { groundId?: number; preserveCamera?: boolean }) {
    if (!keepWorld) this.clear(); const generation = this.generation;
    this.mapPackPath=packPath;
    const pack = await assets.pack(packPath), warnings: string[] = [];
    const groundEntry = options?.groundId === undefined ? undefined : pack.entries.find(entry => entry.typeId === options.groundId);
    const ground = groundEntry && groundRenderDefinition(groundEntry);
    let room: typeof ground;
    if (ground) {
      const gameType = await assets.resource(packPath, ground.gameType);
      const render = await assets.resource(packPath, ground.renderId);
      // TestTrack also names a direct ground mesh, but its child renders form
      // the rest of the map. Only leaf meshes use the isolated room path.
      if (entryProperties(gameType.entry).some(property => property.key === 'native' && property.value === 'ground')
        && render.entry.type === 14 && entryProperties(render.entry).some(property => property.key === 'mesh')
        && !groundRenderHasChildren(pack, ground.renderId)) {
        const resource = await assets.modelForResource(packPath, ground.renderId);
        const model = await parseScxAsync(await assets.read(resource.path));
        if (groundRenderIsRoom(pack, ground.renderId, model)) room = ground;
      }
    }
    const mapSources = [{ path: packPath.replaceAll('\\', '/').toLowerCase(), pack }];
    // A map can declare a sibling map package as a continuation (for example City → City2).
    // Load it only when both its RDB and static map render resources are present.
    for (const dependency of room ? [] : pack.dependencies) {
      const path = dependency.path.replaceAll('\\', '/').toLowerCase();
      if (!path.startsWith('maps/') || !path.endsWith('.rpk') || mapSources.some(source => source.path === path)) continue;
      if (!assets.byPath.has(path.replace(/\.rpk$/i, '.rdb'))) continue;
      try {
        const linkedPack = await assets.pack(path);
        if (mapRenderIds(linkedPack).length) mapSources.push({ path, pack: linkedPack });
      } catch (error) { warnings.push(`Map dependency ${path}: ${String(error)}`); }
    }
    const ids = room ? [{ source: mapSources[0], id: room.renderId }]
      : mapSources.flatMap(source => mapRenderIds(source.pack).map(id => ({ source, id })));
    const collision = new MapCollision(), terrain = new MapTerrain(collision);
    if (generation !== this.generation) return { loaded: 0, total: ids.length, triangles: 0, objects: 0, warnings, terrain, collision };
    this.mapStream?.dispose(); this.mapStreamFocus = undefined;
    this.rayOcclusion.reset();this.gpuOcclusion.reset();
    this.mapDebug?.dispose(); this.mapDebug = undefined;
    this.grid.visible = false; this.driveGrid.visible = false; this.ground.visible = false;
    this.scene.fog = this.mapFogEnabled ? new THREE.Fog(this.mapFog.color, this.mapFog.near, this.mapFog.far) : null;
    this.scene.background = new THREE.Color(this.mapFog.color);
    this.model.scale.setScalar(1); this.model.position.set(0, 0, 0);
    this.camera.near = 0.1; this.normalCameraFar = 5000; this.updateFarPlane(); this.camera.updateProjectionMatrix();
    if (!options?.preserveCamera) {
      this.controls.target.set(0, 2, -650); this.camera.position.set(180, 130, -440); this.controls.update();
    }
    let loaded = 0, triangles = 0;
    this.collisionOnlyMapMeshes=0;this.excludedNightMapVariants=this.excludedNightMapInstances=0;
    this.staticMapShadows.reset();this.staticMapRoot?.removeFromParent();
    this.staticMapRoot = new THREE.Group();this.staticMapRoot.name='Static map';this.model.add(this.staticMapRoot);
    const stream = new MapObjectStream(this.staticMapRoot, this.mapStreamRange);
    stream.frameBudgetMs=2;
    stream.setInspectResident(this.inspection.enabled&&this.inspectResident);
    stream.setGeometryCutoff(this.geometryCutoff);
    stream.setStaticBatching(this.staticBatching);
    stream.setAutoLod(this.autoMapLod);
    stream.setTightFrustum(this.tightMapFrustum);
    for(const category of this.hiddenMapCategories)stream.setCategoryHidden(category,true);
    stream.setMaterialSharing(this.sharedMapMaterials);
    stream.setShadowRange(this.bakedLightmaps.value ? 150 : 0);
    this.mapStream = stream;
    this.updateFarPlane();
    this.nextStreamUpdate=-Infinity;
    for (const { source, id } of ids) {
      if (generation !== this.generation) break;
      try {
        const resource = await assets.modelForResource(source.path, id);
        const placeGround = (parsed: ScxModel) => {
          if (!room) return parsed;
          const transform = poseMatrix(room.pose), point = new THREE.Vector3();
          for (const mesh of parsed.meshes) for (let i = 0; i < mesh.positions.length; i += 3)
            point.fromArray(mesh.positions, i).multiplyScalar(0.01).applyMatrix4(transform).multiplyScalar(100).toArray(mesh.positions, i);
          for (const mesh of parsed.meshes) for (let i = 0; i < mesh.normals.length; i += 3)
            point.fromArray(mesh.normals, i).transformDirection(transform).toArray(mesh.normals, i);
          return parsed;
        };
        const parsed = placeGround(await parseScxAsync(await assets.read(resource.path)));
        if (generation !== this.generation) break;
        terrain.add(parsed, resource.textures);
        collision.add(parsed);
        const collisionOnly=isStockMapCollisionShell(source.path,resource.path,source.pack.entries.find(entry=>entry.typeId===id)?.alias??'',parsed);
        if(collisionOnly)this.collisionOnlyMapMeshes++;
        const bounds = new THREE.Box3();
        const vertex = new THREE.Vector3();
        for (const mesh of parsed.meshes) for (let i = 0; i < mesh.positions.length; i += 3)
          bounds.expandByPoint(vertex.fromArray(mesh.positions, i).multiplyScalar(0.01));
        if (!collisionOnly && !bounds.isEmpty()) {
          const center = bounds.getCenter(new THREE.Vector3());
          stream.add([{ matrix: new THREE.Matrix4(), position: center,
            bounds: { minX: bounds.min.x, maxX: bounds.max.x, minZ: bounds.min.z, maxZ: bounds.max.z } }], async wanted => {
            if (!wanted()) return [];
            const template = new THREE.Group();
            const model = placeGround(await parseScxAsync(await assets.read(resource.path)));
            if (!wanted()) return [];
            warnings.push(...await this.append(model, assets, resource.textures, template, generation, true, wanted));
            const parts = template.children.filter((part): part is THREE.Mesh => part instanceof THREE.Mesh);
            for (const part of parts){part.geometry.scale(0.01, 0.01, 0.01);part.userData.mapOcclusionRole='terrain';}
            return parts;
          });
        }
        triangles += parsed.meshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0);
        loaded++;
      } catch (error) { warnings.push(`0x${id.toString(16)}: ${String(error)}`); }
      progress?.(loaded, ids.length);
    }
    let objects = 0;
    const unifyBuildings=this.unifiedBuildingMaterials||this.globalFacadeBatching;this.mapUnifiedBuildingMaterials=unifyBuildings;
    const globalFacades=this.globalFacadeBatching;this.mapGlobalFacadeBatching=globalFacades;
    const objectBatches = new Map<string, { pack: string; id: number; alias: string; category?:MapObjectCategory; placements: StreamPlacement[] }>();
    for (const source of room ? [] : mapSources) try {
      const rdb = new TextDecoder('windows-1252').decode(await assets.read(source.path.replace(/\.rpk$/i, '.rdb')));
      const placements = mapObjectPlacements(rdb, source.pack), byType = new Map<number, typeof placements>();
      for (const placement of placements) {
        const list = byType.get(placement.typeId) ?? [];
        if (!list.length) byType.set(placement.typeId, list);
        list.push(placement);
      }
      for (const [typeId, instances] of byType) {
        if (generation !== this.generation) break;
        try {
          const resource = await assets.resource(source.path, typeId);
          if (resource.entry.type !== 8) continue;
          const cfg = parseIcfg(resource.entry.data);
          // Keep the highest-detail LOD for the nearby-object stream. Lower LODs
          // are substitutes, not extra pieces; loading all of them hides the map
          // behind overlapping tree/building meshes, while skipping them all
          // removes objects that only define LOD-tagged render entries.
          const lodRenders = cfg.renders.filter(render => render.lod);
          const nearLod = lodRenders.sort((a, b) =>
            (b.lod![0] + b.lod![1]) - (a.lod![0] + a.lod![1]) || b.lod![1] - a.lod![1]
          )[0];
          for (const render of cfg.renders) {
            // LOD entries are alternate versions. Unmarked render entries are
            // simultaneous pieces of one object (e.g. a traffic-light head + pole,
            // or the building and signage meshes of a City storefront).
            if (render.lod && render !== nearLod) continue;
            for (const instance of instances) {
              const seed = mapObjectSeed(instance), id = mapRenderResource(render, seed);
              if (!id) continue;
              const color = render.colors?.length ? render.colors[seed % render.colors.length] : undefined;
              const category=mapObjectCategory(resource.entry.alias);
              const key = `${resource.packPath.toLowerCase()}:${id}:${category??'other'}`;
              let batch = objectBatches.get(key);
              if (!batch) {
                batch = { pack: resource.packPath, id, alias: resource.entry.alias, category, placements: [] };
                objectBatches.set(key, batch);
              }
              const matrix = poseMatrix(instance.pose);
              if (render.pose) matrix.multiply(poseMatrix(render.pose));
              batch.placements.push({ matrix, position: new THREE.Vector3().setFromMatrixPosition(matrix), paintColor: color });
            }
          }
          for (const instance of instances) for (const body of cfg.bodies) {
            if (body.collision === false || body.shape[0]?.toLowerCase() !== 'box') continue;
            const half = body.shape.slice(1, 4).map(Number);
            if (half.length === 3) collision.addBox(poseMatrix(instance.pose).multiply(poseMatrix(body)), new THREE.Vector3(half[0], half[1], half[2]));
          }
          objects += instances.length;
        } catch (error) { warnings.push(`Object type 0x${typeId.toString(16)}: ${String(error)}`); }
      }
    } catch (error) { warnings.push(`Map objects ${source.path}: ${String(error)}`); }
    // Signs, poles and other components shared by different CFG types use one
    // model batch; local render poses and palette colors belong to each instance.
    for (const batch of objectBatches.values()) {
      if(generation!==this.generation)break;
      // Resolve the selected variant's own alias, not the parent building alias.
      // Filter before SCX/textures/cached cells are loaded, including night signs.
      try{
        const {entry}=await assets.resource(batch.pack,batch.id);
        if(isNightMapRenderResource(entry.alias)){
          this.excludedNightMapVariants++;this.excludedNightMapInstances+=batch.placements.length;continue;
        }
      }catch(error){warnings.push(`Map render metadata ${batch.pack}:0x${batch.id.toString(16)}: ${String(error)}`);continue;}
      stream.add(batch.placements, async wanted => {
      const model = await assets.modelForResource(batch.pack, batch.id);
      if (!wanted()) return [];
      const parsed = await parseScxAsync(await assets.read(model.path)), component = new THREE.Group();
      if (!wanted()) return [];
      warnings.push(...await this.append(parsed, assets, model.textures, component, generation, true, wanted));
      for (const part of component.children) if (part instanceof THREE.Mesh) {
        part.geometry.scale(0.01, 0.01, 0.01);
        part.name = `map object ${batch.alias}: ${part.name}`;
      }
      const parts=component.children.filter((part): part is THREE.Mesh => part instanceof THREE.Mesh);
      const outputs=unifyBuildings&&isBuildingAlias(batch.alias)&&wanted()?this.unifyBuildingParts(parts,warnings):parts;
      for(const part of outputs)part.userData.mapOcclusionRole=batch.category?'prop':'structure';
      return outputs;
    },batch.category,unifyBuildings&&isBuildingAlias(batch.alias));
    }
    if (generation === this.generation) {
      await stream.preparePinnedModels();
      if(globalFacades&&generation===this.generation){
        try{stream.compileGlobalFacades();}catch(error){this.mapGlobalFacadeBatching=false;warnings.push(`Global facade batches: ${String(error)}`);}
      }
      await stream.setCachedCells(this.precachedObjectCells,this.objectCellSize);
      if(generation!==this.generation)return {loaded,total:ids.length,triangles,objects,warnings,terrain,collision};
      terrain.prepare(); this.mapDebug = new MapDebugView(this.model, terrain, collision); stream.update(this.camera.position);
    }
    return { loaded, total: ids.length, triangles, objects, warnings, terrain, collision };
  }
  showInternals(value: boolean) {
    this.internalView = value;
    for (const [part, group] of this.proxies) group.visible = this.partVisible(part);
  }
  private partVisible(part: EnginePart): boolean {
    const type = part.parent?.definition.config.slots.find(s => s.id === part.parentSlot)?.type;
    return part.renderVisible && (!this.internalView || !!part.definition.mechanics || type !== undefined && type >= 101 && type < 200);
  }
  private syncWorld(exclude?: EnginePart | Set<EnginePart>) {
    for (const [part, group] of this.proxies) {
      applyCfgRenderChannels(group, part.world.lightMask);
      syncLinkedRenders(part, group, this.suspensionDebug);
      if (part === exclude || exclude instanceof Set && exclude.has(part)) continue;
      group.matrix.copy(modelMatrix(this.visualPartMatrix(part), partRenderPose(part)));
      group.matrixWorldNeedsUpdate = true;
    }
  }
  async hood(definition: PartDefinition, assets: Assets, telemetry: (text: string) => void) {
    this.clear(); const generation = this.generation;
    if (!definition.model) throw new Error('Hood model missing');
    const parsed = await parseScxAsync(await assets.read(definition.model.path));
    if (generation !== this.generation) return;
    const transform = modelMatrix(new THREE.Matrix4().makeTranslation(0, 1.25, 0), definition.config.renderPose && poseMatrix(definition.config.renderPose));
    for (const mesh of parsed.meshes) for (let i = 0; i < mesh.positions.length; i += 3) {
      const point = new THREE.Vector3().fromArray(mesh.positions, i).applyMatrix4(transform); point.toArray(mesh.positions, i);
    }
    await this.append(parsed, assets, definition.model.textures, this.model, generation);
    if (generation !== this.generation) return;
    const slot = definition.config.slots.find(s => s.attach.length);
    if (!slot) throw new Error('Hood mount slot missing');
    const lab = new HoodLab(this.model, definition.config.bodies.reduce((sum, b) => sum + b.mass, 0), [slot.position[0], slot.position[1] + 1.25, slot.position[2]], telemetry);
    this.model.position.set(0, 0, 0); this.model.scale.setScalar(1); this.ground.visible = true;
    this.controls.target.set(0, 0.9, 0); this.camera.position.set(1.9, 2.5, -2.5); this.controls.update();
    this.frame = now => {
      lab.frame(now);
      if (!lab.panel.attached) {
        const center = new THREE.Vector3(), p = lab.panel.positions;
        for (let i = 0; i < p.length; i += 3) center.add(new THREE.Vector3(p[i], p[i + 1], p[i + 2]));
        center.multiplyScalar(0.6 / (p.length / 3)).add(new THREE.Vector3(0, 0.36, 0));
        const delta = center.sub(this.controls.target).multiplyScalar(0.06);
        this.camera.position.add(delta); this.controls.target.add(delta);
      }
    };
    let stopped = false;
    const stop = () => { if (stopped) return; stopped = true; this.frame = undefined; this.stopDriving = undefined; this.ground.visible = false; lab.dispose(); };
    this.stopDriving = stop;
    return { hit: (impulse: number) => lab.hit(impulse), reset: () => { lab.reset(); const delta = new THREE.Vector3(0, 0.9, 0).sub(this.controls.target); this.camera.position.add(delta); this.controls.target.add(delta); }, wireframe: (value: boolean) => lab.wireframe(value), dispose: stop };
  }
  drive(root: EnginePart, telemetry: (text: string) => void, withCrash = false, track?: { terrain: MapTerrain; collision: MapCollision; position: THREE.Vector3; yaw: number }, assets?: Assets, audioVolumes?: { getVolume(channel: number): number }, java?: { sample(): DrivingInput; timeOfDay?(): number; cameraMode(): number; cameraIndex?(): number; cameraDistance?(): number; mouseButton?(pressed: boolean): void; mouseMotion?(dx: number, dy: number): void; cameraLook?(): { x: number; y: number }; instruments?(speedKmh: number, rpm: number, gear: number, damageCondition?: number, engineCondition?: number, transmissionCondition?: number): void; motion?(position: THREE.Vector3, yaw: number, velocity: THREE.Vector3): void }) {
    this.stopDriving?.();
    const original = [...root.world.parts.values()].map(part => ({ part, local: part.local.clone() }));
    const keys = new Set<string>(), canvas = this.renderer.domElement;
    let crash: CarCrashDemo | undefined, obstacle: THREE.Mesh | undefined, ramp: THREE.Mesh | undefined;
    const panelViews: PanelView[] = [], softParts = new Set<EnginePart>();
    const panelParts = new Map<PanelView, EnginePart>();
    const vehicleBounds = new Map<EnginePart, THREE.Box3Helper>();
    for (const part of root.world.parts.values()) {
      const proxy = this.proxies.get(part);
      if (!proxy || !part.definition.model) continue;
      const helper = new THREE.Box3Helper(new THREE.Box3(), part.definition.mechanics ? 0x77d8ff : 0xffcf70);
      helper.visible = false; helper.renderOrder = 20; this.scene.add(helper); vehicleBounds.set(part, helper);
    }
    const localPositions = (part: EnginePart) => {
      const group = this.proxies.get(part); if (!group) throw new Error(`No render proxy for ${part.definition.alias}`);
      const transform = modelMatrix(new THREE.Matrix4(), part.definition.config.renderPose && poseMatrix(part.definition.config.renderPose));
      return group.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh).map(mesh => {
        const attribute = mesh.geometry.getAttribute('position'), out: number[] = [];
        for (let i = 0; i < attribute.count; i++) out.push(...new THREE.Vector3().fromBufferAttribute(attribute, i).applyMatrix4(transform).toArray()); return out;
      });
    };
    if (withCrash) {
      const hood = [...root.world.parts.values()].find(p => p.parent === root
        && (/(?:^|[\\/])hood(?:\.cfg|[_-])/i.test(p.definition.cfgPath)
          || /(?:^|[_-])hood(?:$|[_-])/i.test(p.definition.alias)));
      if (!hood) throw new Error('Installed hood required for crash demo');
      const samples = localPositions(hood), bounds = new THREE.Box3();
      for (const positions of localPositions(root)) for (let i = 0; i < positions.length; i += 3) bounds.expandByPoint(new THREE.Vector3().fromArray(positions, i));
      crash = new Vehicle3D(root, hood, samples.flat(), bounds, track?.terrain, track?.collision,DRIVING_PHYSICS_HZ);
      if(crash instanceof Vehicle3D)crash.suspension.helping=this.drivingHelping;
      if(crash instanceof Vehicle3D&&crash.suspension.mechanics)crash.suspension.mechanics.helping=this.drivingHelping;
      const triangles: number[] = [], inverseRoot = root.matrix().invert();
      for (const part of root.world.parts.values()) {
        if (part === hood || !part.definition.model) continue;
        const type = part.parent?.definition.config.slots.find(s => s.id === part.parentSlot)?.type;
        if (type === 11) continue;
        if (type !== undefined && type >= 101 && type <= 104) { (crash as Vehicle3D).register(part, localPositions(part).flat(), []); continue; }
        if (type !== undefined && type > 104 && type < 200) continue;
        const ownTransform = modelMatrix(new THREE.Matrix4(), part.definition.config.renderPose && poseMatrix(part.definition.config.renderPose)), ownTriangles: number[] = [];
        for (const mesh of this.proxies.get(part)?.children ?? []) if (mesh instanceof THREE.Mesh) {
          const positions = mesh.geometry.getAttribute('position'), indices = mesh.geometry.getIndex();
          if (indices) for (let i = 0; i < indices.count; i++) { const p = new THREE.Vector3().fromBufferAttribute(positions, indices.getX(i)); ownTriangles.push(...p.applyMatrix4(ownTransform).toArray()); }
        }
        const physical = this.collisionMeshes.get(part) ?? [], collision = physical.length ? physical : ownTriangles;
        (crash as Vehicle3D).register(part, localPositions(part).flat(), collision);
        if (!part.definition.mechanics) {
          const physicalFrame = inverseRoot.clone().multiply(part.matrix());
          for (let i = 0; i < collision.length; i += 3) triangles.push(...new THREE.Vector3().fromArray(collision, i).applyMatrix4(physicalFrame).toArray());
        }
      }
      crash.setBodyTriangles(triangles);
      if (track && crash instanceof Vehicle3D) { crash.disableObstacle(); crash.placeAt(track.position, track.yaw); crash.settleSpawn(); }
      for (const s of (crash as Vehicle3D).soft.values()) { softParts.add(s.part); const view = new PanelView(this.proxies.get(s.part)!, s.panel, localPositions(s.part)); panelViews.push(view); panelParts.set(view, s.part); }
      const rampGeometry = new THREE.BufferGeometry();
      rampGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-1.8, 0, -4, 1.8, 0, -4, 1.8, 1.12, -8, -1.8, 0, -4, 1.8, 1.12, -8, -1.8, 1.12, -8], 3)); rampGeometry.computeVertexNormals();
      ramp = new THREE.Mesh(rampGeometry, new THREE.MeshStandardMaterial({ color: 0x668d9d, side: THREE.DoubleSide })); ramp.visible = false; if (!track) this.model.add(ramp);
      const box = crash.obstacle, size = new THREE.Vector3(...box.max).sub(new THREE.Vector3(...box.min));
      obstacle = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.MeshStandardMaterial({ color: 0xe7a44d, roughness: 0.8 }));
      obstacle.position.copy(new THREE.Vector3(...box.min).add(new THREE.Vector3(...box.max)).multiplyScalar(0.5)); if (!track) this.model.add(obstacle);
    }
    const demo = crash?.driving ?? new DrivingDemo(root);
    this.renderRecorder=crash instanceof Vehicle3D?crash.telemetry:undefined;
    if(crash instanceof Vehicle3D)crash.telemetry.setViewSource(()=>{
      const capture=(camera:THREE.PerspectiveCamera):RouteCamera=>({position:camera.position.toArray(),rotation:camera.quaternion.toArray(),fov:camera.fov,near:camera.near,far:camera.far,unlimitedFar:camera===this.camera?this.normalCameraFar:undefined});
      return {primary:capture(this.camera),observer:this.inspection.enabled?capture(this.inspection.camera):undefined,focus:(this.mapStreamFocus??this.camera.position).toArray()};
    });
    // World objects follow the player, not the view. A cockpit or orbit camera
    // can be far enough from the car to make streaming appear stuck in one area.
    this.mapStreamFocus = demo.position;
    const tireEffects = crash instanceof Vehicle3D ? new TireEffects() : undefined;
    const vehicleAudio = crash instanceof Vehicle3D && assets ? new VehicleAudio(assets, crash, audioVolumes) : undefined;
    if (tireEffects) this.scene.add(tireEffects.group);
    let last: number | undefined, lastHud = -Infinity, stopped = false, timeScale = 1, paused = false;
    if (tireEffects && assets) void (async () => {
      const grassPath = 'particles/textures/skidmarks/sliding/grass.png';
      const looseGround = await this.texture(await assets.read(grassPath), grassPath);
      if (stopped) looseGround.dispose();
      else tireEffects.setLooseGroundTexture(looseGround);
    })().catch(() => { /* Procedural fallback remains available when particle assets are absent. */ });
    let frameMs = 1000 / 60, backlogTicks = 0;
    const reportTelemetry = telemetry;
    telemetry = text => reportTelemetry(text + (crash instanceof Vehicle3D ? `\nChassis ${Math.round(root.condition * 100)}% · supports ${crash.suspension.wheels.map((w, i) => Math.round(Math.min(w.mountCondition, crash.suspension.mechanics?.support(i) ?? 1) * 100)).join('/')}%${crash.suspension.mechanics ? `\nEngine ${crash.suspension.mechanics.running ? `${Math.round(crash.suspension.mechanics.power * 100)}%` : crash.suspension.mechanics.starting ? 'STARTER' : 'STALLED · throttle / I to start'} · ${Math.round(crash.suspension.mechanics.rpm)} rpm · gear ${crash.suspension.mechanics.gear < 0 ? 'R' : crash.suspension.mechanics.gear || 'N'} (${crash.suspension.mechanics.manual ? 'manual' : 'automatic'}) · boost ${crash.suspension.mechanics.boost.toFixed(2)} bar · slip ${Math.round(Math.max(...crash.suspension.wheels.map(w => Math.abs(w.slip))) * 100)}%` : ''}\n${Math.round(1000 / frameMs)} fps · active deformation: ${[...crash.soft.values()].filter(s => s.activity.deforming).length}/${crash.soft.size}${track && this.mapStream ? ` · nearby objects: ${this.mapStream.active}/${this.mapStream.total}` : ''}${backlogTicks ? ` · lag ${Math.round(backlogTicks * crash.clock.dt * 1000)} ms` : ''}` : ''));
    const relevant = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyN', 'KeyI', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyR']);
    const down = (event: KeyboardEvent) => {
      if (java) return;
      if (!relevant.has(event.code)) return;
      event.preventDefault(); vehicleAudio?.activate(); keys.add(event.code);
      if (event.code === 'KeyR' && !event.repeat) { if (crash) crash.reset(); else demo.reset(); tireEffects?.reset(); keys.clear(); }
    };
    const up = (event: KeyboardEvent) => { keys.delete(event.code); };
    let mousePointer: number | undefined, mouseX = 0, mouseY = 0, orbitYaw = 0, orbitPitch = 0;
    const releaseMouse = () => {
      if (mousePointer === undefined) return;
      const pointer = mousePointer; mousePointer = undefined;
      java?.mouseButton?.(false);
      if (canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
    };
    const pointerDown = (event: PointerEvent) => {
      if (!java || event.button !== 2) return;
      event.preventDefault();
      releaseMouse();
      mousePointer = event.pointerId; mouseX = event.clientX; mouseY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
      java.mouseButton?.(true);
    };
    const pointerMove = (event: PointerEvent) => {
      if (mousePointer !== event.pointerId) return;
      if (!(event.buttons & 2)) { releaseMouse(); return; }
      java?.mouseMotion?.(event.clientX - mouseX, event.clientY - mouseY);
      mouseX = event.clientX; mouseY = event.clientY;
    };
    const pointerUp = (event: PointerEvent) => { if (mousePointer === event.pointerId) releaseMouse(); };
    const contextMenu = (event: MouseEvent) => { if (java) event.preventDefault(); };
    const release = () => { keys.clear(); last = undefined; releaseMouse(); };
    const visibility = () => { release(); vehicleAudio?.suspend(document.hidden); };
    const focus = () => { vehicleAudio?.activate(); canvas.focus({ preventScroll: true }); };
    canvas.tabIndex = 0; canvas.setAttribute('aria-label', 'Vehicle controls'); canvas.addEventListener('keydown', down); canvas.addEventListener('blur', release); canvas.addEventListener('pointerdown', focus);
    canvas.addEventListener('pointerdown', pointerDown); canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerup', pointerUp); canvas.addEventListener('pointercancel', pointerUp);
    canvas.addEventListener('lostpointercapture', pointerUp); canvas.addEventListener('contextmenu', contextMenu);
    window.addEventListener('keyup', up); window.addEventListener('blur', release); document.addEventListener('visibilitychange', visibility);
    this.ground.visible = !track; this.grid.visible = false; this.driveGrid.visible = !track;
    this.model.position.set(0, 0, 0); this.model.scale.setScalar(1); this.syncWorld(softParts);
    const followed = demo.position.clone();
    const followCamera = new FollowCamera();
    const inertialCamera = new InertialCamera();
    let lastInertialCamera = this.inertialCameraEnabled;
    let cameraWasInternal = false;
    this.controls.target.copy(followed).add(new THREE.Vector3(0, 0.2, 0));
    this.camera.position.copy(this.controls.target).add(withCrash ? new THREE.Vector3(7, 4, -3) : new THREE.Vector3(5, 3, 7)); this.controls.update();
    if (java) this.controls.enabled = false;
    const pressed = (...codes: string[]) => codes.some(code => keys.has(code)) ? 1 : 0;
    this.frame = now => {
      if (document.hidden) { last = undefined; return; }
      // Long wall-clock pauses pause this local demo; no catch-up burst after tab switching.
      const firstFrame = last === undefined;
      const elapsed = last === undefined ? 0 : Math.max(0, (now - last) / 1000);
      // Preserve foreground elapsed time; the fixed clock retains debt above its tick budget.
      const seconds = paused ? 0 : crash instanceof Vehicle3D ? elapsed : Math.min(elapsed, 0.1); last = now;
      if (elapsed > 0 && !paused) frameMs += (elapsed * 1000 - frameMs) * 0.1;
      const input = java ? java.sample() : { throttle: pressed('KeyW', 'ArrowUp') - pressed('KeyS', 'ArrowDown'), steerDigital: true, steer: pressed('KeyA', 'ArrowLeft') - pressed('KeyD', 'ArrowRight'), brake: keys.has('Space'), clutch: pressed('ShiftLeft', 'ShiftRight') > 0, gearUp: keys.has('KeyE'), gearDown: keys.has('KeyQ'), neutral: keys.has('KeyN'), start: keys.has('KeyI') };
      if (crash) { if (!paused) backlogTicks = crash.advance(seconds * timeScale, input).backlogTicks; this.profiler.measure('Vehicle render geometry CPU',()=>{ for (const view of panelViews) { const part = panelParts.get(view)!; view.update(part.matrix(), crash instanceof Vehicle3D && !crash.soft.get(part)!.activity.deforming); } }); if (crash instanceof Vehicle3D) { if (ramp) ramp.visible = crash.terrain.ramp; if (obstacle) obstacle.position.copy(new THREE.Vector3(...crash.obstacle.min).add(new THREE.Vector3(...crash.obstacle.max)).multiplyScalar(0.5)); tireEffects?.update(seconds * timeScale, crash.suspension.wheels, crash.velocity().length()); } } else demo.advance(seconds, input);
      if (crash instanceof Vehicle3D && !paused) {
        for (const name of ['suspension', 'contacts', 'panels', 'other'] as const)
          this.profiler.record(`Physics ${name}`, crash.timings[name]);
        for (const [key, title] of [['panelSolve', 'Panel solve + contacts'], ['panelSurface', 'Body collision mesh'], ['panelSleep', 'Panel sleep checks']] as const)
          this.profiler.record(title, crash.timings[key]);
        if(crash.telemetry.status.recording)for(const [key,title] of [['panelConstraints','XPBD constraints CPU'],['panelContacts','Panel contacts CPU'],['panelUpload','WASM input upload CPU'],['panelIntegration','Panel integration + finalize CPU'],['looseContacts','Loose body contacts CPU']] as const)this.profiler.record(title,crash.timings[key]);
        const backends = new Set([...crash.soft.values()].map(part => part.panel.backend === 'wasm' ? 'C++/WASM' : 'TypeScript'));
        const loose = [...crash.soft.values()].filter(part => !part.root && !part.part.parent);
        this.physicsWork = `Physics rate: ${crash.physicsFrequency} Hz · step ${(crash.physicsDt*1000).toFixed(3)} ms · XPBD iterations ${XPBD_ITERATIONS}\nPhysics clock: ${crash.simulationTime.toFixed(3)} s / target ${crash.simulationTargetSeconds.toFixed(3)} s · pending ${(crash.simulationPendingSeconds*1000).toFixed(1)} ms · budget ${crash.maxPhysicsSteps} ticks\nPhysics ticks ${crash.timings.ticks} · XPBD panel solves ${crash.timings.activePanels} · body refits ${crash.timings.surfaceUpdates}\nSoft-body solver: ${[...backends].join(' + ')} · sleeping debris ${loose.filter(part => part.activity.resting).length}/${loose.length}`;
      }
      const timeOfDay = java?.timeOfDay?.() ?? (this.lighting.direction.y < 0.1 ? 0 : 12 * 3600);
      const night = isNightTime(timeOfDay);
      if (this.lighting.setNightShadows(this.renderer, this.sunLight, night)) {
        this.staticMapShadows.setNightQuality(night);
        this.scene.traverse(object => {
          if (object instanceof THREE.Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.needsUpdate = true;
        });
      }
      root.world.lightMask = drivingLightMask(root.world.lightMask, input.brake,
        crash instanceof Vehicle3D && crash.suspension.mechanics?.gear === -1,
        crash instanceof Vehicle3D && !!crash.suspension.mechanics?.running,
        timeOfDay);
      this.profiler.measure('Vehicle world sync CPU',()=>this.syncWorld(softParts));
      for (const [part, helper] of vehicleBounds) {
        if (!helper.visible) continue;
        const proxy = this.proxies.get(part);
        if (proxy) { helper.box.setFromObject(proxy); helper.updateMatrixWorld(true); }
      }
      if (java) {
        if (lastInertialCamera !== this.inertialCameraEnabled) {
          followCamera.reset(); inertialCamera.reset(); lastInertialCamera = this.inertialCameraEnabled;
        }
        const mode = java.cameraMode(), yaw = crash instanceof Vehicle3D
          ? new THREE.Euler().setFromQuaternion(crash.body.orientation, 'YXZ').y : demo.yaw;
        const internalPose = mode === 5 ? root.definition.config.cameras[java.cameraIndex?.() ?? 0] : undefined;
        if (internalPose) {
          cameraWasInternal = true;
          followCamera.reset();
          inertialCamera.reset();
          const frame = root.matrix().multiply(poseMatrix(internalPose));
          frame.decompose(this.camera.position, this.camera.quaternion, new THREE.Vector3());
          this.controls.target.copy(this.camera.position).add(new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion));
          // CFG camera's optional value is a game-specific zoom parameter, not
          // a Three.js field-of-view in degrees. Keep the renderer's normal FOV.
          const fieldOfView = 42;
          if (this.camera.near !== 0.03 || this.camera.fov !== fieldOfView) {
            this.camera.near = 0.03;
            this.camera.fov = fieldOfView;
            this.camera.updateProjectionMatrix();
          }
        } else {
          if (this.camera.near !== 0.01 || this.camera.fov !== 42) {
            this.camera.near = 0.01;
            this.camera.fov = 42;
            this.camera.updateProjectionMatrix();
          }
          const distance = java.cameraDistance?.() ?? 7;
          const offset = mode === 4 ? new THREE.Vector3(0, 3, -11)
            : mode === 3 ? new THREE.Vector3(0, 3.5, 12)
            : new THREE.Vector3(0, 2.5, distance);
          const look = java.cameraLook?.();
          if (look && mode !== 5) {
            orbitYaw += look.x * 0.3;
            orbitPitch = THREE.MathUtils.clamp(orbitPitch - look.y * 0.3, -1.1, 1.1);
            const relative = offset.sub(new THREE.Vector3(0, 1.1, 0));
            const radius = relative.length();
            const elevation = THREE.MathUtils.clamp(Math.atan2(relative.y, Math.hypot(relative.x, relative.z)) + orbitPitch, -1.35, 1.35);
            const azimuth = Math.atan2(relative.x, relative.z) + orbitYaw;
            relative.set(radius * Math.cos(elevation) * Math.sin(azimuth), radius * Math.sin(elevation), radius * Math.cos(elevation) * Math.cos(azimuth));
            offset.add(new THREE.Vector3(0, 1.1, 0));
          }
          offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
          const target = demo.position.clone().add(new THREE.Vector3(0, 1.1, 0));
          offset.y -= 1.1;
          if (this.inertialCameraEnabled)
            inertialCamera.update(this.camera.position, this.controls.target, target, offset, seconds, 5, firstFrame || cameraWasInternal);
          else followCamera.update(this.camera.position, this.controls.target, target, offset, seconds, mode === 1 ? 5 : 9, firstFrame);
          cameraWasInternal = false;
          this.camera.lookAt(this.controls.target);
        }
      } else {
        const delta = demo.position.clone().sub(followed); this.camera.position.add(delta); this.controls.target.add(delta);
      }
      followed.copy(demo.position);
      if(crash instanceof Vehicle3D)crash.telemetry.recordView();
      if (java) java.motion?.(demo.position, crash instanceof Vehicle3D
        ? new THREE.Euler().setFromQuaternion(crash.body.orientation, 'YXZ').y : demo.yaw,
      crash ? crash.velocity() : new THREE.Vector3());
      vehicleAudio?.update(this.camera, input.throttle, paused);
      if (java) java.instruments?.(Math.round(crash ? crash.velocity().length() * 3.6 : Math.abs(demo.speed) * 3.6),
        crash instanceof Vehicle3D ? crash.suspension.mechanics?.rpm ?? 0 : 0,
        crash instanceof Vehicle3D ? crash.suspension.mechanics?.gear ?? 0 : 0,
        crash instanceof Vehicle3D ? crash.osdDamageCondition : 1,
        crash instanceof Vehicle3D ? crash.suspension.mechanics?.block?.condition ?? 1 : 1,
        crash instanceof Vehicle3D ? transmissionCondition(crash.suspension.mechanics?.transmission) : 1);
      if (now - lastHud > 100) {
        const intact = crash?.panel.mounts.filter(m => !m.broken).length;
        const up = crash instanceof Vehicle3D ? new THREE.Vector3(0, 1, 0).applyQuaternion(crash.body.orientation).y : 1;
        telemetry(`${Math.round(crash ? crash.velocity().length() * 3.6 : Math.abs(demo.speed) * 3.6)} km/h${crash instanceof Vehicle3D ? ` · supported wheels ${crash.suspension.wheels.filter(w => w.contact).length}/4\nHood: ${crash.hood.parent ? 'attached' : 'detached'} · mounts ${intact}/${crash.panel.mounts.length} · stops ${crash.panel.supports.length}\nDented panels: ${[...crash.soft.values()].filter(s => s.panel.plasticBeams > 0).length} · detached parts: ${[...crash.soft.keys(), ...crash.rigid.keys()].filter(p => p !== root && !p.parent).length}\nChassis: ${up < -0.5 ? 'upside down' : up < 0.5 ? 'on its side' : crash.suspension.wheels.every(w => !w.contact) ? 'airborne' : 'on wheels'}` : crash ? ` · impact ${Math.round(crash.impactSpeed * 3.6)} km/h\nHood: ${crash.hood.parent ? 'attached' : 'separate part'}` : ` · ${demo.speed < -0.1 ? 'reverse' : 'forward'}`}`); lastHud = now;
      }
    };
    const stop = () => {
      if (stopped) return; stopped = true;
      if (this.mapStreamFocus === demo.position) this.mapStreamFocus = undefined;
      this.frame = undefined; this.stopDriving = undefined;
      if(crash instanceof Vehicle3D&&this.renderRecorder===crash.telemetry)this.renderRecorder=undefined;
      releaseMouse();
      canvas.removeEventListener('keydown', down); canvas.removeEventListener('blur', release); canvas.removeEventListener('pointerdown', focus);
      canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointercancel', pointerUp);
      canvas.removeEventListener('lostpointercapture', pointerUp); canvas.removeEventListener('contextmenu', contextMenu);
      window.removeEventListener('keyup', up); window.removeEventListener('blur', release); document.removeEventListener('visibilitychange', visibility);
      canvas.removeAttribute('tabindex'); canvas.removeAttribute('aria-label'); keys.clear();
      if (java) this.controls.enabled = true;
      for (const [part, visible] of bodyPartVisibility) { const proxy = this.proxies.get(part); if (proxy) proxy.visible = visible; }
      root.world.lightMask &= ~7;
      panelViews.forEach(v => v.dispose()); tireEffects?.dispose(); vehicleAudio?.dispose(); crash?.dispose();
      for (const helper of vehicleBounds.values()) { helper.removeFromParent(); helper.geometry.dispose(); (helper.material as THREE.Material).dispose(); }
      if (obstacle) { obstacle.removeFromParent(); obstacle.geometry.dispose(); (obstacle.material as THREE.Material).dispose(); }
      if (ramp) { ramp.removeFromParent(); ramp.geometry.dispose(); (ramp.material as THREE.Material).dispose(); }
      if (!track) for (const { part, local } of original) part.local.copy(local);
      this.ground.visible = false; this.grid.visible = !track; this.driveGrid.visible = false; this.syncWorld();
      if (track) { this.controls.target.copy(track.position); this.camera.position.copy(track.position).add(new THREE.Vector3(12, 7, 12)); this.controls.update(); }
      else this.fit();
    };
    this.stopDriving = stop; focus();
    const breakPart = (part?: EnginePart) => { if (crash instanceof Vehicle3D && part) { part.condition = 0; crash.advance(crash.physicsDt, { throttle: 0, steer: 0, brake: false }); last = undefined; focus(); } };
    // In body-shell mode retain only mechanical parts and assemblies mounted in wheel slots.
    const bodyPartVisibility = new Map([...this.proxies].map(([part, proxy]) => [part, proxy.visible] as const));
    const skeletonParts = new Set<EnginePart>();
    for (const part of root.world.parts.values()) {
      const slotType = part.parent?.definition.config.slots.find(s => s.id === part.parentSlot)?.type;
      if (part.definition.mechanics || slotType !== undefined && slotType >= 101 && slotType < 200) skeletonParts.add(part);
    }
    const setBodyShellVisible = (visible: boolean) => {
      for (const part of bodyPartVisibility.keys()) {
        const proxy = this.proxies.get(part);
        if (proxy) proxy.visible = visible || skeletonParts.has(part);
      }
    };
    const teleport = (position: THREE.Vector3, yaw = 0) => {
      if (crash instanceof Vehicle3D) crash.placeAt(position, yaw);
      else { demo.position.copy(position); demo.yaw = yaw; demo.speed = 0; demo.sync(); }
      tireEffects?.reset(); keys.clear(); last = undefined; followed.copy(position);
      this.controls.target.copy(position).add(new THREE.Vector3(0, 1.1, 0));
      this.camera.position.copy(position).add(new THREE.Vector3(0, 3, 9).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
      this.camera.lookAt(this.controls.target); this.controls.update();
      java?.motion?.(position, yaw, new THREE.Vector3()); focus();
    };
    return Object.assign(stop, { vehicle: crash instanceof Vehicle3D ? crash : undefined, telemetry: crash instanceof Vehicle3D ? crash.telemetry : undefined, telemetryContext: () => ({ map_pack: this.mapPackPath ?? 'test_area', environment_map:this.environmentPath??'', graphics_settings: this.graphicsDebugLines().join(' | ') }), focusControls: focus, teleport, rear: () => { if (crash instanceof Vehicle3D) crash.rearCrash(); tireEffects?.reset(); keys.clear(); last = undefined; focus(); }, launch: (speed: number) => { crash?.reset(speed); tireEffects?.reset(); keys.clear(); last = undefined; focus(); }, chassisCrumple: (value: number) => { if (crash instanceof Vehicle3D) crash.setChassisCrumple(value); }, tireModel: (value: import('../engine/tire-model').TireModelSettings) => { if (crash instanceof Vehicle3D) crash.suspension.tireModel = structuredClone(value); }, engineTuning: (idle: number, redline: number) => { if (crash instanceof Vehicle3D) crash.suspension.mechanics?.setTuning(idle, redline); }, jump: () => { if (crash instanceof Vehicle3D) crash.jump(); tireEffects?.reset(); keys.clear(); last = undefined; focus(); }, roll: () => { if (crash instanceof Vehicle3D) crash.roll(); tireEffects?.reset(); keys.clear(); last = undefined; focus(); }, drop: () => { crash?.dropOnRoof(); tireEffects?.reset(); keys.clear(); last = undefined; focus(); }, breakEngine: () => breakPart(crash instanceof Vehicle3D ? crash.suspension.mechanics?.block : undefined), breakStrut: () => breakPart(crash instanceof Vehicle3D ? crash.suspension.mechanics?.corners[0].strut : undefined), wireframe: (value: boolean) => panelViews.forEach(v => v.wireframe(value)), vehicleFrames: (value: boolean) => vehicleBounds.forEach(helper => { helper.visible = value; }), bodyVisible: setBodyShellVisible, diagnostics: () => ({ position: { x: demo.position.x, y: demo.position.y, z: demo.position.z }, speedKmh: Math.round(crash ? crash.velocity().length() * 3.6 : Math.abs(demo.speed) * 3.6), rpm: crash instanceof Vehicle3D ? Math.round(crash.suspension.mechanics?.rpm ?? 0) : 0, gear: crash instanceof Vehicle3D ? crash.suspension.mechanics?.gear ?? 0 : 0, boost: crash instanceof Vehicle3D ? crash.suspension.mechanics?.boost ?? 0 : 0, engineStarting: crash instanceof Vehicle3D ? crash.suspension.mechanics?.starting ?? false : false, engineRunning: crash instanceof Vehicle3D ? crash.suspension.mechanics?.running ?? false : false, enginePower: crash instanceof Vehicle3D ? crash.suspension.mechanics?.power ?? 0 : 0, wheelSlip: crash instanceof Vehicle3D ? Math.max(...crash.suspension.wheels.map(w => Math.abs(w.slip))) : 0, wheelContacts: crash instanceof Vehicle3D ? crash.suspension.wheels.filter(w => w.contact).length : 0, chassis: Math.round(root.condition * 100), engineBlock: Math.round((crash instanceof Vehicle3D ? crash.suspension.mechanics?.block?.condition ?? 1 : 1) * 100), transmission: Math.round((crash instanceof Vehicle3D ? transmissionCondition(crash.suspension.mechanics?.transmission) : 1) * 100), parts: [...root.world.parts.values()].map(part => ({ alias: part.definition.alias, id: part.definition.key.id, slot: part.parentSlot, wear: Math.round(part.condition * 100), mechanical: !!part.definition.mechanics })) }), slowMotion: (value: boolean) => { timeScale = value ? 0.25 : 1; }, pause: (value: boolean) => { if(paused!==value)last=undefined;paused = value; } });
  }
  /** Reuses the host renderer/physics with plain recorded inputs; no Java callbacks. */
  playRouteBenchmark(root:EnginePart,route:RouteBenchmark,map:{terrain:MapTerrain;collision:MapCollision},mode:RouteMode,
    progress:(message:string)=>void,complete:(report:string,looping?:boolean)=>void,loop:()=>boolean=()=>false){
    this.inspectionManualOverride=false;
    const playback=new RoutePlayback(route),first=playback.pose(0),focus=new THREE.Vector3();
    const reference=routeSourceSummary(route);
    this.routeReferenceLines=[mode==='render'?'Render route: physics OFF':mode==='physics'?'Physics along route: 100 ms state checkpoints (not a free driving replay)':'Free physics controls: stops if positional drift exceeds 2 m',
      ...(typeof route.metadata.environment_map==='string'?[]:['Legacy route: stock daytime environment substituted; original environment was not recorded.']),
      reference?`Original recording: ${reference.mean_fps.toFixed(1)} FPS · p95 ${reference.p95_ms.toFixed(1)} ms · ${reference.width} × ${reference.height}`:'Original frame timings unavailable in this recording; record again for a measured comparison.',
      ...(reference?[`Original average draws ${Math.round(reference.average_draws)} · triangles ${Math.round(reference.average_triangles)}`]:[])];
    let vehicle:Vehicle3D|undefined;
    const session=this.drive(root,()=>{},true,{...map,position:new THREE.Vector3().fromArray(first.position),yaw:0},undefined,undefined,
      {sample:()=>playback.input(vehicle?.simulationTime??0),cameraMode:()=>1});
    vehicle=session.vehicle;
    if(!vehicle){session();throw Error('Physical vehicle required');}
    const car=vehicle,liveFrame=this.frame!,originalFar=this.normalCameraFar,originalInspection=this.inspection.enabled;
    const originalParts=[...root.world.parts.values()];
    route.vehicle.parts.forEach((saved,i)=>{if(originalParts[i])originalParts[i].condition=saved.condition;});
    car.body.center.fromArray(route.vehicle.bodyCenter);car.body.setMass(route.vehicle.mass);
    if(typeof route.metadata.tire_settings==='string')car.suspension.tireModel=JSON.parse(route.metadata.tire_settings);
    if(car.suspension.mechanics){
      for(const [key,value] of [['idleRpm',route.metadata.idle_rpm],['redlineRpm',route.metadata.redline_rpm]] as const){
        if(!Number.isFinite(Number(value))||Number(value)<=0){session();throw Error('Invalid recorded engine RPM range');}
        car.suspension.mechanics[key]=Number(value);
      }
    }
    const applyPose=(pose:RoutePose)=>{
      car.body.setFrame(routeBodyMatrix(pose,car.body.center));car.body.velocity.fromArray(pose.velocity);
      car.body.setAngularVelocity(new THREE.Vector3().fromArray(pose.angularVelocity));root.local.copy(car.body.matrix());
      const m=car.suspension.mechanics!;m.rpm=pose.rpm;m.gear=pose.gear;m.running=pose.running;m.manual=pose.manual;m.temperature=pose.temperature;
      car.suspension.steer=pose.steer;
      car.suspension.wheels.forEach((wheel,i)=>{const w=pose.wheels[i];wheel.omega=w.omega;wheel.spin=w.spin;wheel.length=w.length;wheel.nativeSlip.longitudinal=w.slip;wheel.nativeSlip.angle=w.angle;});
      car.suspension.sync();car.driving.position.setFromMatrixPosition(root.local);
      car.driving.yaw=new THREE.Euler().setFromQuaternion(car.body.orientation,'YXZ').y;car.driving.speed=car.body.velocity.length();
      car.syncRecordedPose();
    };
    const applyView=(time:number,preserveObserver=false)=>{
      const view=playback.view(time),set=(camera:THREE.PerspectiveCamera,saved:RouteCamera)=>{
        camera.position.fromArray(saved.position);camera.quaternion.fromArray(saved.rotation);camera.fov=saved.fov;camera.near=saved.near;camera.far=saved.far;camera.updateProjectionMatrix();camera.updateMatrixWorld();
      };
      set(this.camera,view.primary);this.normalCameraFar=view.primary.unlimitedFar??view.primary.far;
      if(!preserveObserver&&!this.inspectionManualOverride){this.inspection.setEnabled(!!view.observer,focus);if(view.observer)set(this.inspection.camera,view.observer);this.inspection.replay=true;}
      this.controls.enabled=false;focus.fromArray(view.focus);this.mapStreamFocus=focus;
    };
    applyPose(first);session.pause(true);this.physicsWork=mode==='render'?'Physics paused (render route)':'';car.replayInput=time=>playback.input(time);
    let checkpoints=new RouteCheckpoints();
    if(mode==='physics')car.beforeReplayTick=time=>checkpoints.apply(time,car.body.position,playback,
      pose=>this.profiler.measure('Replay checkpoint CPU',()=>applyPose(pose)));
    const updateStatus=(message:string)=>{this.routeStatus=message;progress(message);};
    let warmup=0,time=0,last:number|undefined,lastUi=-Infinity,finished=false,stopped=false,reset=false,aborted=false,maxPending=0,lap=1,restart=false;
    const windowEvents:{at_s:number;kind:string}[]=[];
    const visibility=()=>{last=undefined;if(windowEvents.length<128)windowEvents.push({at_s:time,kind:document.hidden?'hidden':'visible'});};
    const focusEvent=()=>{if(windowEvents.length<128)windowEvents.push({at_s:time,kind:document.hasFocus()?'focus':'blur'});};
    document.addEventListener('visibilitychange',visibility);window.addEventListener('focus',focusEvent);window.addEventListener('blur',focusEvent);
    const intervals:number[]=[],draws:number[]=[],triangles:number[]=[],occlusionDraws:number[]=[],occlusionTriangles:number[]=[];let driftSquared=0,maxDrift=0,driftSamples=0;
    this.frame=now=>{
      if(document.hidden){last=undefined;return;}
      if(restart){
        restart=false;lap++;time=0;finished=false;last=undefined;lastUi=-Infinity;
        intervals.length=draws.length=triangles.length=occlusionDraws.length=occlusionTriangles.length=windowEvents.length=0;
        driftSquared=maxDrift=driftSamples=maxPending=0;checkpoints=new RouteCheckpoints();
        if(mode!=='render'){car.reset();route.vehicle.parts.forEach((saved,i)=>{originalParts[i].condition=saved.condition;});car.body.center.fromArray(route.vehicle.bodyCenter);car.body.setMass(route.vehicle.mass);}
        applyPose(first);session.pause(true);liveFrame(now);applyView(0);reset=true;
        updateStatus(`Loop ${lap} · ${mode} · 0.0 / ${playback.duration.toFixed(1)} s`);return;
      }
      const elapsed=last===undefined?0:Math.max(0,(now-last)/1000);last=now;
      if(warmup<3){warmup+=elapsed;applyPose(first);liveFrame(now);applyView(0);reset=warmup>=3;if(now-lastUi>250){lastUi=now;updateStatus(`Warming up · ${Math.min(3,warmup).toFixed(1)} / 3 s`);}return;}
      if(finished){session.pause(true);liveFrame(now);applyView(time,true);return;}
      if(elapsed>0)intervals.push(elapsed*1000);
      if(mode==='render'){time=Math.min(playback.duration,time+elapsed);applyPose(playback.pose(time));}
      liveFrame(now);
      if(mode!=='render'){
        maxPending=Math.max(maxPending,car.simulationPendingSeconds);
        time=Math.min(playback.duration,car.simulationTime);
        const drift=car.body.position.distanceTo(new THREE.Vector3().fromArray(playback.pose(time).position));
        driftSquared+=drift*drift;maxDrift=Math.max(maxDrift,drift);driftSamples++;
        if(mode==='free-physics'&&drift>2){aborted=true;finished=true;session.pause(true);}
      }
      applyView(time);
      if(now-lastUi>250){lastUi=now;updateStatus(`${loop()||lap>1?`Loop ${lap} · `:''}${mode} · ${time.toFixed(1)} / ${playback.duration.toFixed(1)} s`);}
      if(time>=playback.duration){finished=true;session.pause(true);}
    };
    this.afterFrame=()=>{
      if(reset){reset=false;this.profiler.resetMeasurements();last=undefined;session.pause(mode==='render');return;}
      if(warmup<3||!intervals.length||stopped)return;
      draws.push(this.renderer.info.render.calls);triangles.push(this.renderer.info.render.triangles);occlusionDraws.push(this.gpuOcclusion.extraDraws);occlusionTriangles.push(this.gpuOcclusion.extraTriangles);
      if(!finished)return;
      const looping=loop()&&!aborted;
      if(!looping)this.afterFrame=undefined;
      const sorted=[...intervals].sort((a,b)=>a-b),percentile=(p:number)=>sorted[Math.max(0,Math.ceil(sorted.length*p)-1)];
      const mean=(values:number[])=>values.reduce((sum,v)=>sum+v,0)/values.length;
      complete(JSON.stringify({format:'slrr-route-result',version:1,mode,map:route.metadata.map_pack,duration_s:playback.duration,
        warmup_s:lap===1?3:0,lap,looping,observer_override:this.inspectionManualOverride,source_render:reference,java_game_loop:false,physics:mode!=='render',status:aborted?'aborted_reference_drift':'finished',played_s:time,
        checkpoints:mode==='physics'?{interval_s:.1,count:checkpoints.count,rms_correction_m:checkpoints.rmsCorrection,max_correction_m:checkpoints.maxCorrection}:undefined,
        frames:intervals.length,mean_fps:1000/mean(intervals),frame_ms:{mean:mean(intervals),p50:percentile(.5),p95:percentile(.95),p99:percentile(.99),max:sorted.at(-1)},
        physics_timing:mode!=='render'?{wall_s:intervals.reduce((sum,v)=>sum+v,0)/1000,simulated_s:car.simulationTime,target_s:car.simulationTargetSeconds,
          pending_s:car.simulationPendingSeconds,max_pending_s:maxPending,fixed_dt_s:car.physicsDt,max_steps_per_frame:car.maxPhysicsSteps}:undefined,
        average_draws:mean(draws),average_triangles:mean(triangles),average_occlusion_draws:mean(occlusionDraws),average_total_draws:mean(draws)+mean(occlusionDraws),average_total_triangles:mean(triangles)+mean(occlusionTriangles),physics_drift_m:mode!=='render'?{rms:Math.sqrt(driftSquared/driftSamples),max:maxDrift}:undefined,
        frame_intervals_ms:intervals,window_events:windowEvents,gpu_occlusion:this.gpuOcclusion.stats(),render_profile:{gpu_hiz_occlusion:this.gpuOcclusion.enabled,shared_materials:this.sharedMapMaterials,early_main_culling:this.earlyMapCulling,tight_frustum:this.tightMapFrustum,unified_building_materials:this.mapUnifiedBuildingMaterials,global_facade_batches:this.mapGlobalFacadeBatching,precached_object_cells:this.precachedObjectCells,object_cell_size_m:this.objectCellSize,hide_trees:this.hideMapTrees,hidden_object_categories:[...this.hiddenMapCategories].sort()},timing_summary:this.profiler.summary(),graphics:[...this.profiler.lines(),...this.graphicsDebugLines()],limitations:route.limitations},null,2),looping);
      if(looping){restart=true;updateStatus(`Loop ${lap} complete · ${Math.round(1000/mean(intervals))} FPS · restarting`);return;}
      updateStatus(aborted?`Stopped at ${time.toFixed(1)} s: drift ${maxDrift.toFixed(2)} m exceeds 2 m. This is not a completed route benchmark.`:`Finished · ${Math.round(1000/mean(intervals))} FPS · p95 ${percentile(.95).toFixed(1)} ms`);
    };
    const stop=()=>{if(stopped)return;stopped=true;this.afterFrame=undefined;car.replayInput=undefined;car.beforeReplayTick=undefined;
      document.removeEventListener('visibilitychange',visibility);window.removeEventListener('focus',focusEvent);window.removeEventListener('blur',focusEvent);
      this.inspectionManualOverride=false;this.inspection.replay=false;this.inspection.setEnabled(originalInspection,focus);this.normalCameraFar=originalFar;
      if(this.mapStreamFocus===focus)this.mapStreamFocus=undefined;session();};
    this.stopDriving=stop;
    return Object.assign(stop,{seek:(seconds:number)=>{
      if(stopped||!Number.isFinite(seconds))return;
      time=Math.max(0,Math.min(playback.duration,seconds));finished=true;session.pause(true);this.afterFrame=undefined;
      applyPose(playback.pose(time));applyView(time);this.physicsWork='Preview: physics paused';
      updateStatus(`Preview ${time.toFixed(1)} / ${playback.duration.toFixed(1)} s (not a timed benchmark)`);
    }});
  }
  private disposeGroup(group: THREE.Group): void {
    group.traverse(object => {
      object.userData.disposeVehicleLight?.();
      if (object instanceof Lensflare) return;
      if (object instanceof THREE.Sprite) { object.material.map?.dispose(); object.material.dispose(); return; }
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => { material.map?.dispose(); material.userData.detailTexture?.dispose(); material.userData.reflectionTexture?.dispose(); material.userData.bakedLightmapTexture?.dispose(); material.dispose(); });
    });
    group.clear();
  }
  private configureSkyMaterial(material: THREE.Material): void {
    material.userData.sky = true;
    const fogColor = new THREE.Color(this.mapFog.color);
    const fogEnabled = { value: this.mapFogEnabled ? 1 : 0 };
    this.skyFogUniforms.add({ color: fogColor, enabled: fogEnabled });
    const previousCompile = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      previousCompile.call(material, shader, renderer);
      shader.uniforms.slrrSkyFogColor = { value: fogColor };
      shader.uniforms.slrrSkyFogEnabled = fogEnabled;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vSlrrSkyElevation;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvec3 slrrSkyWorldPosition = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvSlrrSkyElevation = normalize( slrrSkyWorldPosition - cameraPosition ).y;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 slrrSkyFogColor;\nuniform float slrrSkyFogEnabled;\nvarying float vSlrrSkyElevation;')
        .replace('#include <opaque_fragment>', 'float slrrHorizonFog = ( 1.0 - smoothstep( -0.015, 0.14, vSlrrSkyElevation ) ) * slrrSkyFogEnabled;\noutgoingLight = mix( outgoingLight, slrrSkyFogColor, slrrHorizonFog );\n#include <opaque_fragment>');
    };
    const previousKey = material.customProgramCacheKey.bind(material);
    material.customProgramCacheKey = () => `${previousKey()}slrr-sky-horizon-fog-v1`;
    material.depthWrite = false;
    material.needsUpdate = true;
  }
  private async append(model: ScxModel, assets: Assets, textures: string[], target: THREE.Group, generation: number, mapSurface = false, wanted = () => true, paintColor?: number, paint?: PartPaint, dynamicCaster = false): Promise<string[]> {
    const boundTextures = partPaintTextures(textures, paint);
    const warnings = [...model.warnings];
    if (!model.meshes.length) return warnings;
    const mapTextures = this.mapTextures;
    const vehicleTextures = this.vehicleTextures;
    const loadTexture = (bytes: Uint8Array, path: string) => mapSurface
      ? mapTextures.acquire(normalizePath(path), () => this.texture(bytes, path))
      : vehicleTextures.acquire(assets, path, () => this.texture(bytes, path));
    for (const part of model.meshes) {
      if (!wanted()) break;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(part.normals, 3));
      if (part.colors) geometry.setAttribute('slrrColor', new THREE.BufferAttribute(part.colors, 3, true));
      const primaryChannel = part.textureMap?.channel ?? part.textureChannel ?? 0;
      const uv = primaryChannel === 1 ? part.uv2 : primaryChannel === 2 ? part.uv3 : part.uv;
      geometry.setAttribute('uv', new THREE.BufferAttribute(uv ?? part.uv, 2));
      if (!uv) warnings.push(`SCX ${part.name}: UV channel ${primaryChannel} missing; using UV1`);
      geometry.setIndex(new THREE.BufferAttribute(part.indices, 1));
      if (!part.normals.some(n => n !== 0)) geometry.computeVertexNormals();
      const color = part.diffuse.slice(0, 3).map(n => Math.max(0, Math.min(1, n)));
      const opacity = Math.max(0, Math.min(1, part.diffuse[3] ?? 1));
      const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(color[0], color[1], color[2]), roughness: 0.65, metalness: 0.12, side: THREE.DoubleSide, opacity, transparent: opacity < 1, depthWrite: opacity === 1 });
      this.lighting.configureMaterial(material, !!part.colors, !!part.paintMask || scxUsesVertexPaintMask(model.version, part.materialFlags),
        part.paintMask ? paintColor === undefined ? material.color.clone() : new THREE.Color(paintColor & 0xffffff) : undefined);
      if(mapSurface)this.mapDistanceCutoff.configure(material);
      const mesh = new THREE.Mesh(geometry, material); mesh.name = part.name; target.add(mesh);
      mesh.castShadow = dynamicCaster && opacity === 1; mesh.receiveShadow = true;
      const diffuseIndex = diffuseTextureIndex(part.textureIndex,boundTextures);
      const file = boundTextures[diffuseIndex];
      if (paint && textures.findIndex(path => normalizePath(path) === normalizePath(paint.from)) === diffuseIndex)
        { material.userData.paintDefault = paint.from; material.userData.vehicleReflective = true; material.roughness = 0.24; }
      if (file) {
        try {
          const selected = await stockContainerTexture(part, file, await assets.read(file), assets);
          const texture = await loadTexture(selected.bytes, selected.path);
          if (generation !== this.generation) { texture.dispose(); return warnings; }
          if (part.textureMap) {
            texture.repeat.set(part.textureMap.scaleU, part.textureMap.scaleV);
            texture.offset.set(part.textureMap.offsetU, part.textureMap.offsetV);
          }
          const alphaKey = selected.path.toLowerCase();
          let alpha = this.alphaModes.get(alphaKey);
          if (!alpha) { alpha = textureAlphaMode(selected.bytes, selected.path, texture.image); this.alphaModes.set(alphaKey, alpha); }
          texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          material.map = texture; material.color.set(0xffffff); material.needsUpdate = true;
          const alphaEnabled = !part.paintMask && scxDiffuseUsesAlpha(model.version, part.materialFlags);
          if (alphaEnabled && alpha === 'cutout') { material.alphaTest = 0.5; material.transparent = opacity < 1; material.depthWrite = opacity === 1; }
          // Stock map textures such as cross.dds and falak*.dds carry an unused
          // or reflection alpha channel. Keep fully opaque map materials solid;
          // foliage cutouts above and explicit material opacity still apply.
          else if (alphaEnabled && alpha === 'blend' && (!mapSurface || opacity < 1)) { material.transparent = true; material.depthWrite = false; }
        } catch (e) { warnings.push(`Texture ${file}: ${e}`); }
      }
      let secondLayer: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | undefined;
      const layerFile = part.layer2Index === 0xffff ? undefined : textures[part.layer2Index ?? -1];
      if (layerFile) {
        try {
          const bytes = await assets.read(layerFile), texture = await loadTexture(bytes, layerFile);
          if (generation !== this.generation) { texture.dispose(); return warnings; }
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          const alpha = textureAlphaMode(bytes, layerFile, texture.image);
          const layerUv = part.layer2Channel === 1 ? part.uv2 : part.layer2Channel === 2 ? part.uv3 : part.uv;
          if (!layerUv) throw new Error(`SCX ${part.name}: layer2 UV channel ${part.layer2Channel} missing`);
          if (!file) {
            geometry.setAttribute('uv', new THREE.BufferAttribute(layerUv, 2));
            material.map = texture; material.color.set(0xffffff); material.needsUpdate = true;
            if (alpha === 'cutout') material.alphaTest = 0.5;
            else if (alpha === 'blend') { material.transparent = true; material.depthWrite = false; }
          } else if (alpha !== 'opaque') {
            const layerGeometry = geometry.clone();
            layerGeometry.setAttribute('uv', new THREE.BufferAttribute(layerUv, 2));
            const layerMaterial = new THREE.MeshStandardMaterial({ map: texture, color: 0xffffff,
              roughness: 0.85, metalness: 0, side: THREE.DoubleSide, transparent: true,
              depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
            const layer = new THREE.Mesh(layerGeometry, layerMaterial);
            secondLayer = layer;
            this.lighting.configureMaterial(layerMaterial, !!part.colors);
            if(mapSurface)this.mapDistanceCutoff.configure(layerMaterial);
            layer.receiveShadow = true;
            layer.name = `${part.name} / layer2`;
            layer.renderOrder = 1;
            target.add(layer);
          } else texture.dispose(); // Opaque mix modes need the original material rule, not a covering pass.
        } catch (e) { warnings.push(`Texture layer ${layerFile}: ${e}`); }
      }
      mesh.castShadow = dynamicCaster && !material.transparent;
      if(mapSurface)mesh.userData.staticMapCaster=!material.transparent;
      if(mapSurface)this.mapBackfaces.configure(material,geometry);
      const garageBake=part.lightmapIndex===undefined?stockGarageLightmap(part,textures,model.version):undefined;
      const bakedFile = textures[part.lightmapIndex ?? garageBake?.index ?? -1];
      if (bakedFile) {
        try {
          const uv = garageBake?.uv??bakedLightmapUvs(part);
          if (!uv) throw new Error(`UV channel ${part.lightmapMap?.channel ?? 1} missing`);
          const texture = await loadTexture(await assets.read(bakedFile), bakedFile);
          if (generation !== this.generation) { texture.dispose(); return warnings; }
          configureBakedLightmap(material, geometry, uv, texture, this.bakedLightmaps);
          // A transparent second diffuse pass belongs to the same surface.
          if (secondLayer) configureBakedLightmap(secondLayer.material, secondLayer.geometry, uv, texture, this.bakedLightmaps);
        } catch (error) { warnings.push(`Baked lightmap ${bakedFile}: ${String(error)}`); }
      }
      if(mapSurface&&!material.userData.bakedLightmapTexture){
        this.staticMapShadows.configure(material);
        if(secondLayer)this.staticMapShadows.configure(secondLayer.material);
      }
      if (!mapSurface) {
        const loadLayer = async (path?: string, map?: ScxMesh['textureMap']) => {
          if (!path) return;
          const texture = await vehicleTextures.acquire(assets, path,
            async () => this.texture(await assets.read(path), path));
          if (generation !== this.generation) { texture.dispose(); return; }
          texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          if (map) { texture.repeat.set(map.scaleU, map.scaleV); texture.offset.set(map.offsetU, map.offsetV); }
          return texture;
        };
        let detail: THREE.Texture | undefined, reflection: THREE.Texture | undefined;
        try {
          if (part.mixIndex !== undefined && part.mixIndex !== part.textureIndex) {
            detail = await loadLayer(boundTextures[part.mixIndex], part.mixMap);
            const channel = part.mixMap?.channel ?? 0;
            const uv = channel === 1 ? part.uv2 : channel === 2 ? part.uv3 : part.uv;
            if (detail && uv) {
              const values = new Float32Array(uv.length);
              for (let i = 0; i < uv.length; i++) values[i] = uv[i] * (i % 2 ? part.mixMap?.scaleV ?? 1 : part.mixMap?.scaleU ?? 1)
                + (i % 2 ? part.mixMap?.offsetV ?? 0 : part.mixMap?.offsetU ?? 0);
              geometry.setAttribute('slrrDetailUv', new THREE.BufferAttribute(values, 2));
            } else { detail?.dispose(); detail = undefined; }
          }
          if (part.reflectionMap && part.reflectionMap.channel !== 0xfffffffe) {
            const channel = part.reflectionMap.channel;
            const uv = channel === 1 ? part.uv2 : channel === 2 ? part.uv3 : part.uv;
            if (uv) geometry.setAttribute('slrrReflectionUv', new THREE.BufferAttribute(uv, 2));
          }
          reflection = await loadLayer(boundTextures[part.reflectionIndex ?? -1]);
          if (detail || part.reflectionIndex !== undefined || material.userData.paintDefault)
            configureVehicleMaterial(material, part, this.reflectionUniforms, detail, reflection);
        } catch (error) { detail?.dispose(); reflection?.dispose(); warnings.push(`SCX material layers ${part.name}: ${String(error)}`); }
      }
      if (generation !== this.generation) return warnings;
    }
    return warnings;
  }
  private fit() {
    this.model.position.set(0, 0, 0); this.model.scale.setScalar(1);
    const bounds = new THREE.Box3().setFromObject(this.model), center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3()), extent = Math.max(size.x, size.y, size.z, 0.001);
    // Fit asset to inspection space. This is not a claim about the game's metre scale.
    this.model.scale.setScalar(5 / extent); this.model.position.copy(center.multiplyScalar(-5 / extent));
    this.controls.target.set(0, 0, 0); this.camera.position.set(6, 3.5, 6); this.controls.update();
  }
  private async texture(bytes: Uint8Array, path: string): Promise<THREE.Texture> {
    if (/\.ptx$/i.test(path)){const texture=await ptxTexture(bytes);texture.name=path;return texture;}
    const buffer = bytes.slice().buffer;
    const url = URL.createObjectURL(new Blob([buffer]));
    try {
      const texture = /\.dds$/i.test(path) ? await new DDSLoader().loadAsync(url)
        : /\.tga$/i.test(path) ? await new TGALoader().loadAsync(url) : await new THREE.TextureLoader().loadAsync(url);
      texture.flipY = false;texture.name=path; return texture;
    }
    finally { URL.revokeObjectURL(url); }
  }
}
