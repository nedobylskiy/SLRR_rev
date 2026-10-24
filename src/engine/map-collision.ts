import { Triangle, Vector3 } from 'three';
import type { ScxModel } from '../formats/scx';

interface Wall { triangle: Triangle; normal: Vector3; minY: number; maxY: number }

/** Static, two-sided side contacts from original map meshes. Road support is handled by MapTerrain. */
export class MapCollision {
  private readonly cells = new Map<string, Wall[]>();
  private readonly size = 8;
  walls = 0;
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
  contact(point: Vector3, radius = 0.2): { point: Vector3; normal: Vector3; depth: number } | undefined {
    const list = this.cells.get(`${Math.floor(point.x / this.size)},${Math.floor(point.z / this.size)}`);
    if (!list) return;
    let nearest: { point: Vector3; normal: Vector3; depth: number } | undefined;
    const closest = new Vector3();
    for (const wall of list) {
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
    return nearest;
  }
}
