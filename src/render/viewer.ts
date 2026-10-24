import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DDSLoader } from 'three/addons/loaders/DDSLoader.js';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import type { ScxModel } from '../formats/scx';
import type { Assets } from '../assets';
import { parseScx } from '../formats/scx';
import { poseMatrix, type EnginePart, type EngineWorld } from '../engine/world';
import { modelMatrix } from '../engine/model-transform';
import { DrivingDemo } from '../engine/driving-demo';
import { HoodLab } from './hood-lab';
import type { PartDefinition } from '../engine/world';
import { CarCrashDemo } from '../engine/car-crash-demo';
import { PanelView } from './panel-view';

export class Viewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.01, 1000);
  private controls: OrbitControls;
  private model = new THREE.Group();
  private proxies = new Map<EnginePart, THREE.Group>();
  private grid = new THREE.GridHelper(12, 24, 0x46515a, 0x222c34);
  private driveGrid = new THREE.GridHelper(2000, 1000, 0x798893, 0x45535b);
  private ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: 0x171f25, roughness: 1, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  private frame?: (now: number) => void;
  private stopDriving?: () => void;
  private generation = 0;
  private observer: ResizeObserver;
  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x11171c);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.append(this.renderer.domElement);
    this.camera.position.set(4, 3, 6);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xe5efff, 0x47524b, 2.5));
    const light = new THREE.DirectionalLight(0xffddb8, 3); light.position.set(3, 5, 4); this.scene.add(light);
    this.scene.add(this.grid);
    this.driveGrid.visible = false; this.scene.add(this.driveGrid);
    this.ground.rotation.x = -Math.PI / 2; this.ground.position.y = -0.002; this.ground.visible = false; this.scene.add(this.ground);
    this.scene.add(this.model);
    this.observer = new ResizeObserver(() => {
      const { clientWidth: w, clientHeight: h } = container;
      this.renderer.setSize(w, h); this.camera.aspect = w / Math.max(h, 1); this.camera.updateProjectionMatrix();
    }); this.observer.observe(container);
    this.renderer.setAnimationLoop(now => { this.frame?.(now); this.controls.update(); this.renderer.render(this.scene, this.camera); });
  }
  clear() {
    this.stopDriving?.(); this.proxies.clear();
    this.generation++;
    this.model.traverse(obj => {
      if (!(obj instanceof THREE.Mesh)) return;
      obj.geometry.dispose();
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.forEach(material => { material.map?.dispose(); material.dispose(); });
    });
    this.model.clear();
  }
  dispose() {
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
  async showWorld(world: EngineWorld, assets: Assets): Promise<string[]> {
    this.clear(); const generation = this.generation, warnings: string[] = [];
    for (const part of world.parts.values()) {
      const model = part.definition.model;
      if (!model) continue;
      const parsed = parseScx(await assets.read(model.path));
      if (generation !== this.generation || world.disposed) return warnings;
      const group = new THREE.Group(); group.name = `${part.id}: ${part.definition.alias}`;
      group.matrixAutoUpdate = false; group.matrix.copy(modelMatrix(part.matrix(), part.definition.config.renderPose && poseMatrix(part.definition.config.renderPose))); this.model.add(group);
      this.proxies.set(part, group);
      warnings.push(...await this.append(parsed, assets, model.textures, group, generation));
      if (generation !== this.generation) return warnings;
    }
    if (generation === this.generation) this.fit();
    return warnings;
  }
  private syncWorld(exclude?: EnginePart) {
    for (const [part, group] of this.proxies) {
      if (part === exclude) continue;
      group.matrix.copy(modelMatrix(part.matrix(), part.definition.config.renderPose && poseMatrix(part.definition.config.renderPose)));
      group.matrixWorldNeedsUpdate = true;
    }
  }
  async hood(definition: PartDefinition, assets: Assets, telemetry: (text: string) => void) {
    this.clear(); const generation = this.generation;
    if (!definition.model) throw new Error('У капота нет модели');
    const parsed = parseScx(await assets.read(definition.model.path));
    if (generation !== this.generation) return;
    const transform = modelMatrix(new THREE.Matrix4().makeTranslation(0, 1.25, 0), definition.config.renderPose && poseMatrix(definition.config.renderPose));
    for (const mesh of parsed.meshes) for (let i = 0; i < mesh.positions.length; i += 3) {
      const point = new THREE.Vector3().fromArray(mesh.positions, i).applyMatrix4(transform); point.toArray(mesh.positions, i);
    }
    await this.append(parsed, assets, definition.model.textures, this.model, generation);
    if (generation !== this.generation) return;
    const slot = definition.config.slots.find(s => s.attach.length);
    if (!slot) throw new Error('У капота нет слота крепления');
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
  drive(root: EnginePart, telemetry: (text: string) => void, withCrash = false) {
    this.stopDriving?.();
    const original = [...root.world.parts.values()].map(part => ({ part, local: part.local.clone() }));
    const keys = new Set<string>(), canvas = this.renderer.domElement;
    let crash: CarCrashDemo | undefined, panelView: PanelView | undefined, obstacle: THREE.Mesh | undefined;
    const localPositions = (part: EnginePart) => {
      const group = this.proxies.get(part); if (!group) throw new Error(`No render proxy for ${part.definition.alias}`);
      const transform = modelMatrix(new THREE.Matrix4(), part.definition.config.renderPose && poseMatrix(part.definition.config.renderPose));
      return group.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh).map(mesh => {
        const attribute = mesh.geometry.getAttribute('position'), out: number[] = [];
        for (let i = 0; i < attribute.count; i++) out.push(...new THREE.Vector3().fromBufferAttribute(attribute, i).applyMatrix4(transform).toArray()); return out;
      });
    };
    if (withCrash) {
      const hood = [...root.world.parts.values()].find(p => p.parent === root && /\/hood\.cfg$/i.test(p.definition.cfgPath));
      if (!hood) throw new Error('Installed hood required for crash demo');
      const samples = localPositions(hood), bounds = new THREE.Box3();
      for (const positions of localPositions(root)) for (let i = 0; i < positions.length; i += 3) bounds.expandByPoint(new THREE.Vector3().fromArray(positions, i));
      crash = new CarCrashDemo(root, hood, samples.flat(), bounds); panelView = new PanelView(this.proxies.get(hood)!, crash.panel, samples);
      const box = crash.obstacle, size = new THREE.Vector3(...box.max).sub(new THREE.Vector3(...box.min));
      obstacle = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.MeshStandardMaterial({ color: 0xe7a44d, roughness: 0.8 }));
      obstacle.position.copy(new THREE.Vector3(...box.min).add(new THREE.Vector3(...box.max)).multiplyScalar(0.5)); this.model.add(obstacle);
    }
    const demo = crash?.driving ?? new DrivingDemo(root);
    let last: number | undefined, lastHud = -Infinity, stopped = false, timeScale = 1;
    const relevant = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyR']);
    const down = (event: KeyboardEvent) => {
      if (!relevant.has(event.code)) return;
      event.preventDefault(); keys.add(event.code);
      if (event.code === 'KeyR' && !event.repeat) { if (crash) crash.reset(); else demo.reset(); keys.clear(); }
    };
    const up = (event: KeyboardEvent) => { keys.delete(event.code); };
    const release = () => { keys.clear(); last = undefined; };
    const focus = () => canvas.focus({ preventScroll: true });
    canvas.tabIndex = 0; canvas.setAttribute('aria-label', 'Управление автомобилем'); canvas.addEventListener('keydown', down); canvas.addEventListener('blur', release); canvas.addEventListener('pointerdown', focus);
    window.addEventListener('keyup', up); window.addEventListener('blur', release); document.addEventListener('visibilitychange', release);
    this.ground.visible = true; this.grid.visible = false; this.driveGrid.visible = true;
    this.model.position.set(0, 0, 0); this.model.scale.setScalar(1); this.syncWorld(crash?.hood);
    const followed = demo.position.clone();
    this.controls.target.copy(followed).add(new THREE.Vector3(0, 0.2, 0));
    this.camera.position.copy(this.controls.target).add(withCrash ? new THREE.Vector3(7, 4, -3) : new THREE.Vector3(5, 3, 7)); this.controls.update();
    const pressed = (...codes: string[]) => codes.some(code => keys.has(code)) ? 1 : 0;
    this.frame = now => {
      if (document.hidden) { last = undefined; return; }
      // Long wall-clock pauses pause this local demo; no catch-up burst after tab switching.
      const seconds = last === undefined ? 0 : Math.min((now - last) / 1000, 0.1); last = now;
      const input = { throttle: pressed('KeyW', 'ArrowUp') - pressed('KeyS', 'ArrowDown'), steer: pressed('KeyA', 'ArrowLeft') - pressed('KeyD', 'ArrowRight'), brake: keys.has('Space') };
      if (crash) { crash.advance(seconds * timeScale, input); panelView!.update(); } else demo.advance(seconds, input);
      this.syncWorld(crash?.hood);
      const delta = demo.position.clone().sub(followed); this.camera.position.add(delta); this.controls.target.add(delta); followed.copy(demo.position);
      if (now - lastHud > 100) {
        const intact = crash?.panel.mounts.filter(m => !m.broken).length;
        telemetry(`${Math.round(Math.abs(demo.speed) * 3.6)} км/ч${crash ? ` · удар ${Math.round(crash.impactSpeed * 3.6)} км/ч\nКапот: ${crash.hood.parent ? 'на машине' : 'самостоятельная деталь'} · крепления ${intact}/3\n${crash.panel.plasticBeams ? 'Есть остаточная деформация' : 'Без остаточной деформации'} · объектов ${root.world.parts.size}` : ` · ${demo.speed < -0.1 ? 'задний ход' : 'вперёд'}`}`); lastHud = now;
      }
    };
    const stop = () => {
      if (stopped) return; stopped = true;
      this.frame = undefined; this.stopDriving = undefined;
      canvas.removeEventListener('keydown', down); canvas.removeEventListener('blur', release); canvas.removeEventListener('pointerdown', focus);
      window.removeEventListener('keyup', up); window.removeEventListener('blur', release); document.removeEventListener('visibilitychange', release);
      canvas.removeAttribute('tabindex'); canvas.removeAttribute('aria-label'); keys.clear();
      panelView?.dispose(); crash?.dispose();
      if (obstacle) { obstacle.removeFromParent(); obstacle.geometry.dispose(); (obstacle.material as THREE.Material).dispose(); }
      for (const { part, local } of original) part.local.copy(local);
      this.ground.visible = false; this.grid.visible = true; this.driveGrid.visible = false; this.syncWorld(); this.fit();
    };
    this.stopDriving = stop; focus();
    return Object.assign(stop, { launch: (speed: number) => { crash?.reset(speed); keys.clear(); last = undefined; focus(); }, wireframe: (value: boolean) => panelView?.wireframe(value), slowMotion: (value: boolean) => { timeScale = value ? 0.25 : 1; } });
  }
  private async append(model: ScxModel, assets: Assets, textures: string[], target: THREE.Group, generation: number): Promise<string[]> {
    const warnings = [...model.warnings];
    if (!model.meshes.length) return warnings;
    for (const part of model.meshes) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(part.normals, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(part.uv, 2));
      geometry.setIndex(new THREE.BufferAttribute(part.indices, 1));
      if (!part.normals.some(n => n !== 0)) geometry.computeVertexNormals();
      const color = part.diffuse.slice(0, 3).map(n => Math.max(0, Math.min(1, n)));
      const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(color[0], color[1], color[2]), roughness: 0.65, metalness: 0.12, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geometry, material); mesh.name = part.name; target.add(mesh);
      const file = textures[part.textureIndex];
      if (file) {
        try {
          const texture = await this.texture(await assets.read(file), file);
          if (generation !== this.generation) { texture.dispose(); return warnings; }
          texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          material.map = texture; material.color.set(0xffffff); material.needsUpdate = true;
        } catch (e) { warnings.push(`Texture ${file}: ${e}`); }
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
