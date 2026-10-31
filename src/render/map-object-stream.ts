import { Group, InstancedMesh, Matrix4, Mesh, Texture, Vector3 } from 'three';

export interface StreamPlacement { matrix: Matrix4; position: Vector3; radius?: number; bounds?: { minX: number; maxX: number; minZ: number; maxZ: number } }
function distanceTo(placement: StreamPlacement, camera: Vector3) {
  const b = placement.bounds;
  if (b) return Math.hypot(Math.max(b.minX - camera.x, 0, camera.x - b.maxX), Math.max(b.minZ - camera.z, 0, camera.z - b.maxZ));
  return Math.max(0, Math.hypot(placement.position.x - camera.x, placement.position.z - camera.z) - (placement.radius ?? 0));
}
interface StreamType {
  placements: StreamPlacement[];
  load: (wanted: () => boolean) => Promise<Mesh[]>;
  priority: number;
  meshes?: InstancedMesh[];
  loading: boolean;
  failed: boolean;
  active: number[];
  slots: Map<number, number>;
  pending: number[];
  unusedSince?: number;
}

/** Keeps map-object geometry near the camera and uploads a bounded number of new instances per frame. */
export class MapObjectStream {
  private types: StreamType[] = [];
  private lastCell = '';
  private dirty = true;
  private disposed = false;
  constructor(private readonly parent: Group, private distance = 900, readonly budget = 48) {}

  setRange(value: number) {
    if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid map stream range');
    this.distance = value; this.dirty = true;
  }

  add(placements: StreamPlacement[], load: (wanted: () => boolean) => Promise<Mesh[]>) {
    this.types.push({ placements, load, priority: Infinity, loading: false, failed: false, active: [], slots: new Map(), pending: [] });
    this.dirty = true;
  }

  update(camera: Vector3) {
    if (this.disposed) return;
    const cell = `${Math.floor(camera.x / 25)},${Math.floor(camera.z / 25)}`;
    if (cell !== this.lastCell || this.dirty) {
      this.lastCell = cell; this.dirty = false;
      for (const type of this.types) {
        for (let slot = type.active.length - 1; slot >= 0; slot--) {
          const index = type.active[slot];
          if (distanceTo(type.placements[index], camera) > this.distance + 100) this.remove(type, slot);
        }
        const nearby: { index: number; distance: number }[] = [];
        for (let index = 0; index < type.placements.length; index++) {
          const distance = distanceTo(type.placements[index], camera);
          if (distance <= this.distance && !type.slots.has(index)) nearby.push({ index, distance });
        }
        nearby.sort((a, b) => a.distance - b.distance);
        type.pending = nearby.map(v => v.index);
        type.priority = nearby[0]?.distance ?? Infinity;
      }
    }
    const ordered = [...this.types].sort((a, b) => a.priority - b.priority);
    let available = 4 - this.types.filter(type => type.loading).length;
    for (const type of ordered) if (available > 0 && type.pending.length && !type.meshes && !type.loading && !type.failed) {
      this.load(type); available--;
    }
    for (const type of this.types) {
      if (type.active.length || type.pending.length || type.loading) type.unusedSince = undefined;
      else if (type.meshes) {
        type.unusedSince ??= performance.now();
        if (performance.now() - type.unusedSince > 5000) this.release(type);
      }
    }
    let remaining = this.budget;
    for (const type of ordered) {
      if (!type.meshes) continue;
      while (remaining && type.pending.length) {
        const index = type.pending.shift()!;
        if (type.slots.has(index)) continue;
        const slot = type.active.length;
        type.active.push(index); type.slots.set(index, slot);
        for (const mesh of type.meshes) { mesh.setMatrixAt(slot, type.placements[index].matrix); mesh.count = type.active.length; mesh.instanceMatrix.needsUpdate = true; }
        remaining--;
      }
      if (!remaining) break;
    }
  }

  private remove(type: StreamType, slot: number) {
    const index = type.active[slot], last = type.active.pop()!;
    type.slots.delete(index);
    if (slot < type.active.length) {
      type.active[slot] = last; type.slots.set(last, slot);
      for (const mesh of type.meshes ?? []) { mesh.setMatrixAt(slot, type.placements[last].matrix); mesh.instanceMatrix.needsUpdate = true; }
    }
    for (const mesh of type.meshes ?? []) mesh.count = type.active.length;
  }

  private load(type: StreamType) {
    type.loading = true;
    const wanted = () => !this.disposed && (type.pending.length > 0 || type.active.length > 0);
    void type.load(wanted).then(parts => {
      type.loading = false;
      if (!wanted()) {
        for (const part of parts) { part.geometry.dispose(); const materials = Array.isArray(part.material) ? part.material : [part.material]; materials.forEach(material => { const map = 'map' in material ? material.map : undefined; if (map instanceof Texture) map.dispose(); material.dispose(); }); }
        return;
      }
      if (!parts.length) { this.dirty = true; return; }
      type.meshes = parts.map(part => {
        const mesh = new InstancedMesh(part.geometry, part.material, type.placements.length);
        mesh.name = part.name; mesh.count = 0; mesh.frustumCulled = false; this.parent.add(mesh); return mesh;
      });
      type.loading = false;
      this.dirty = true;
    }).catch(error => { type.loading = false; type.failed = true; this.dirty = true; console.warn('Map object stream:', error); });
  }

  get active() { return this.types.reduce((sum, type) => sum + type.active.length, 0); }
  get total() { return this.types.reduce((sum, type) => sum + type.placements.length, 0); }
  private release(type: StreamType) {
    const geometries = new Set(), materials = new Set(), textures = new Set<Texture>();
    for (const mesh of type.meshes ?? []) {
      mesh.removeFromParent(); mesh.dispose(); geometries.add(mesh.geometry);
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
    }
    for (const material of materials as Set<import('three').Material>) {
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
      material.dispose();
    }
    for (const geometry of geometries as Set<import('three').BufferGeometry>) geometry.dispose();
    for (const texture of textures) texture.dispose();
    type.meshes = undefined; type.unusedSince = undefined;
  }
  dispose() { this.disposed = true; for (const type of this.types) this.release(type); this.types = []; }
}
