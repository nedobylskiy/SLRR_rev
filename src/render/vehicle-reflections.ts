import * as THREE from 'three';

/** Optional local environment capture. Six 128px faces, throttled to four updates/second. */
export class VehicleReflections {
  enabled = false;
  private target?: THREE.WebGLCubeRenderTarget;
  private camera?: THREE.CubeCamera;
  private last = -Infinity;
  private readonly originals = new Map<THREE.MeshStandardMaterial, { map: THREE.Texture | null; intensity: number }>();

  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, focus: THREE.Vector3, groups: THREE.Group[], now: number) {
    if (!this.enabled || !groups.length || now - this.last < 250) return;
    this.target ??= new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.camera ??= new THREE.CubeCamera(0.1, 800, this.target);
    this.camera.position.copy(focus); this.camera.position.y += 1;
    const visibility = groups.map(group => group.visible);
    try {
      groups.forEach(group => { group.visible = false; });
      this.camera.update(renderer, scene);
    } finally { groups.forEach((group, index) => { group.visible = visibility[index]; }); }
    const live = new Set<THREE.MeshStandardMaterial>();
    for (const group of groups) group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!(material instanceof THREE.MeshStandardMaterial) || !material.userData.vehicleReflective) continue;
        live.add(material);
        if (!this.originals.has(material)) this.originals.set(material, { map: material.envMap, intensity: material.envMapIntensity });
        if (material.envMap !== this.target!.texture) {
          material.envMap = this.target!.texture; material.envMapIntensity = 0.5; material.needsUpdate = true;
        }
      }
    });
    for (const material of this.originals.keys()) if (!live.has(material)) this.originals.delete(material);
    this.last = now;
  }
  reset() {
    for (const [material, original] of this.originals) { material.envMap = original.map; material.envMapIntensity = original.intensity; material.needsUpdate = true; }
    this.originals.clear(); this.target?.dispose(); this.target = undefined; this.camera = undefined; this.last = -Infinity;
  }
}
