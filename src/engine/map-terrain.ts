import type {CpuWorkProfile} from '../runtime/cpu-work-profile';
import { Box3, Vector3 } from 'three';
import type { ScxModel } from '../formats/scx';
import type { Terrain } from './suspension-3d';
import type { MapCollision } from './map-collision';

export type TireSurface = 'road' | 'grass' | 'dirt';
/** The track has painted/atlas materials too; unknown textures stay on the road preset. */
export function tireSurfaceForTexture(path: string): TireSurface {
  const name = path.replaceAll('\\', '/').split('/').at(-1)?.toLowerCase() ?? '';
  if (/(?:sand|dirt|soil|gravel|murva|homok)/.test(name)) return 'dirt';
  if (/(?:grass|gras|trava|fu\.dds|gyep|lawn)/.test(name)) return 'grass';
  return 'road';
}
interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }
interface Face extends Bounds { minY: number; maxY: number; ax: number; az: number; ay: number; bx: number; bz: number; by: number; cx: number; cz: number; cy: number; normal: Vector3; surface: TireSurface; denominator: number; order: number }
interface Branch extends Bounds { minY: number; maxY: number; faces?: Face[]; left?: Branch; right?: Branch }
interface Cell { faces: Face[]; tree?: Branch }

/** Vertical collision sampling from original map SCX geometry, indexed in 16 m cells. */
export class MapTerrain implements Terrain {
  queryProfile?:CpuWorkProfile;
  ramp = false;
  constructor(private readonly objects?: MapCollision) {}
  private readonly cells = new Map<string, Cell>();
  private readonly stack: Branch[] = [];
  private readonly allFaces: Face[] = [];
  private readonly size = 16;
  faces = 0;
  add(model: ScxModel, textures: readonly string[] = []) {
    for (const mesh of model.meshes) {
      const surface = tireSurfaceForTexture(textures[mesh.textureIndex] ?? '');
      const p = mesh.positions, ids = mesh.indices;
      for (let i = 0; i < ids.length; i += 3) {
        const a = ids[i] * 3, b = ids[i + 1] * 3, c = ids[i + 2] * 3;
        const ax = p[a] * 0.01, ay = p[a + 1] * 0.01, az = p[a + 2] * 0.01;
        const bx = p[b] * 0.01, by = p[b + 1] * 0.01, bz = p[b + 2] * 0.01;
        const cx = p[c] * 0.01, cy = p[c + 1] * 0.01, cz = p[c + 2] * 0.01;
        const cross = new Vector3(bx - ax, by - ay, bz - az).cross(new Vector3(cx - ax, cy - ay, cz - az));
        // Map elevations are not centered on world Y=0: tracks can dip well below
        // -20 m. Clipping those triangles makes the suspension see a bottomless
        // hole, then the chassis free-falls and the impact solver tears parts off
        // when it reaches geometry at a lower elevation. Keep the upper cutoff
        // to avoid treating the sky dome as ground.
        if (Math.abs(cross.y) < 0.45 * cross.length() || Math.max(ay, by, cy) > 50) continue;
        const x0 = Math.floor(Math.min(ax, bx, cx) / this.size), x1 = Math.floor(Math.max(ax, bx, cx) / this.size);
        const z0 = Math.floor(Math.min(az, bz, cz) / this.size), z1 = Math.floor(Math.max(az, bz, cz) / this.size);
        if ((x1 - x0 + 1) * (z1 - z0 + 1) > 4096) continue;
        const pad = Math.max(Math.abs(ax - cx), Math.abs(bx - cx), Math.abs(az - cz), Math.abs(bz - cz)) * 0.00002 + 1e-9;
        const yPad = (Math.max(ay, by, cy) - Math.min(ay, by, cy)) * 0.00002 + 1e-9;
        const face: Face = { ax, ay, az, bx, by, bz, cx, cy, cz, normal: cross.normalize(), surface,
          minY: Math.min(ay, by, cy) - yPad, maxY: Math.max(ay, by, cy) + yPad,
          minX: Math.min(ax, bx, cx) - pad, maxX: Math.max(ax, bx, cx) + pad, minZ: Math.min(az, bz, cz) - pad, maxZ: Math.max(az, bz, cz) + pad,
          denominator: (bz - cz) * (ax - cx) + (cx - bx) * (az - cz), order: this.faces };
        if (face.normal.y < 0) face.normal.negate();
        for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
          const key = `${x},${z}`, cell = this.cells.get(key) ?? { faces: [] };
          if (!cell.faces.length) this.cells.set(key, cell);
          cell.faces.push(face); cell.tree = undefined;
        }
        this.allFaces.push(face);
        this.faces++;
      }
    }
  }
  forEachFace(visit: (a: Vector3, b: Vector3, c: Vector3) => void) {
    for (const f of this.allFaces) visit(new Vector3(f.ax, f.ay, f.az), new Vector3(f.bx, f.by, f.bz), new Vector3(f.cx, f.cy, f.cz));
  }
  /** Build before starting the drive; later additions invalidate only affected cells. */
  prepare() { for (const cell of this.cells.values()) cell.tree ??= this.build([...cell.faces]); }
  private build(faces: Face[]): Branch {
    const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, minY: Infinity, maxY: -Infinity };
    for (const f of faces) {
      bounds.minX = Math.min(bounds.minX, f.minX); bounds.maxX = Math.max(bounds.maxX, f.maxX);
      bounds.minZ = Math.min(bounds.minZ, f.minZ); bounds.maxZ = Math.max(bounds.maxZ, f.maxZ);
      bounds.minY = Math.min(bounds.minY, f.minY); bounds.maxY = Math.max(bounds.maxY, f.maxY);
    }
    if (faces.length <= 8) return { ...bounds, faces };
    const x = bounds.maxX - bounds.minX >= bounds.maxZ - bounds.minZ;
    faces.sort((a, b) => x ? a.minX + a.maxX - b.minX - b.maxX : a.minZ + a.maxZ - b.minZ - b.maxZ);
    const mid = Math.floor(faces.length / 2);
    return { ...bounds, left: this.build(faces.slice(0, mid)), right: this.build(faces.slice(mid)) };
  }
  /** Conservative broad phase for sleeping panel cages, including overlapping decks. */
  mayReach(bounds: Box3): boolean {
    if (bounds.min.y < -999.975) return true; // Preserve the height() fallback floor.
    if (this.objects?.maySupport(bounds)) return true;
    const overlaps = (b: Branch | Face) => b.maxY >= bounds.min.y - 0.025 && b.minY <= bounds.max.y + 0.5
      && b.maxX >= bounds.min.x && b.minX <= bounds.max.x && b.maxZ >= bounds.min.z && b.minZ <= bounds.max.z;
    const stack = this.stack;
    for (let x = Math.floor(bounds.min.x / this.size); x <= Math.floor(bounds.max.x / this.size); x++)
      for (let z = Math.floor(bounds.min.z / this.size); z <= Math.floor(bounds.max.z / this.size); z++) {
        const cell = this.cells.get(`${x},${z}`);
        if (!cell) continue;
        stack.length = 0; stack.push(cell.tree ??= this.build([...cell.faces]));
        while (stack.length) {
          const branch = stack.pop()!;
          if (!overlaps(branch)) continue;
          if (branch.faces) { if (branch.faces.some(overlaps)) return true; }
          else stack.push(branch.left!, branch.right!);
        }
      }
    return false;
  }
  sample(x:number,z:number,fromY?:number){
    if(!this.queryProfile)return this.sampleCore(x,z,fromY);
    this.queryProfile.add('map_samples_count');
    return this.queryProfile.measure('map_sample_ms',()=>this.sampleCore(x,z,fromY));
  }
  private sampleCore(x: number, z: number, fromY?: number): { height: number; normal: Vector3; surface: TireSurface } | undefined {
    const cell = this.cells.get(`${Math.floor(x / this.size)},${Math.floor(z / this.size)}`);
    let best: { height: number; normal: Vector3; surface: TireSurface } | undefined;
    let bestOrder = Infinity;
    const stack = this.stack; stack.length = 0;
    if(cell){
      if(!cell.tree){const start=this.queryProfile?.start()??-1;cell.tree=this.build([...cell.faces]);this.queryProfile?.end('map_lazy_build_ms',start);this.queryProfile?.add('map_lazy_builds_count');}
      stack.push(cell.tree);
    }else this.queryProfile?.add('map_empty_cells_count');
    while (stack.length) {
      const branch = stack.pop()!;this.queryProfile?.add('map_branches_count');
      if (x < branch.minX || x > branch.maxX || z < branch.minZ || z > branch.maxZ) continue;
      if (fromY !== undefined && branch.minY > fromY + 0.5 || best && branch.maxY < best.height) continue;
      if (!branch.faces) { stack.push(branch.right!, branch.left!); continue; }
      this.queryProfile?.add('map_leaves_count');
      for (const f of branch.faces) {
        this.queryProfile?.add('map_face_bounds_count');
        if (x < f.minX || x > f.maxX || z < f.minZ || z > f.maxZ) continue;
        if (fromY !== undefined && f.minY > fromY + 0.5 || best && f.maxY < best.height) continue;
        this.queryProfile?.add('map_triangle_tests_count');
        const denominator = f.denominator;
        if (Math.abs(denominator) < 1e-10) continue;
        const u = ((f.bz - f.cz) * (x - f.cx) + (f.cx - f.bx) * (z - f.cz)) / denominator;
        const v = ((f.cz - f.az) * (x - f.cx) + (f.ax - f.cx) * (z - f.cz)) / denominator;
        if (u < -1e-5 || v < -1e-5 || u + v > 1.00001) continue;
        const h = u * f.ay + v * f.by + (1 - u - v) * f.cy;
        // A ground child (such as a ramp) can overlap the road; ray support uses
        // the highest reachable deck, while a body below it stays on the road.
        if (fromY !== undefined && h > fromY + 0.5) continue;
        if (!best || h > best.height || h === best.height && f.order < bestOrder) { best = { height: h, normal: f.normal, surface: f.surface }; bestOrder = f.order; }
      }
    }
    if (fromY !== undefined) {
      const start=this.queryProfile?.start()??-1;
      const box = this.objects?.support(x, z, fromY + 0.5,this.queryProfile);
      this.queryProfile?.end('object_support_ms',start);
      if (box && (!best || box.height > best.height)) best = { ...box, surface: 'road' };
    }
    return best;
  }
  height(x: number, z: number, fromY?: number) { return this.sample(x, z, fromY)?.height ?? -1000; }
  normal(x: number, z: number, fromY?: number) { return this.sample(x, z, fromY)?.normal.clone() ?? new Vector3(0, 1, 0); }
}
