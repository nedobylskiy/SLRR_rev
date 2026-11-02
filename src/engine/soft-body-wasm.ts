export type SoftBodyBackend = 'auto' | 'ts' | 'wasm';
interface Beam { a: number; b: number; initial: number; rest: number; lambda: number; stiffness: number }
interface Mount { nodes: number[]; broken: boolean; force: number; overload: number }
interface KernelExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  abi_version(): number;
  configure(nodes: number, beams: number, mounts: number, mass: number): number;
  buffer(id: number): number;
  predict(dt: number, gravity: number, attached: number): void;
  solve(dt: number): void;
  release_mounts(dt: number, strength: number): number;
  finish(dt: number, yieldStrain: number): number;
  set_colliders(count: number): number;
}

/** Persistent f64 views; the module never grows memory or replaces these buffers. */
export class SoftBodyKernel {
  readonly positions: Float64Array; readonly rest: Float64Array; readonly velocities: Float64Array;
  readonly previous: Float64Array; readonly anchorLambda: Float64Array; readonly incoming: Float64Array;
  readonly anchorVelocities: Float64Array; readonly ground: Float64Array;
  private beams: Float64Array; private mounts: Float64Array;
  private boxes: Float64Array;
  onBoxContact: (offset: number, axis: number, sign: number, restitution: number, friction: number) => void = () => {};
  private readonly api: KernelExports;
  private readonly mountStride: number;
  constructor(module: WebAssembly.Module, nodes: number, beams: number, mounts: number, mass: number) {
    const api = new WebAssembly.Instance(module, { env: { exp: Math.exp,
      box_contact: (offset: number, axis: number, sign: number, restitution: number, friction: number) => this.onBoxContact(offset, axis, sign, restitution, friction),
    } }).exports as KernelExports;
    for (const name of ['abi_version', 'configure', 'buffer', 'predict', 'solve', 'release_mounts', 'finish', 'set_colliders'])
      if (typeof api[name] !== 'function') throw new Error(`Missing soft-body WASM export: ${name}`);
    if (!(api.memory instanceof WebAssembly.Memory) || api.abi_version?.() !== 1 || api.configure?.(nodes, beams, mounts, mass) !== 1)
      throw new Error('Incompatible soft-body WASM ABI or panel capacity');
    this.api = api; this.mountStride = nodes + 4;
    const view = (id: number, size: number) => new Float64Array(api.memory.buffer, api.buffer(id), size);
    this.positions = view(0, nodes * 3); this.rest = view(1, nodes * 3); this.velocities = view(2, nodes * 3);
    this.previous = view(3, nodes * 3); this.anchorLambda = view(4, nodes * 3); this.incoming = view(5, nodes * 3);
    this.anchorVelocities = view(6, nodes * 3); this.ground = view(7, nodes);
    this.beams = view(8, beams * 6); this.mounts = view(9, mounts * this.mountStride);
    this.boxes = view(10, 64 * 8);
  }
  uploadColliders(boxes: { min: number[]; max: number[]; restitution?: number; friction?: number }[]) {
    if (!this.api.set_colliders(boxes.length)) return false;
    for (let index = 0; index < boxes.length; index++) {
      const box = boxes[index], i = index * 8;
      this.boxes.set(box.min, i); this.boxes.set(box.max, i + 3);
      this.boxes[i + 6] = box.restitution ?? 0; this.boxes[i + 7] = box.friction ?? 0.4;
    }
    return true;
  }
  upload(beams: Beam[], mounts: Mount[]) {
    for (let index = 0; index < beams.length; index++) {
      const b = beams[index], i = index * 6;
      this.beams[i] = b.a; this.beams[i + 1] = b.b; this.beams[i + 2] = b.initial;
      this.beams[i + 3] = b.rest; this.beams[i + 4] = b.lambda; this.beams[i + 5] = b.stiffness;
    }
    for (let index = 0; index < mounts.length; index++) {
      const m = mounts[index], i = index * this.mountStride;
      if (m.nodes.length > this.mountStride - 4) throw new Error('Too many mount nodes');
      this.mounts[i] = Number(m.broken); this.mounts[i + 1] = m.force; this.mounts[i + 2] = m.overload; this.mounts[i + 3] = m.nodes.length;
      for (let node = 0; node < m.nodes.length; node++) this.mounts[i + 4 + node] = m.nodes[node];
    }
  }
  predict(dt: number, gravity: number, attached: boolean) { this.api.predict(dt, gravity, Number(attached)); }
  solve(dt: number) { this.api.solve(dt); }
  release(dt: number, strength: number, mounts: Mount[]) {
    this.api.release_mounts(dt, strength);
    for (let index = 0; index < mounts.length; index++) {
      const m = mounts[index], i = index * this.mountStride;
      m.broken = Boolean(this.mounts[i]); m.force = this.mounts[i + 1]; m.overload = this.mounts[i + 2];
    }
  }
  finish(dt: number, yieldStrain: number, beams: Beam[]) {
    if (!this.api.finish(dt, yieldStrain)) throw new Error('Non-finite panel state');
    for (let index = 0; index < beams.length; index++) {
      beams[index].rest = this.beams[index * 6 + 3]; beams[index].lambda = this.beams[index * 6 + 4];
    }
  }
}

/** Optional acceleration; missing files, unavailable WASM and ABI failures keep TS usable. */
export class SoftBodyRuntime {
  preference: SoftBodyBackend = 'auto';
  private module?: WebAssembly.Module;
  private loading?: Promise<boolean>;
  error?: string;
  get available() { return !!this.module; }
  load(read: () => Promise<BufferSource>): Promise<boolean> {
    return this.loading ??= (async () => {
      try {
        if (typeof WebAssembly === 'undefined') throw new Error('WebAssembly unavailable');
        const module = await WebAssembly.compile(await read());
        new SoftBodyKernel(module, 18, 0, 0, 1); // Validate exports/imports before selecting it.
        this.module = module; return true;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        return false;
      }
    })();
  }
  create(nodes: number, beams: number, mounts: number, mass: number, backend: SoftBodyBackend) {
    if (!this.module || backend === 'ts') return undefined;
    try { return new SoftBodyKernel(this.module, nodes, beams, mounts, mass); }
    catch (error) { this.error = error instanceof Error ? error.message : String(error); return undefined; }
  }
}
export const softBodyRuntime = new SoftBodyRuntime();
export async function initializeSoftBodyWasm() {
  return softBodyRuntime.load(async () => {
    const response = await fetch(new URL('./wasm/soft-body.wasm', import.meta.url), { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Soft-body WASM: HTTP ${response.status}`);
    return response.arrayBuffer();
  });
}
