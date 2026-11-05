import * as THREE from 'three';
import type {LocalVehicleReflection} from './vehicle-material';

/** Optional local environment capture. Six 128px faces, throttled to four updates/second. */
export class VehicleReflections {
  enabled = false;
  private target?: THREE.WebGLCubeRenderTarget;
  private camera?: THREE.CubeCamera;
  private last = -Infinity;
  private readonly materials=new Set<THREE.MeshStandardMaterial>();

  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, focus: THREE.Vector3, groups: THREE.Group[], now: number) {
    if (!this.enabled || !groups.length || now - this.last < 250) return;
    this.target ??= new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.camera ??= new THREE.CubeCamera(0.1, 5000, this.target);
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
        const local=material.userData.vehicleLocalReflection as LocalVehicleReflection|undefined;
        if(!local)continue;
        live.add(material);
        this.materials.add(material);local.map.value=this.target!.texture;local.available.value=1;
      }
    });
    for (const material of this.materials) if (!live.has(material)) {this.clearMaterial(material);this.materials.delete(material);}
    this.last = now;
  }
  reset() {
    for(const material of this.materials)this.clearMaterial(material);
    this.materials.clear(); this.target?.dispose(); this.target = undefined; this.camera = undefined; this.last = -Infinity;
  }
  private clearMaterial(material:THREE.MeshStandardMaterial){
    const local=material.userData.vehicleLocalReflection as LocalVehicleReflection|undefined;
    if(local){local.map.value=null;local.available.value=0;}
  }
}
