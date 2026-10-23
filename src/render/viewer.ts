import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DDSLoader } from 'three/addons/loaders/DDSLoader.js';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import type { ScxModel } from '../formats/scx';
import type { Assets } from '../assets';

export class Viewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.01, 1000);
  private controls: OrbitControls;
  private model = new THREE.Group();
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
    this.scene.add(new THREE.GridHelper(12, 24, 0x46515a, 0x222c34));
    this.scene.add(this.model);
    this.observer = new ResizeObserver(() => {
      const { clientWidth: w, clientHeight: h } = container;
      this.renderer.setSize(w, h); this.camera.aspect = w / Math.max(h, 1); this.camera.updateProjectionMatrix();
    }); this.observer.observe(container);
    this.renderer.setAnimationLoop(() => { this.controls.update(); this.renderer.render(this.scene, this.camera); });
  }
  clear() {
    this.generation++;
    for (const obj of [...this.model.children]) {
      const mesh = obj as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
      mesh.geometry.dispose(); mesh.material.map?.dispose(); mesh.material.dispose(); this.model.remove(mesh);
    }
  }
  dispose() {
    this.renderer.setAnimationLoop(null); this.observer.disconnect(); this.controls.dispose(); this.clear();
    this.scene.traverse(object => {
      if (object instanceof THREE.GridHelper) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach(m => m.dispose()); }
    });
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
  async show(model: ScxModel, assets: Assets, textures: string[]): Promise<string[]> {
    this.clear(); const generation = this.generation;
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
      const mesh = new THREE.Mesh(geometry, material); mesh.name = part.name; this.model.add(mesh);
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
    this.model.position.set(0, 0, 0); this.model.scale.setScalar(1);
    const bounds = new THREE.Box3().setFromObject(this.model), center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3()), extent = Math.max(size.x, size.y, size.z, 0.001);
    // Fit asset to inspection space. This is not a claim about the game's metre scale.
    this.model.scale.setScalar(5 / extent); this.model.position.copy(center.multiplyScalar(-5 / extent));
    this.controls.target.set(0, 0, 0); this.camera.position.set(6, 3.5, 6); this.controls.update();
    return warnings;
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
