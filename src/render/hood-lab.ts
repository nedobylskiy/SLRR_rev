import * as THREE from 'three';
import { DeformablePanel } from '../engine/deformable-panel';
import type { PanelBinding } from '../engine/deformable-panel';

/** Geometry is already in world metres. The solver owns all motion, including after fracture. */
export class HoodLab {
  readonly panel: DeformablePanel;
  private skins: { geometry: THREE.BufferGeometry; bindings: PanelBinding[] }[] = [];
  private cage: THREE.LineSegments;
  private markers: THREE.Mesh[] = [];
  private extras = new THREE.Group();
  private last?: number;
  private lastHud = -Infinity;
  constructor(group: THREE.Group, mass: number, mount: [number, number, number], private telemetry: (text: string) => void) {
    const meshes = group.children.filter((o): o is THREE.Mesh<THREE.BufferGeometry> => o instanceof THREE.Mesh);
    const samples = meshes.flatMap(m => Array.from(m.geometry.getAttribute('position').array));
    this.panel = new DeformablePanel(samples, { mass, mount });
    for (const mesh of meshes) {
      const position = mesh.geometry.getAttribute('position');
      const bindings = Array.from({ length: position.count }, (_, i) => this.panel.bind([position.getX(i), position.getY(i), position.getZ(i)]));
      this.skins.push({ geometry: mesh.geometry, bindings });
      mesh.frustumCulled = false;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.panel.beams.length * 6), 3));
    this.cage = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x5eeacb, transparent: true, opacity: 0.65, depthTest: false }));
    this.cage.frustumCulled = false; this.cage.visible = false; this.extras.add(this.cage);
    for (const m of this.panel.mounts) {
      const n = m.nodes[0] * 3, rest = this.panel.rest;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.035, rest[n + 1], 10), new THREE.MeshStandardMaterial({ color: 0x71828d, metalness: 0.7, roughness: 0.35 }));
      post.position.set(rest[n], rest[n + 1] / 2, rest[n + 2]); this.extras.add(post);
      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: 0x67e9b5, depthTest: false }));
      marker.position.set(rest[n], rest[n + 1], rest[n + 2]); marker.renderOrder = 5; this.markers.push(marker); this.extras.add(marker);
    }
    group.add(this.extras);
    this.reset();
  }
  hit(impulse: number) { this.panel.hit(impulse); }
  wireframe(value: boolean) { this.cage.visible = value; }
  reset() { this.panel.reset(); for (let i = 0; i < 240; i++) this.panel.advance(1 / 240); this.last = undefined; this.lastHud = -Infinity; this.update(); }
  frame(now: number) {
    if (document.hidden) { this.last = undefined; return; }
    this.panel.advance(this.last === undefined ? 0 : Math.min((now - this.last) / 1000, 0.1)); this.last = now;
    this.update();
    if (now - this.lastHud > 100) {
      const intact = this.panel.mounts.filter(m => !m.broken).length;
      this.telemetry(`${intact === 3 ? 'Hood attached' : intact ? 'Some mounts broken' : 'Hood detached'} · mounts ${intact}/3 · ${this.panel.plasticBeams ? 'Permanent deformation' : 'Elastic shape'} · ${this.panel.options.mass} kg`);
      this.lastHud = now;
    }
  }
  private update() {
    for (const { geometry, bindings } of this.skins) {
      const attribute = geometry.getAttribute('position');
      bindings.forEach((binding, i) => this.panel.skin(binding, attribute.array, i * 3));
      attribute.needsUpdate = true; geometry.computeVertexNormals();
    }
    const attribute = this.cage.geometry.getAttribute('position'), p = this.panel.positions;
    this.panel.beams.forEach((b, i) => { for (let axis = 0; axis < 3; axis++) { attribute.array[i * 6 + axis] = p[b.a * 3 + axis]; attribute.array[i * 6 + 3 + axis] = p[b.b * 3 + axis]; } });
    attribute.needsUpdate = true;
    this.markers.forEach((marker, i) => (marker.material as THREE.MeshBasicMaterial).color.set(this.panel.mounts[i].broken ? 0xff6058 : 0x67e9b5));
  }
  dispose() {
    this.extras.traverse(o => { if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) { o.geometry.dispose(); const materials = Array.isArray(o.material) ? o.material : [o.material]; materials.forEach(m => m.dispose()); } });
    this.extras.removeFromParent();
  }
}
