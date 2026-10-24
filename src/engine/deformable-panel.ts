import { FixedClock } from '../runtime/fixed-clock';

interface Beam { a: number; b: number; initial: number; rest: number; lambda: number; stiffness: number }
export interface PanelBinding { nodes: number[]; weights: number[] }
export interface PanelMount { nodes: number[]; broken: boolean; force: number; overload: number }
export interface PanelOptions { mass: number; mount: [number, number, number]; stiffness?: number; yieldStrain?: number; mountStrength?: number }
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Generated two-layer cage; XPBD distance/anchor constraints, plastic rest lengths and force-driven mount failure. */
export class DeformablePanel {
  readonly nx = 7; readonly nz = 9; readonly thickness = 0.08;
  readonly positions: Float64Array; readonly rest: Float64Array; readonly velocities: Float64Array;
  readonly beams: Beam[] = []; readonly mounts: PanelMount[] = [];
  clock = new FixedClock(240, 32);
  private previous: Float64Array; private anchorLambda: Float64Array;
  private minX = Infinity; private maxX = -Infinity; private minZ = Infinity; private maxZ = -Infinity;
  private inverseMass: number;
  readonly yieldStrain: number; readonly mountStrength: number;
  constructor(samples: ArrayLike<number>, readonly options: PanelOptions) {
    if (samples.length < 9 || samples.length % 3 || !Number.isFinite(options.mass) || options.mass <= 0 || !options.mount.every(Number.isFinite)) throw new Error('Invalid panel data');
    for (let i = 0; i < samples.length; i += 3) {
      if (![samples[i], samples[i + 1], samples[i + 2]].every(Number.isFinite)) throw new Error('Non-finite panel sample');
      this.minX = Math.min(this.minX, samples[i]); this.maxX = Math.max(this.maxX, samples[i]); this.minZ = Math.min(this.minZ, samples[i + 2]); this.maxZ = Math.max(this.maxZ, samples[i + 2]);
    }
    if (this.maxX - this.minX < 0.01 || this.maxZ - this.minZ < 0.01) throw new Error('Panel requires an XZ surface');
    this.yieldStrain = options.yieldStrain ?? 0.008; this.mountStrength = options.mountStrength ?? 5000;
    const stiffness = options.stiffness ?? 400000;
    if (![this.yieldStrain, this.mountStrength, stiffness].every(v => Number.isFinite(v) && v > 0)) throw new Error('Invalid panel material');
    const count = this.nx * this.nz * 2;
    this.positions = new Float64Array(count * 3); this.rest = new Float64Array(count * 3); this.velocities = new Float64Array(count * 3);
    this.previous = new Float64Array(count * 3); this.anchorLambda = new Float64Array(count * 3); this.inverseMass = count / options.mass;
    for (let z = 0; z < this.nz; z++) for (let x = 0; x < this.nx; x++) {
      const px = this.minX + x / (this.nx - 1) * (this.maxX - this.minX), pz = this.minZ + z / (this.nz - 1) * (this.maxZ - this.minZ);
      let sum = 0, weight = 0;
      for (let i = 0; i < samples.length; i += 3) { const w = 1 / ((samples[i] - px) ** 2 + (samples[i + 2] - pz) ** 2 + 0.002) ** 2; sum += samples[i + 1] * w; weight += w; }
      for (let layer = 0; layer < 2; layer++) this.rest.set([px, sum / weight + (layer - 0.5) * this.thickness, pz], this.index(x, z, layer) * 3);
    }
    const seen = new Set<string>();
    const connect = (a: number, b: number, scale = 1) => {
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`; if (a === b || seen.has(key)) return; seen.add(key);
      const length = Math.hypot(this.rest[a * 3] - this.rest[b * 3], this.rest[a * 3 + 1] - this.rest[b * 3 + 1], this.rest[a * 3 + 2] - this.rest[b * 3 + 2]);
      this.beams.push({ a, b, initial: length, rest: length, lambda: 0, stiffness: stiffness * scale });
    };
    for (let l = 0; l < 2; l++) for (let z = 0; z < this.nz; z++) for (let x = 0; x < this.nx; x++) {
      const a = this.index(x, z, l);
      for (const [dx, dz] of [[1, 0], [0, 1], [1, 1], [-1, 1], [2, 0], [0, 2]]) if (x + dx >= 0 && x + dx < this.nx && z + dz < this.nz) connect(a, this.index(x + dx, z + dz, l), Math.abs(dx) + dz === 2 && (dx === 0 || dz === 0) ? 0.3 : 1);
      if (l === 0) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (x + dx >= 0 && x + dx < this.nx && z + dz >= 0 && z + dz < this.nz) connect(a, this.index(x + dx, z + dz, 1));
    }
    // Generated closed-panel fixture: two clamps around the CFG slot and one latch opposite it. Not original bolt data.
    const used = new Set<number>();
    const targets = [-1, 1].map(sign => [options.mount[0] + sign * (this.maxX - this.minX) * 0.32, options.mount[1], options.mount[2]]);
    targets.push([(this.minX + this.maxX) / 2, options.mount[1], Math.abs(options.mount[2] - this.minZ) > Math.abs(options.mount[2] - this.maxZ) ? this.minZ : this.maxZ]);
    for (const target of targets) {
      const nodes: number[] = [];
      for (let l = 0; l < 2; l++) {
        let best = -1, distance = Infinity;
        for (let z = 0; z < this.nz; z++) for (let x = 0; x < this.nx; x++) { const n = this.index(x, z, l), i = n * 3, d = (this.rest[i] - target[0]) ** 2 + (this.rest[i + 1] - target[1]) ** 2 + (this.rest[i + 2] - target[2]) ** 2; if (!used.has(n) && d < distance) { distance = d; best = n; } }
        nodes.push(best); used.add(best);
      }
      this.mounts.push({ nodes, broken: false, force: 0, overload: 0 });
    }
    this.reset();
  }
  private index(x: number, z: number, l: number) { return (l * this.nz + z) * this.nx + x; }
  get attached() { return this.mounts.some(m => !m.broken); }
  get plasticBeams() { return this.beams.filter(b => Math.abs(b.rest - b.initial) > b.initial * 0.001).length; }
  reset() {
    this.positions.set(this.rest); this.previous.set(this.rest); this.velocities.fill(0); this.clock = new FixedClock(240, 32);
    for (const b of this.beams) { b.rest = b.initial; b.lambda = 0; }
    for (const m of this.mounts) { m.broken = false; m.force = m.overload = 0; }
  }
  bind(point: ArrayLike<number>): PanelBinding {
    if (point.length !== 3 || !Array.from(point).every(Number.isFinite)) throw new Error('Invalid skin point');
    const u = clamp((point[0] - this.minX) / (this.maxX - this.minX), 0, 1) * (this.nx - 1), v = clamp((point[2] - this.minZ) / (this.maxZ - this.minZ), 0, 1) * (this.nz - 1);
    const x = Math.min(Math.floor(u), this.nx - 2), z = Math.min(Math.floor(v), this.nz - 2), a = u - x, b = v - z;
    const nodes = [this.index(x, z, 0), this.index(x + 1, z, 0), this.index(x, z + 1, 0), this.index(x + 1, z + 1, 0)];
    const w = [(1 - a) * (1 - b), a * (1 - b), (1 - a) * b, a * b], bottomY = nodes.reduce((s, n, i) => s + this.rest[n * 3 + 1] * w[i], 0);
    const t = (point[1] - bottomY) / this.thickness;
    return { nodes: [...nodes, ...nodes.map(n => n + this.nx * this.nz)], weights: [...w.map(n => n * (1 - t)), ...w.map(n => n * t)] };
  }
  skin(binding: PanelBinding, out: { [index: number]: number }, offset = 0) {
    for (let axis = 0; axis < 3; axis++) { let value = 0; for (let i = 0; i < 8; i++) value += this.positions[binding.nodes[i] * 3 + axis] * binding.weights[i]; out[offset + axis] = value; }
  }
  hit(impulse: number, u = 0.5, v = 0.35) {
    if (!Number.isFinite(impulse) || impulse < 0 || impulse > 1000 || ![u, v].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error('Invalid panel impact');
    const center = [this.minX + u * (this.maxX - this.minX), 0, this.minZ + v * (this.maxZ - this.minZ)];
    const weights = Array.from({ length: this.positions.length / 3 }, (_, n) => Math.exp(-((this.rest[n * 3] - center[0]) ** 2 + (this.rest[n * 3 + 2] - center[2]) ** 2) / (2 * 0.17 ** 2)));
    const sum = weights.reduce((a, b) => a + b, 0);
    weights.forEach((w, n) => { this.velocities[n * 3 + 1] -= impulse * w / sum * this.inverseMass * 0.94; this.velocities[n * 3 + 2] -= impulse * w / sum * this.inverseMass * Math.sqrt(1 - 0.94 ** 2); });
  }
  advance(seconds: number) { return this.clock.advance(seconds, (_, dt) => this.step(dt)); }
  private step(dt: number) {
    const p = this.positions, inv = this.inverseMass, dt2 = dt * dt;
    this.previous.set(p); this.anchorLambda.fill(0);
    const damping = Math.exp(-(this.attached ? 2 : 0.25) * dt);
    for (let i = 0; i < p.length; i += 3) { this.velocities[i + 1] -= 9.81 * dt; for (let axis = 0; axis < 3; axis++) p[i + axis] += this.velocities[i + axis] * damping * dt; }
    for (const b of this.beams) b.lambda = 0;
    for (let iteration = 0; iteration < 12; iteration++) {
      for (const b of this.beams) {
        const a = b.a * 3, c = b.b * 3, dx = p[a] - p[c], dy = p[a + 1] - p[c + 1], dz = p[a + 2] - p[c + 2], length = Math.hypot(dx, dy, dz);
        if (length < 1e-10) continue;
        const alpha = 1 / b.stiffness / dt2, dl = (-(length - b.rest) - alpha * b.lambda) / (2 * inv + alpha), s = inv * dl / length; b.lambda += dl;
        p[a] += dx * s; p[a + 1] += dy * s; p[a + 2] += dz * s; p[c] -= dx * s; p[c + 1] -= dy * s; p[c + 2] -= dz * s;
      }
      for (const m of this.mounts) if (!m.broken) for (const n of m.nodes) for (let axis = 0; axis < 3; axis++) {
        const i = n * 3 + axis, alpha = 1e-7 / dt2, dl = (-(p[i] - this.rest[i]) - alpha * this.anchorLambda[i]) / (inv + alpha);
        this.anchorLambda[i] += dl; p[i] += inv * dl;
      }
      for (let i = 1; i < p.length; i += 3) p[i] = Math.max(0.015, p[i]);
    }
    for (const m of this.mounts) if (!m.broken) {
      m.force = m.nodes.reduce((sum, n) => sum + Math.hypot(this.anchorLambda[n * 3], this.anchorLambda[n * 3 + 1], this.anchorLambda[n * 3 + 2]) / dt2, 0);
      m.overload = m.force > this.mountStrength ? m.overload + dt : 0;
      if (m.overload >= 2 * dt) m.broken = true;
    }
    for (const b of this.beams) {
      const a = b.a * 3, c = b.b * 3, length = Math.hypot(p[a] - p[c], p[a + 1] - p[c + 1], p[a + 2] - p[c + 2]), strain = (length - b.rest) / b.initial;
      if (Math.abs(strain) > this.yieldStrain) b.rest = clamp(b.rest + Math.sign(strain) * (Math.abs(strain) - this.yieldStrain) * b.initial * Math.min(1, 120 * dt), b.initial * 0.5, b.initial * 1.5);
    }
    for (let i = 0; i < p.length; i++) { this.velocities[i] = (p[i] - this.previous[i]) / dt; if (!Number.isFinite(p[i])) throw new Error('Non-finite panel state'); }
    for (let i = 0; i < p.length; i += 3) if (p[i + 1] <= 0.015001) { this.velocities[i] *= 0.96; this.velocities[i + 2] *= 0.96; if (this.velocities[i + 1] < 0) this.velocities[i + 1] = 0; }
  }
}
