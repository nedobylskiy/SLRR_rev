import { BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineSegments, Matrix4, Triangle, Vector3 } from 'three';
import type { MapCollision } from '../engine/map-collision';
import type { MapTerrain } from '../engine/map-terrain';

export type MapDebugLayer = 'terrain' | 'walls' | 'boxes';

/** Draws the collision geometry used by the map solver, independently of SCX materials. */
export class MapDebugView {
  private lines = new Map<MapDebugLayer, LineSegments>();
  constructor(private parent: Group, private terrain: MapTerrain, private collision: MapCollision) {}

  show(layer: MapDebugLayer, visible: boolean) {
    if (!visible) { const line = this.lines.get(layer); if (line) line.visible = false; return; }
    const existing = this.lines.get(layer);
    if (existing) { existing.visible = true; return; }
    const points: number[] = [];
    const edge = (a: Vector3, b: Vector3) => { points.push(a.x, a.y, a.z, b.x, b.y, b.z); };
    const triangle = (a: Vector3, b: Vector3, c: Vector3) => { edge(a, b); edge(b, c); edge(c, a); };
    if (layer === 'terrain') this.terrain.forEachFace(triangle);
    if (layer === 'walls') this.collision.forEachWall((face: Triangle) => triangle(face.a, face.b, face.c));
    if (layer === 'boxes') this.collision.forEachBox((matrix: Matrix4, half: Vector3) => {
      const corners: Vector3[] = [];
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) corners.push(new Vector3(x * half.x, y * half.y, z * half.z).applyMatrix4(matrix));
      for (let i = 0; i < 8; i++) for (const axis of [1, 2, 4]) if (!(i & axis)) edge(corners[i], corners[i | axis]);
    });
    const geometry = new BufferGeometry(); geometry.setAttribute('position', new BufferAttribute(new Float32Array(points), 3));
    const color = { terrain: 0x70d8a3, walls: 0xffaa65, boxes: 0x70b9ff }[layer];
    const line = new LineSegments(geometry, new LineBasicMaterial({ color, transparent: true, opacity: 0.85, depthTest: false, fog: false }));
    line.frustumCulled = false; line.renderOrder = 10; this.parent.add(line); this.lines.set(layer, line);
  }

  dispose() {
    for (const line of this.lines.values()) { line.removeFromParent(); line.geometry.dispose(); (line.material as LineBasicMaterial).dispose(); }
    this.lines.clear();
  }
}
