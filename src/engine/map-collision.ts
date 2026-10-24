import { Box3, Matrix4, Triangle, Vector3 } from 'three';
import type { ScxModel } from '../formats/scx';

interface Wall { triangle: Triangle; normal: Vector3; minY: number; maxY: number }
interface StaticBox { matrix: Matrix4; inverse: Matrix4; half: Vector3; bounds: Box3 }

/** Static, two-sided side contacts from original map meshes. Road support is handled by MapTerrain. */
export class MapCollision {
  private readonly cells = new Map<string, Wall[]>();
  private readonly boxCells = new Map<string, StaticBox[]>();
  private readonly size = 8;
  walls = 0;
  boxes = 0;
  /** Original CFG `body ... box hx hy hz`, placed by the map object pose. */
  addBox(matrix: Matrix4, half: Vector3) {
    if (![half.x, half.y, half.z].every(n => Number.isFinite(n) && n > 0)) return;
    const bounds = new Box3(new Vector3(-half.x, -half.y, -half.z), half.clone()).applyMatrix4(matrix);
    const box: StaticBox = { matrix: matrix.clone(), inverse: matrix.clone().invert(), half: half.clone(), bounds };
    const x0 = Math.floor((bounds.min.x - 0.3) / this.size), x1 = Math.floor((bounds.max.x + 0.3) / this.size);
    const z0 = Math.floor((bounds.min.z - 0.3) / this.size), z1 = Math.floor((bounds.max.z + 0.3) / this.size);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 4096) return;
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const key = `${x},${z}`, list = this.boxCells.get(key) ?? [];
      if (!list.length) this.boxCells.set(key, list);
      list.push(box);
    }
    this.boxes++;
  }
  add(model: ScxModel) {
    for (const mesh of model.meshes) {
      const p = mesh.positions, indices = mesh.indices;
      for (let i = 0; i < indices.length; i += 3) {
        const point = (index: number) => new Vector3(p[index * 3] * 0.01, p[index * 3 + 1] * 0.01, p[index * 3 + 2] * 0.01);
        const triangle = new Triangle(point(indices[i]), point(indices[i + 1]), point(indices[i + 2]));
        const normal = triangle.getNormal(new Vector3());
        if (normal.lengthSq() < 0.5 || Math.abs(normal.y) > 0.7) continue;
        const vertices = [triangle.a, triangle.b, triangle.c];
        const minY = Math.min(...vertices.map(v => v.y)), maxY = Math.max(...vertices.map(v => v.y));
        if (maxY < -20 || minY > 50) continue;
        const x0 = Math.floor((Math.min(...vertices.map(v => v.x)) - 0.3) / this.size);
        const x1 = Math.floor((Math.max(...vertices.map(v => v.x)) + 0.3) / this.size);
        const z0 = Math.floor((Math.min(...vertices.map(v => v.z)) - 0.3) / this.size);
        const z1 = Math.floor((Math.max(...vertices.map(v => v.z)) + 0.3) / this.size);
        if ((x1 - x0 + 1) * (z1 - z0 + 1) > 4096) continue;
        const wall = { triangle, normal, minY, maxY };
        for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
          const key = `${x},${z}`, list = this.cells.get(key) ?? [];
          if (!list.length) this.cells.set(key, list);
          list.push(wall);
        }
        this.walls++;
      }
    }
  }
  /** Downward wheel support from original CFG boxes, respecting their object and body poses. */
  support(x: number, z: number, fromY: number): { height: number; normal: Vector3 } | undefined {
    const boxes = this.boxCells.get(`${Math.floor(x / this.size)},${Math.floor(z / this.size)}`);
    if (!boxes) return;
    const origin = new Vector3(x, fromY, z), direction = new Vector3(0, -1, 0);
    let best: { height: number; normal: Vector3 } | undefined;
    for (const box of boxes) {
      if (x < box.bounds.min.x || x > box.bounds.max.x || z < box.bounds.min.z || z > box.bounds.max.z || fromY < box.bounds.min.y) continue;
      const local = origin.clone().applyMatrix4(box.inverse), ray = direction.clone().transformDirection(box.inverse);
      let near = -Infinity, far = Infinity, face = new Vector3();
      for (let axis = 0; axis < 3; axis++) {
        const o = local.getComponent(axis), d = ray.getComponent(axis), half = box.half.getComponent(axis);
        if (Math.abs(d) < 1e-10) { if (Math.abs(o) > half) { far = -Infinity; break; } continue; }
        const a = (-half - o) / d, b = (half - o) / d;
        const entry = Math.min(a, b), exit = Math.max(a, b);
        if (entry > near) { near = entry; face.set(0, 0, 0).setComponent(axis, a < b ? -1 : 1); }
        far = Math.min(far, exit);
      }
      if (near < 0 || near > far || !Number.isFinite(near)) continue;
      const normal = face.transformDirection(box.matrix);
      if (normal.y <= 0.1) continue;
      const height = fromY - near;
      if (!best || height > best.height) best = { height, normal };
    }
    return best;
  }
  contact(point: Vector3, radius = 0.2): { point: Vector3; normal: Vector3; depth: number } | undefined {
    const list = this.cells.get(`${Math.floor(point.x / this.size)},${Math.floor(point.z / this.size)}`);
    const boxes = this.boxCells.get(`${Math.floor(point.x / this.size)},${Math.floor(point.z / this.size)}`);
    if (!list && !boxes) return;
    let nearest: { point: Vector3; normal: Vector3; depth: number } | undefined;
    const closest = new Vector3();
    for (const wall of list ?? []) {
      if (point.y < wall.minY - radius || point.y > wall.maxY + radius) continue;
      wall.triangle.closestPointToPoint(point, closest);
      const d2 = point.distanceToSquared(closest);
      if (d2 >= radius * radius) continue;
      const distance = Math.sqrt(d2), normal = distance > 1e-7
        ? point.clone().sub(closest).divideScalar(distance)
        : wall.normal.clone().multiplyScalar(Math.sign(point.clone().sub(wall.triangle.a).dot(wall.normal)) || 1);
      const depth = radius - distance;
      if (!nearest || depth > nearest.depth) nearest = { point: closest.clone(), normal, depth };
    }
    for (const box of boxes ?? []) {
      if (point.y < box.bounds.min.y - radius || point.y > box.bounds.max.y + radius) continue;
      const local = point.clone().applyMatrix4(box.inverse);
      closest.copy(local).clamp(box.half.clone().negate(), box.half);
      const delta = local.clone().sub(closest), distance = delta.length();
      if (distance >= radius) continue;
      let normal: Vector3, depth: number;
      if (distance > 1e-8) { normal = delta.divideScalar(distance); depth = radius - distance; }
      else {
        const margins = [box.half.x - Math.abs(local.x), box.half.y - Math.abs(local.y), box.half.z - Math.abs(local.z)];
        const axis = margins.indexOf(Math.min(...margins)); normal = new Vector3().setComponent(axis, Math.sign(local.getComponent(axis)) || 1);
        closest.setComponent(axis, normal.getComponent(axis) * box.half.getComponent(axis)); depth = radius + margins[axis];
      }
      normal.transformDirection(box.matrix);
      const hit = { point: closest.applyMatrix4(box.matrix), normal, depth };
      if (!nearest || hit.depth > nearest.depth) nearest = hit;
    }
    return nearest;
  }
}
