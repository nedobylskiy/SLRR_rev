import { Vector3 } from 'three';
import type { ScxModel } from '../formats/scx';
import type { Terrain } from './suspension-3d';

interface Face { ax: number; az: number; ay: number; bx: number; bz: number; by: number; cx: number; cz: number; cy: number; normal: Vector3 }

/** Vertical collision sampling from original map SCX geometry, indexed in 16 m cells. */
export class MapTerrain implements Terrain {
  ramp = false;
  private readonly cells = new Map<string, Face[]>();
  private readonly size = 16;
  faces = 0;
  add(model: ScxModel) {
    for (const mesh of model.meshes) {
      const p = mesh.positions, ids = mesh.indices;
      for (let i = 0; i < ids.length; i += 3) {
        const a = ids[i] * 3, b = ids[i + 1] * 3, c = ids[i + 2] * 3;
        const ax = p[a] * 0.01, ay = p[a + 1] * 0.01, az = p[a + 2] * 0.01;
        const bx = p[b] * 0.01, by = p[b + 1] * 0.01, bz = p[b + 2] * 0.01;
        const cx = p[c] * 0.01, cy = p[c + 1] * 0.01, cz = p[c + 2] * 0.01;
        const cross = new Vector3(bx - ax, by - ay, bz - az).cross(new Vector3(cx - ax, cy - ay, cz - az));
        if (Math.abs(cross.y) < 0.45 * cross.length() || Math.min(ay, by, cy) < -20 || Math.max(ay, by, cy) > 50) continue;
        const x0 = Math.floor(Math.min(ax, bx, cx) / this.size), x1 = Math.floor(Math.max(ax, bx, cx) / this.size);
        const z0 = Math.floor(Math.min(az, bz, cz) / this.size), z1 = Math.floor(Math.max(az, bz, cz) / this.size);
        if ((x1 - x0 + 1) * (z1 - z0 + 1) > 4096) continue;
        const face: Face = { ax, ay, az, bx, by, bz, cx, cy, cz, normal: cross.normalize() };
        if (face.normal.y < 0) face.normal.negate();
        for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
          const key = `${x},${z}`, list = this.cells.get(key) ?? [];
          if (!list.length) this.cells.set(key, list);
          list.push(face);
        }
        this.faces++;
      }
    }
  }
  sample(x: number, z: number): { height: number; normal: Vector3 } | undefined {
    const list = this.cells.get(`${Math.floor(x / this.size)},${Math.floor(z / this.size)}`);
    if (!list) return;
    let best: { height: number; normal: Vector3 } | undefined;
    for (const f of list) {
      const denominator = (f.bz - f.cz) * (f.ax - f.cx) + (f.cx - f.bx) * (f.az - f.cz);
      if (Math.abs(denominator) < 1e-10) continue;
      const u = ((f.bz - f.cz) * (x - f.cx) + (f.cx - f.bx) * (z - f.cz)) / denominator;
      const v = ((f.cz - f.az) * (x - f.cx) + (f.ax - f.cx) * (z - f.cz)) / denominator;
      if (u < -1e-5 || v < -1e-5 || u + v > 1.00001) continue;
      const h = u * f.ay + v * f.by + (1 - u - v) * f.cy;
      if (!best || Math.abs(h) < Math.abs(best.height)) best = { height: h, normal: f.normal };
    }
    return best;
  }
  height(x: number, z: number) { return this.sample(x, z)?.height ?? -1000; }
  normal(x: number, z: number) { return this.sample(x, z)?.normal.clone() ?? new Vector3(0, 1, 0); }
}
