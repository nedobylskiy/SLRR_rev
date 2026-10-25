import { Group, InstancedMesh, Matrix4, Mesh, Texture, Vector3 } from 'three';

export interface StreamPlacement { matrix: Matrix4; position: Vector3 }
interface StreamType {
  placements: StreamPlacement[];
  load: () => Promise<Mesh[]>;
  meshes?: InstancedMesh[];
  loading: boolean;
  failed: boolean;
  active: number[];
  slots: Map<number, number>;
  pending: number[];
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

  add(placements: StreamPlacement[], load: () => Promise<Mesh[]>) {
    this.types.push({ placements, load, loading: false, failed: false, active: [], slots: new Map(), pending: [] });
    this.dirty = true;
  }

  update(camera: Vector3) {
    if (this.disposed) return;
    const cell = `${Math.floor(camera.x / 25)},${Math.floor(camera.z / 25)}`;
    if (cell !== this.lastCell || this.dirty) {
      this.lastCell = cell; this.dirty = false;
      let loadsInFlight = this.types.filter(type => type.loading).length;
      for (const type of this.types) {
        for (let slot = type.active.length - 1; slot >= 0; slot--) {
          const index = type.active[slot], p = type.placements[index].position;
          if ((p.x - camera.x) ** 2 + (p.z - camera.z) ** 2 > (this.distance + 100) ** 2) this.remove(type, slot);
        }
        const nearby: { index: number; distance: number }[] = [];
        for (let index = 0; index < type.placements.length; index++) {
          const p = type.placements[index].position, distance = (p.x - camera.x) ** 2 + (p.z - camera.z) ** 2;
          if (distance <= this.distance ** 2 && !type.slots.has(index)) nearby.push({ index, distance });
        }
        nearby.sort((a, b) => a.distance - b.distance);
        type.pending = nearby.map(v => v.index);
        if (nearby.length && !type.meshes && !type.loading && !type.failed && loadsInFlight < 4) {
          this.load(type); loadsInFlight++;
        }
      }
    }
    let remaining = this.budget;
    for (const type of this.types) {
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
    void type.load().then(parts => {
      if (this.disposed) {
        for (const part of parts) { part.geometry.dispose(); const materials = Array.isArray(part.material) ? part.material : [part.material]; materials.forEach(material => { const map = 'map' in material ? material.map : undefined; if (map instanceof Texture) map.dispose(); material.dispose(); }); }
        return;
      }
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
  dispose() { this.disposed = true; this.types = []; }
}
