import * as THREE from 'three';
import type { DeformablePanel, PanelBinding } from '../engine/deformable-panel';

/** World-space skin owns the hood draw transform while physics is active. */
export class PanelView {
  private skins: { geometry: THREE.BufferGeometry; original: Float32Array; normals: Float32Array; bindings: PanelBinding[] }[] = [];
  private cage: THREE.LineSegments;
  private skinFrame?: THREE.Matrix4;
  private rigidLast = false;
  private lastReset = -1;
  private lastTick = -1;
  constructor(private group: THREE.Group, readonly panel: DeformablePanel, localPositions: number[][]) {
    const meshes = group.children.filter((o): o is THREE.Mesh<THREE.BufferGeometry> => o instanceof THREE.Mesh);
    meshes.forEach((mesh, index) => {
      const position = mesh.geometry.getAttribute('position'), normals = mesh.geometry.getAttribute('normal');
      const samples = localPositions[index];
      this.skins.push({ geometry: mesh.geometry, original: new Float32Array(position.array), normals: new Float32Array(normals.array), bindings: Array.from({ length: position.count }, (_, i) => panel.bind(samples.slice(i * 3, i * 3 + 3))) });
      mesh.frustumCulled = false;
    });
    this.group.matrix.identity(); this.group.matrixWorldNeedsUpdate = true;
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(panel.beams.length * 6), 3));
    this.cage = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x5eeacb, transparent: true, opacity: 0.3, depthTest: false }));
    this.cage.frustumCulled = false; this.cage.visible = false; group.add(this.cage); this.update();
  }
  wireframe(value: boolean) { this.cage.visible = value; if (value) this.update(); }
  update(frame?: THREE.Matrix4, rigid = false) {
    if (rigid && this.rigidLast && frame && this.skinFrame && this.lastReset === this.panel.resetVersion) {
      // Keep the dented skin on the GPU; carrying it only changes one draw transform.
      this.group.matrix.copy(frame).multiply(this.skinFrame.clone().invert()); this.group.matrixWorldNeedsUpdate = true; return;
    }
    if (frame && !rigid && this.lastTick === this.panel.clock.tick && this.lastReset === this.panel.resetVersion) return;
    this.group.matrix.identity(); this.group.matrixWorldNeedsUpdate = true;
    for (const { geometry, bindings } of this.skins) {
      const position = geometry.getAttribute('position'); bindings.forEach((b, i) => this.panel.skin(b, position.array, i * 3));
      position.needsUpdate = true; geometry.computeVertexNormals();
    }
    if (this.cage.visible) {
      const attribute = this.cage.geometry.getAttribute('position'), p = this.panel.positions;
      this.panel.beams.forEach((b, i) => { for (let axis = 0; axis < 3; axis++) { attribute.array[i * 6 + axis] = p[b.a * 3 + axis]; attribute.array[i * 6 + axis + 3] = p[b.b * 3 + axis]; } }); attribute.needsUpdate = true;
    }
    this.skinFrame = frame?.clone(); this.rigidLast = rigid; this.lastReset = this.panel.resetVersion; this.lastTick = this.panel.clock.tick;
  }
  dispose() {
    this.cage.removeFromParent(); this.cage.geometry.dispose(); (this.cage.material as THREE.Material).dispose();
    for (const { geometry, original, normals } of this.skins) { geometry.getAttribute('position').array.set(original); geometry.getAttribute('position').needsUpdate = true; geometry.getAttribute('normal').array.set(normals); geometry.getAttribute('normal').needsUpdate = true; geometry.computeBoundingSphere(); geometry.computeBoundingBox(); }
  }
}
