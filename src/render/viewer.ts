import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DDSLoader } from 'three/addons/loaders/DDSLoader.js';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
import type { ScxModel } from '../formats/scx';
import type { Assets } from '../assets';
import { parseScx, scxDiffuseUsesAlpha } from '../formats/scx';
import { poseMatrix, type EnginePart, type EngineWorld } from '../engine/world';
import { modelMatrix } from '../engine/model-transform';
import { loadPartCollision } from '../engine/part-collision';
import { DrivingDemo } from '../engine/driving-demo';
import type { DrivingInput } from '../engine/driving-demo';
import { HoodLab } from './hood-lab';
import type { PartDefinition } from '../engine/world';
import { CarCrashDemo } from '../engine/car-crash-demo';
import { PanelView } from './panel-view';
import { Vehicle3D } from '../engine/vehicle-3d';
import { mapRenderIds } from '../engine/map';
import { MapTerrain } from '../engine/map-terrain';
import { MapCollision } from '../engine/map-collision';
import { mapObjectPlacements, parseIcfg } from '../engine/map-objects';
import { textureAlphaMode } from './texture-alpha';
import { stockContainerTexture } from './stock-container-texture';
import { MapObjectStream, type StreamPlacement } from './map-object-stream';
import { MapDebugView, type MapDebugLayer } from './map-debug-view';
import { TireEffects } from './tire-effects';
import { VehicleAudio } from '../audio/vehicle-audio';
import { RenderObject } from '../runtime/render-object';
import type { RenderLightSettings, RenderFlareSource } from '../runtime/render-ref-native';
import type { EnvironmentMapSource } from './environment-map';

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

export class Viewer {
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
  private javaRenderTemplates = new Map<string, Promise<THREE.Group>>();
  private proxies = new Map<EnginePart, THREE.Group>();
  private internalView = false;
  private collisionMeshes = new Map<EnginePart, number[]>();
  private alphaModes = new Map<string, ReturnType<typeof textureAlphaMode>>();
  private skyFogUniforms = new Set<THREE.Color>();
  private grid = new THREE.GridHelper(12, 24, 0x46515a, 0x222c34);
  private driveGrid = new THREE.GridHelper(2000, 1000, 0x798893, 0x45535b);
  private ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: 0x171f25, roughness: 1, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  private frame?: (now: number) => void;
  private stopDriving?: () => void;
  private generation = 0;
  private mapStream?: MapObjectStream;
  private mapDebug?: MapDebugView;
  private mapFog: MapFogSettings = { ...DEFAULT_MAP_FOG };
  private environmentTexture?: THREE.Texture;
  private environmentRevision = 0;
  private ambientLight = new THREE.HemisphereLight(0xe5efff, 0x47524b, 2.5);
  private sunLight = new THREE.DirectionalLight(0xffddb8, 3);
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
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x11171c);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.append(this.renderer.domElement);
    this.camera.position.set(4, 3, 6);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.scene.add(this.ambientLight);
    this.sunLight.position.set(3, 5, 4); this.scene.add(this.sunLight);
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
      this.frame?.(now); this.controls.update(); this.mapStream?.update(this.camera.position);
      for (const { group, offset } of this.javaSkyDomeNodes.values())
        group.position.copy(this.camera.position).add(offset);
      if (this.sunFlare) this.sunFlare.position.copy(this.camera.position)
        .addScaledVector(this.sunLight.position.clone().normalize(), 500);
      this.renderer.render(this.scene, this.camera);
    });
  }
  clear() {
    this.sunFlareRevision++;
    this.sunFlare?.removeFromParent(); this.sunFlare = undefined;
    this.sunFlareTexture?.dispose(); this.sunFlareTexture = undefined;
    this.javaRenderRoot.clear(); this.javaRenderNodes.clear(); this.javaRenderModels.clear(); this.javaSkyDomeNodes.clear();
    this.javaRenderTypes.clear(); this.javaRenderRequests.clear();
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
    this.camera.near = 0.01; this.camera.far = 1000; this.camera.updateProjectionMatrix();
    this.model.traverse(obj => {
      if (!(obj instanceof THREE.Mesh)) return;
      obj.geometry.dispose();
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.forEach(material => { material.map?.dispose(); material.dispose(); });
    });
    this.model.clear();
  }
  async upsertJavaRenderObject(node: RenderObject, assets: Assets): Promise<void> {
    const generation = this.generation;
    let group = this.javaRenderNodes.get(node.id);
    if (node.resourceType !== 3) {
      group?.removeFromParent(); this.javaRenderNodes.delete(node.id);
      this.javaRenderModels.delete(node.id);
      this.javaSkyDomeNodes.delete(node.id);
      this.javaRenderTypes.delete(node.id); this.javaRenderRequests.delete(node.id);
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
    modelGroup.scale.set(0.01 * node.meshScale.x, 0.01 * node.meshScale.y, 0.01 * node.meshScale.z);
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
        const parsed = parseScx(await assets.read(model.path));
        const template = new THREE.Group();
        const warnings = await this.append(parsed, assets, model.textures, template, generation);
        if (isSkyDome) template.traverse(object => {
          if (!(object instanceof THREE.Mesh)) return;
          object.renderOrder = -1000;
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
    for (const color of this.skyFogUniforms) color.setHex(settings.color);
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.setHex(settings.color); this.scene.fog.near = settings.near; this.scene.fog.far = settings.far;
      this.scene.background = new THREE.Color(settings.color); this.mapStream?.setRange(settings.far + 100);
    }
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
    if (source.sunDirection) this.sunLight.position.set(source.sunDirection.x, source.sunDirection.y, source.sunDirection.z);
    const tint = new THREE.Color((source.color >>> 8) & 0xffffff);
    const flare = new Lensflare();
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
      this.scene.environment = null;
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
    this.environmentTexture = texture;
    this.scene.environment = texture;
    previous?.dispose();
  }
  showMapDebug(layer: MapDebugLayer, visible: boolean) { this.mapDebug?.show(layer, visible); }
  dispose() {
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
  async showWorld(world: EngineWorld, assets: Assets, keepScene = false): Promise<string[]> {
    if (!keepScene) this.clear();
    const generation = this.generation, warnings: string[] = [];
    for (const part of world.parts.values()) {
      const model = part.definition.model;
      if (!model) continue;
      const parsed = parseScx(await assets.read(model.path));
      const collision = await loadPartCollision(assets, part.definition);
      if (generation !== this.generation || world.disposed) return warnings;
      const group = new THREE.Group(); group.name = `${part.id}: ${part.definition.alias}`;
      group.matrixAutoUpdate = false; group.matrix.copy(modelMatrix(part.matrix(), partRenderPose(part))); this.model.add(group);
      this.proxies.set(part, group);
      this.collisionMeshes.set(part, collision);
      warnings.push(...await this.append(parsed, assets, model.textures, group, generation));
      if (generation !== this.generation) return warnings;
      const primaryPose = part.definition.config.renderPose ? poseMatrix(part.definition.config.renderPose) : new THREE.Matrix4();
      for (const extra of part.definition.additionalModels ?? []) {
        const submodel = new THREE.Group();
        submodel.matrixAutoUpdate = false;
        submodel.matrix.copy(primaryPose.clone().invert().multiply(extra.pose ? poseMatrix(extra.pose) : new THREE.Matrix4()));
        group.add(submodel);
        warnings.push(...await this.append(parseScx(await assets.read(extra.model.path)), assets, extra.model.textures, submodel, generation));
        if (generation !== this.generation) return warnings;
      }
    }
    if (generation === this.generation && !keepScene) this.fit();
    return warnings;
  }
  async showMap(packPath: string, assets: Assets, progress?: (done: number, total: number) => void, keepWorld = false) {
    if (!keepWorld) this.clear(); const generation = this.generation;
    const pack = await assets.pack(packPath), ids = mapRenderIds(pack), warnings: string[] = [];
    const collision = new MapCollision(), terrain = new MapTerrain(collision);
    if (generation !== this.generation) return { loaded: 0, total: ids.length, triangles: 0, objects: 0, warnings, terrain, collision };
    this.grid.visible = false; this.driveGrid.visible = false; this.ground.visible = false;
    this.scene.fog = new THREE.Fog(this.mapFog.color, this.mapFog.near, this.mapFog.far);
    this.scene.background = new THREE.Color(this.mapFog.color);
    this.model.scale.setScalar(1); this.model.position.set(0, 0, 0);
    this.camera.near = 0.1; this.camera.far = 5000; this.camera.updateProjectionMatrix();
    this.controls.target.set(0, 2, -650); this.camera.position.set(180, 130, -440); this.controls.update();
    let loaded = 0, triangles = 0;
    for (const id of ids) {
      if (generation !== this.generation) break;
      try {
        const resource = await assets.modelForResource(packPath, id);
        const parsed = parseScx(await assets.read(resource.path));
        if (generation !== this.generation) break;
        terrain.add(parsed, resource.textures);
        collision.add(parsed);
        const group = new THREE.Group(); group.name = `${id.toString(16)}: ${pack.entries.find(e => e.typeId === id)?.alias ?? ''}`;
        group.scale.setScalar(0.01); this.model.add(group);
        warnings.push(...await this.append(parsed, assets, resource.textures, group, generation));
        triangles += parsed.meshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0);
        loaded++;
      } catch (error) { warnings.push(`0x${id.toString(16)}: ${String(error)}`); }
      progress?.(loaded, ids.length);
    }
    let objects = 0;
    const stream = new MapObjectStream(this.model, this.mapFog.far + 100);
    this.mapStream = stream;
    try {
      const rdb = new TextDecoder('windows-1252').decode(await assets.read(packPath.replace(/\.rpk$/i, '.rdb')));
      const placements = mapObjectPlacements(rdb, pack), byType = new Map<number, typeof placements>();
      for (const placement of placements) {
        const list = byType.get(placement.typeId) ?? [];
        if (!list.length) byType.set(placement.typeId, list);
        list.push(placement);
      }
      for (const [typeId, instances] of byType) {
        if (generation !== this.generation) break;
        try {
          const resource = await assets.resource(packPath, typeId);
          if (resource.entry.type !== 8) continue;
          const cfg = parseIcfg(resource.entry.data);
          let model: Awaited<ReturnType<Assets['modelForResource']>> | undefined;
          let renderPose = new THREE.Matrix4();
          for (const render of cfg.renders) {
            try { model = await assets.modelForResource(resource.packPath, render.resource); renderPose = render.pose ? poseMatrix(render.pose) : new THREE.Matrix4(); break; }
            catch { /* A game type can list abstract LOD render IDs before a concrete mesh. */ }
          }
          for (const instance of instances) for (const body of cfg.bodies) {
            if (body.collision === false || body.shape[0]?.toLowerCase() !== 'box') continue;
            const half = body.shape.slice(1, 4).map(Number);
            if (half.length === 3) collision.addBox(poseMatrix(instance.pose).multiply(poseMatrix(body)), new THREE.Vector3(half[0], half[1], half[2]));
          }
          if (model) {
            const placements: StreamPlacement[] = instances.map(instance => {
              const matrix = modelMatrix(poseMatrix(instance.pose), renderPose);
              return { matrix, position: new THREE.Vector3().setFromMatrixPosition(matrix) };
            });
            stream.add(placements, async () => {
              const parsed = parseScx(await assets.read(model.path)), template = new THREE.Group();
              warnings.push(...await this.append(parsed, assets, model.textures, template, generation));
              return template.children.filter((part): part is THREE.Mesh => part instanceof THREE.Mesh).map(part => { part.name = `map object ${resource.entry.alias}: ${part.name}`; return part; });
            });
          }
          objects += instances.length;
        } catch (error) { warnings.push(`Object type 0x${typeId.toString(16)}: ${String(error)}`); }
      }
    } catch (error) { warnings.push(`Map objects: ${String(error)}`); }
    if (generation === this.generation) { this.mapDebug = new MapDebugView(this.model, terrain, collision); stream.update(this.camera.position); }
    return { loaded, total: ids.length, triangles, objects, warnings, terrain, collision };
  }
  showInternals(value: boolean) {
    this.internalView = value;
    for (const [part, group] of this.proxies) {
      const type = part.parent?.definition.config.slots.find(s => s.id === part.parentSlot)?.type;
      group.visible = !value || !!part.definition.mechanics || type !== undefined && type >= 101 && type < 200;
    }
  }
  private syncWorld(exclude?: EnginePart | Set<EnginePart>) {
    for (const [part, group] of this.proxies) {
      if (part === exclude || exclude instanceof Set && exclude.has(part)) continue;
      group.matrix.copy(modelMatrix(part.matrix(), partRenderPose(part)));
      group.matrixWorldNeedsUpdate = true;
    }
  }
  async hood(definition: PartDefinition, assets: Assets, telemetry: (text: string) => void) {
    this.clear(); const generation = this.generation;
    if (!definition.model) throw new Error('Hood model missing');
    const parsed = parseScx(await assets.read(definition.model.path));
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
  drive(root: EnginePart, telemetry: (text: string) => void, withCrash = false, track?: { terrain: MapTerrain; collision: MapCollision; position: THREE.Vector3; yaw: number }, assets?: Assets, audioVolumes?: { getVolume(channel: number): number }, java?: { sample(): DrivingInput; cameraMode(): number; cameraIndex?(): number; cameraDistance?(): number; mouseButton?(pressed: boolean): void; mouseMotion?(dx: number, dy: number): void; cameraLook?(): { x: number; y: number }; instruments?(speedKmh: number, rpm: number, gear: number, damageCondition?: number, engineCondition?: number, transmissionCondition?: number): void; motion?(position: THREE.Vector3, yaw: number, velocity: THREE.Vector3): void }) {
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
      crash = new Vehicle3D(root, hood, samples.flat(), bounds, track?.terrain, track?.collision);
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
      if (track && crash instanceof Vehicle3D) { crash.disableObstacle(); crash.placeAt(track.position, track.yaw); }
      for (const s of (crash as Vehicle3D).soft.values()) { softParts.add(s.part); const view = new PanelView(this.proxies.get(s.part)!, s.panel, localPositions(s.part)); panelViews.push(view); panelParts.set(view, s.part); }
      const rampGeometry = new THREE.BufferGeometry();
      rampGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-1.8, 0, -4, 1.8, 0, -4, 1.8, 1.12, -8, -1.8, 0, -4, 1.8, 1.12, -8, -1.8, 1.12, -8], 3)); rampGeometry.computeVertexNormals();
      ramp = new THREE.Mesh(rampGeometry, new THREE.MeshStandardMaterial({ color: 0x668d9d, side: THREE.DoubleSide })); ramp.visible = false; if (!track) this.model.add(ramp);
      const box = crash.obstacle, size = new THREE.Vector3(...box.max).sub(new THREE.Vector3(...box.min));
      obstacle = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.MeshStandardMaterial({ color: 0xe7a44d, roughness: 0.8 }));
      obstacle.position.copy(new THREE.Vector3(...box.min).add(new THREE.Vector3(...box.max)).multiplyScalar(0.5)); if (!track) this.model.add(obstacle);
    }
    const demo = crash?.driving ?? new DrivingDemo(root);
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
    telemetry = text => reportTelemetry(text + (crash instanceof Vehicle3D ? `\nChassis ${Math.round(root.condition * 100)}% · supports ${crash.suspension.wheels.map((w, i) => Math.round(Math.min(w.mountCondition, crash.suspension.mechanics?.support(i) ?? 1) * 100)).join('/')}%${crash.suspension.mechanics ? `\nEngine ${crash.suspension.mechanics.running ? `${Math.round(crash.suspension.mechanics.power * 100)}%` : 'STALLED · I to restart'} · ${Math.round(crash.suspension.mechanics.rpm)} rpm · gear ${crash.suspension.mechanics.gear < 0 ? 'R' : crash.suspension.mechanics.gear || 'N'} (${crash.suspension.mechanics.manual ? 'manual' : 'automatic'}) · boost ${crash.suspension.mechanics.boost.toFixed(2)} bar · slip ${Math.round(Math.max(...crash.suspension.wheels.map(w => Math.abs(w.slip))) * 100)}%` : ''}\n${Math.round(1000 / frameMs)} fps · active deformation: ${[...crash.soft.values()].filter(s => s.activity.deforming).length}/${crash.soft.size}${track && this.mapStream ? ` · nearby objects: ${this.mapStream.active}/${this.mapStream.total}` : ''}${backlogTicks ? ` · lag ${Math.round(backlogTicks / 240 * 1000)} ms` : ''}` : ''));
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
    this.controls.target.copy(followed).add(new THREE.Vector3(0, 0.2, 0));
    this.camera.position.copy(this.controls.target).add(withCrash ? new THREE.Vector3(7, 4, -3) : new THREE.Vector3(5, 3, 7)); this.controls.update();
    if (java) this.controls.enabled = false;
    const pressed = (...codes: string[]) => codes.some(code => keys.has(code)) ? 1 : 0;
    this.frame = now => {
      if (document.hidden) { last = undefined; return; }
      // Long wall-clock pauses pause this local demo; no catch-up burst after tab switching.
      const elapsed = last === undefined ? 0 : Math.max(0, (now - last) / 1000);
      const seconds = paused ? 0 : Math.min(elapsed, 0.1); last = now;
      if (elapsed > 0 && !paused) frameMs += (elapsed * 1000 - frameMs) * 0.1;
      const input = java ? java.sample() : { throttle: pressed('KeyW', 'ArrowUp') - pressed('KeyS', 'ArrowDown'), steer: pressed('KeyA', 'ArrowLeft') - pressed('KeyD', 'ArrowRight'), brake: keys.has('Space'), clutch: pressed('ShiftLeft', 'ShiftRight') > 0, gearUp: keys.has('KeyE'), gearDown: keys.has('KeyQ'), neutral: keys.has('KeyN'), start: keys.has('KeyI') };
      if (crash) { if (!paused) backlogTicks = crash.advance(seconds * timeScale, input).backlogTicks; for (const view of panelViews) { const part = panelParts.get(view)!; view.update(part.matrix(), crash instanceof Vehicle3D && !crash.soft.get(part)!.activity.deforming); } if (crash instanceof Vehicle3D) { if (ramp) ramp.visible = crash.terrain.ramp; if (obstacle) obstacle.position.copy(new THREE.Vector3(...crash.obstacle.min).add(new THREE.Vector3(...crash.obstacle.max)).multiplyScalar(0.5)); tireEffects?.update(seconds * timeScale, crash.suspension.wheels, crash.velocity().length()); } } else demo.advance(seconds, input);
      this.syncWorld(softParts);
      for (const [part, helper] of vehicleBounds) {
        const proxy = this.proxies.get(part);
        if (proxy) { helper.box.setFromObject(proxy); helper.updateMatrixWorld(true); }
      }
      if (java) {
        const mode = java.cameraMode(), yaw = crash instanceof Vehicle3D
          ? new THREE.Euler().setFromQuaternion(crash.body.orientation, 'YXZ').y : demo.yaw;
        const internalPose = mode === 5 ? root.definition.config.cameras[java.cameraIndex?.() ?? 0] : undefined;
        if (internalPose) {
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
          const desired = demo.position.clone().add(offset);
          const blend = last === undefined ? 1 : 1 - Math.exp(-seconds * (mode === 1 ? 5 : 9));
          this.camera.position.lerp(desired, blend);
          this.controls.target.lerp(target, blend);
          this.camera.lookAt(this.controls.target);
        }
      } else {
        const delta = demo.position.clone().sub(followed); this.camera.position.add(delta); this.controls.target.add(delta);
      }
      followed.copy(demo.position);
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
        telemetry(`${Math.round(crash ? crash.velocity().length() * 3.6 : Math.abs(demo.speed) * 3.6)} km/h${crash instanceof Vehicle3D ? ` · supported wheels ${crash.suspension.wheels.filter(w => w.contact).length}/4\nHood: ${crash.hood.parent ? 'attached' : 'detached'} · mounts ${intact}/3\nDented panels: ${[...crash.soft.values()].filter(s => s.panel.plasticBeams > 0).length} · detached parts: ${[...crash.soft.keys(), ...crash.rigid.keys()].filter(p => p !== root && !p.parent).length}\nChassis: ${up < -0.5 ? 'upside down' : up < 0.5 ? 'on its side' : crash.suspension.wheels.every(w => !w.contact) ? 'airborne' : 'on wheels'}` : crash ? ` · impact ${Math.round(crash.impactSpeed * 3.6)} km/h\nHood: ${crash.hood.parent ? 'attached' : 'separate part'}` : ` · ${demo.speed < -0.1 ? 'reverse' : 'forward'}`}`); lastHud = now;
      }
    };
    const stop = () => {
      if (stopped) return; stopped = true;
      this.frame = undefined; this.stopDriving = undefined;
      releaseMouse();
      canvas.removeEventListener('keydown', down); canvas.removeEventListener('blur', release); canvas.removeEventListener('pointerdown', focus);
      canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointercancel', pointerUp);
      canvas.removeEventListener('lostpointercapture', pointerUp); canvas.removeEventListener('contextmenu', contextMenu);
      window.removeEventListener('keyup', up); window.removeEventListener('blur', release); document.removeEventListener('visibilitychange', visibility);
      canvas.removeAttribute('tabindex'); canvas.removeAttribute('aria-label'); keys.clear();
      if (java) this.controls.enabled = true;
      for (const [part, visible] of bodyPartVisibility) { const proxy = this.proxies.get(part); if (proxy) proxy.visible = visible; }
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
    const breakPart = (part?: EnginePart) => { if (crash instanceof Vehicle3D && part) { part.condition = 0; crash.advance(1 / 240, { throttle: 0, steer: 0, brake: false }); last = undefined; focus(); } };
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
    return Object.assign(stop, { rear: () => { if (crash instanceof Vehicle3D) crash.rearCrash(); tireEffects?.reset(); keys.clear(); last = undefined; focus(); }, launch: (speed: number) => { crash?.reset(speed); tireEffects?.reset(); keys.clear(); last = undefined; focus(); }, chassisCrumple: (value: number) => { if (crash instanceof Vehicle3D) crash.setChassisCrumple(value); }, tireModel: (value: import('../engine/tire-model').TireModelSettings) => { if (crash instanceof Vehicle3D) crash.suspension.tireModel = structuredClone(value); }, engineTuning: (idle: number, redline: number) => { if (crash instanceof Vehicle3D) crash.suspension.mechanics?.setTuning(idle, redline); }, jump: () => { if (crash instanceof Vehicle3D) crash.jump(); tireEffects?.reset(); keys.clear(); last = undefined; focus(); }, roll: () => { if (crash instanceof Vehicle3D) crash.roll(); tireEffects?.reset(); keys.clear(); last = undefined; focus(); }, drop: () => { crash?.dropOnRoof(); tireEffects?.reset(); keys.clear(); last = undefined; focus(); }, breakEngine: () => breakPart(crash instanceof Vehicle3D ? crash.suspension.mechanics?.block : undefined), breakStrut: () => breakPart(crash instanceof Vehicle3D ? crash.suspension.mechanics?.corners[0].strut : undefined), wireframe: (value: boolean) => panelViews.forEach(v => v.wireframe(value)), vehicleFrames: (value: boolean) => vehicleBounds.forEach(helper => { helper.visible = value; }), bodyVisible: setBodyShellVisible, diagnostics: () => ({ speedKmh: Math.round(crash ? crash.velocity().length() * 3.6 : Math.abs(demo.speed) * 3.6), rpm: crash instanceof Vehicle3D ? Math.round(crash.suspension.mechanics?.rpm ?? 0) : 0, gear: crash instanceof Vehicle3D ? crash.suspension.mechanics?.gear ?? 0 : 0, boost: crash instanceof Vehicle3D ? crash.suspension.mechanics?.boost ?? 0 : 0, engineRunning: crash instanceof Vehicle3D ? crash.suspension.mechanics?.running ?? false : false, enginePower: crash instanceof Vehicle3D ? crash.suspension.mechanics?.power ?? 0 : 0, wheelSlip: crash instanceof Vehicle3D ? Math.max(...crash.suspension.wheels.map(w => Math.abs(w.slip))) : 0, wheelContacts: crash instanceof Vehicle3D ? crash.suspension.wheels.filter(w => w.contact).length : 0, chassis: Math.round(root.condition * 100), engineBlock: Math.round((crash instanceof Vehicle3D ? crash.suspension.mechanics?.block?.condition ?? 1 : 1) * 100), transmission: Math.round((crash instanceof Vehicle3D ? transmissionCondition(crash.suspension.mechanics?.transmission) : 1) * 100), parts: [...root.world.parts.values()].map(part => ({ alias: part.definition.alias, id: part.definition.key.id, slot: part.parentSlot, wear: Math.round(part.condition * 100), mechanical: !!part.definition.mechanics })) }), slowMotion: (value: boolean) => { timeScale = value ? 0.25 : 1; }, pause: (value: boolean) => { paused = value; } });
  }
  private disposeGroup(group: THREE.Group): void {
    group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => { material.map?.dispose(); material.dispose(); });
    });
    group.clear();
  }
  private configureSkyMaterial(material: THREE.Material): void {
    const fogColor = new THREE.Color(this.mapFog.color);
    this.skyFogUniforms.add(fogColor);
    const previousCompile = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      previousCompile.call(material, shader, renderer);
      shader.uniforms.slrrSkyFogColor = { value: fogColor };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vSlrrSkyElevation;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvec3 slrrSkyWorldPosition = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvSlrrSkyElevation = normalize( slrrSkyWorldPosition - cameraPosition ).y;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 slrrSkyFogColor;\nvarying float vSlrrSkyElevation;')
        .replace('#include <opaque_fragment>', 'float slrrHorizonFog = 1.0 - smoothstep( -0.015, 0.14, vSlrrSkyElevation );\noutgoingLight = mix( outgoingLight, slrrSkyFogColor, slrrHorizonFog );\n#include <opaque_fragment>');
    };
    const previousKey = material.customProgramCacheKey.bind(material);
    material.customProgramCacheKey = () => `${previousKey()}slrr-sky-horizon-fog-v1`;
    material.depthWrite = false;
    material.needsUpdate = true;
  }
  private async append(model: ScxModel, assets: Assets, textures: string[], target: THREE.Group, generation: number): Promise<string[]> {
    const warnings = [...model.warnings];
    if (!model.meshes.length) return warnings;
    for (const part of model.meshes) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(part.normals, 3));
      const primaryChannel = part.textureMap?.channel ?? part.textureChannel ?? 0;
      const uv = primaryChannel === 1 ? part.uv2 : primaryChannel === 2 ? part.uv3 : part.uv;
      geometry.setAttribute('uv', new THREE.BufferAttribute(uv ?? part.uv, 2));
      if (!uv) warnings.push(`SCX ${part.name}: UV channel ${primaryChannel} missing; using UV1`);
      geometry.setIndex(new THREE.BufferAttribute(part.indices, 1));
      if (!part.normals.some(n => n !== 0)) geometry.computeVertexNormals();
      const color = part.diffuse.slice(0, 3).map(n => Math.max(0, Math.min(1, n)));
      const opacity = Math.max(0, Math.min(1, part.diffuse[3] ?? 1));
      const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(color[0], color[1], color[2]), roughness: 0.65, metalness: 0.12, side: THREE.DoubleSide, opacity, transparent: opacity < 1, depthWrite: opacity === 1 });
      const mesh = new THREE.Mesh(geometry, material); mesh.name = part.name; target.add(mesh);
      const file = textures[part.textureIndex];
      if (file) {
        try {
          const selected = await stockContainerTexture(part, file, await assets.read(file), assets);
          const texture = await this.texture(selected.bytes, selected.path);
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
          const alphaEnabled = scxDiffuseUsesAlpha(model.version, part.materialFlags);
          if (alphaEnabled && alpha === 'cutout') { material.alphaTest = 0.5; material.transparent = opacity < 1; material.depthWrite = opacity === 1; }
          else if (alphaEnabled && alpha === 'blend') { material.transparent = true; material.depthWrite = false; }
        } catch (e) { warnings.push(`Texture ${file}: ${e}`); }
      }
      const layerFile = part.layer2Index === 0xffff ? undefined : textures[part.layer2Index ?? -1];
      if (layerFile) {
        try {
          const bytes = await assets.read(layerFile), texture = await this.texture(bytes, layerFile);
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
            layer.name = `${part.name} / layer2`;
            layer.renderOrder = 1;
            target.add(layer);
          } else texture.dispose(); // Opaque mix modes need the original material rule, not a covering pass.
        } catch (e) { warnings.push(`Texture layer ${layerFile}: ${e}`); }
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
    const buffer = bytes.slice().buffer;
    const url = URL.createObjectURL(new Blob([buffer]));
    try {
      const texture = /\.dds$/i.test(path) ? await new DDSLoader().loadAsync(url)
        : /\.tga$/i.test(path) ? await new TGALoader().loadAsync(url) : await new THREE.TextureLoader().loadAsync(url);
      texture.flipY = false; return texture;
    }
    finally { URL.revokeObjectURL(url); }
  }
}
