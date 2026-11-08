import { Matrix4, Vector3 } from 'three';
import {REFERENCE_PHYSICS_HZ,XPBD_ITERATIONS,MOUNT_RELEASE_DELAY_S} from './physics-timing';
import { FixedClock } from '../runtime/fixed-clock';
import { softBodyRuntime, type SoftBodyBackend, type SoftBodyKernel } from './soft-body-wasm';

export const PANEL_GROUND_CLEARANCE=.015;

interface Beam { a: number; b: number; initial: number; rest: number; lambda: number; stiffness: number }
export interface PanelDamageState {
  nx: number; nz: number; thickness: number; bounds: number[];
  template: number[]; positions: number[]; rest: number[]; velocities: number[];
  beams: number[]; mounts: { broken: boolean; force: number; overload: number }[];
}
export interface PanelBinding { nodes: number[]; weights: number[] }
export interface PanelMount { nodes: number[]; broken: boolean; force: number; overload: number }
export interface PanelOptions { frequency?:number;mass: number; mount: [number, number, number]; stiffness?: number; yieldStrain?: number; mountStrength?: number; volume?: boolean; thickness?: number; plasticRate?: number; resolution?: [number, number]; gravity?: number; anchorLayout?: 'panel' | 'central-four' | 'hood-five'; backend?: SoftBodyBackend }
export type Triple = [number, number, number];
export interface PanelCollider { min: Triple; max: Triple; restitution?: number; friction?: number }
export interface PanelContact { normal: Triple; point: Triple; velocity?: Triple; restitution?: number; friction?: number; collider?: boolean; impulse?: (impulse: Triple, point: Triple) => void }
export interface PanelSurface { project(p: Float64Array, previous: Float64Array, offset: number): PanelContact | undefined }
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Generated two-layer cage; XPBD distance/anchor constraints, plastic rest lengths and force-driven mount failure. */
export class DeformablePanel {
  private readonly kernel?: SoftBodyKernel;
  profiling=false;
  readonly profile={constraints:0,contacts:0,upload:0,integration:0,steps:0,surfaceMs:0,groundMs:0};
  get backend(): 'ts' | 'wasm' { return this.kernel && (this.options.backend ?? softBodyRuntime.preference) !== 'ts' ? 'wasm' : 'ts'; }
  readonly nx: number; readonly nz: number; readonly thickness: number;
  readonly positions: Float64Array; readonly rest: Float64Array; readonly velocities: Float64Array;
  readonly beams: Beam[] = []; readonly mounts: PanelMount[] = [];
  readonly supports: {node:number}[] = [];
  private supportNormal:Triple=[0,1,0];
  clock:FixedClock;
  private previous: Float64Array; private anchorLambda: Float64Array;
  private incoming: Float64Array;
  private ground: Float64Array;
  /** World-space support height. Standalone panel labs use a plane at zero. */
  groundHeight = (_x: number, _z: number, _fromY: number): number => 0;
  private stepContacts = new Map<number, PanelContact>();
  private minX = Infinity; private maxX = -Infinity; private minZ = Infinity; private maxZ = -Infinity;
  private inverseMass: number;
  private template: Float64Array;
  private anchorVelocities: Float64Array;
  readonly colliders: PanelCollider[] = [];
  readonly surfaces: PanelSurface[] = [];
  contacts = 0;
  collisionImpact?: { speed: number; impulse: number; point: Triple };
  impulseVersion = 0;
  resetVersion = 0;
  shapeVersion = 0;
  readonly yieldStrain: number; readonly mountStrength: number;
  constructor(samples: ArrayLike<number>, readonly options: PanelOptions) {
    this.clock=new FixedClock(options.frequency??REFERENCE_PHYSICS_HZ,32);
    [this.nx, this.nz] = options.resolution ?? [7, 9];
    if (![this.nx, this.nz].every(v => Number.isInteger(v) && v >= 3 && v <= 16)) throw new Error('Invalid cage resolution');
    if (options.gravity !== undefined && (!Number.isFinite(options.gravity) || options.gravity < 0)) throw new Error('Invalid panel gravity');
    if (samples.length < 9 || samples.length % 3 || !Number.isFinite(options.mass) || options.mass <= 0 || !options.mount.every(Number.isFinite)) throw new Error('Invalid panel data');
    for (let i = 0; i < samples.length; i += 3) {
      if (![samples[i], samples[i + 1], samples[i + 2]].every(Number.isFinite)) throw new Error('Non-finite panel sample');
      this.minX = Math.min(this.minX, samples[i]); this.maxX = Math.max(this.maxX, samples[i]); this.minZ = Math.min(this.minZ, samples[i + 2]); this.maxZ = Math.max(this.maxZ, samples[i + 2]);
    }
    if (this.maxX - this.minX < 0.01 || this.maxZ - this.minZ < 0.01) throw new Error('Panel requires an XZ surface');
    const ys = Array.from(samples).filter((_, i) => i % 3 === 1), minY = Math.min(...ys), maxY = Math.max(...ys);
    if(options.plasticRate!==undefined&&(!Number.isFinite(options.plasticRate)||options.plasticRate<0||options.plasticRate>120))throw new Error('Invalid plastic rate');
    if(options.thickness!==undefined&&(!Number.isFinite(options.thickness)||options.thickness<=0))throw new Error('Invalid panel thickness');
    this.thickness = options.thickness ?? (options.volume ? Math.max(0.02, maxY - minY) : 0.08);
    this.yieldStrain = options.yieldStrain ?? 0.008; this.mountStrength = options.mountStrength ?? 5000;
    const stiffness = options.stiffness ?? 400000;
    if (![this.yieldStrain, this.mountStrength, stiffness].every(v => Number.isFinite(v) && v > 0)) throw new Error('Invalid panel material');
    const count = this.nx * this.nz * 2;
    this.positions = new Float64Array(count * 3); this.rest = new Float64Array(count * 3); this.velocities = new Float64Array(count * 3);
    this.previous = new Float64Array(count * 3); this.anchorLambda = new Float64Array(count * 3); this.anchorVelocities = new Float64Array(count * 3); this.inverseMass = count / options.mass;
    this.incoming = new Float64Array(count * 3);
    this.ground = new Float64Array(count);
    for (let z = 0; z < this.nz; z++) for (let x = 0; x < this.nx; x++) {
      const px = this.minX + x / (this.nx - 1) * (this.maxX - this.minX), pz = this.minZ + z / (this.nz - 1) * (this.maxZ - this.minZ);
      let sum = 0, weight = 0;
      for (let i = 0; i < samples.length; i += 3) { const w = 1 / ((samples[i] - px) ** 2 + (samples[i + 2] - pz) ** 2 + 0.002) ** 2; sum += samples[i + 1] * w; weight += w; }
      for (let layer = 0; layer < 2; layer++) this.rest.set([px, (options.volume ? (minY + maxY) / 2 : sum / weight) + (layer - 0.5) * this.thickness, pz], this.index(x, z, layer) * 3);
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
    // The body is supported near its middle so both crumple zones can yield.
    // Other panels keep the generated CFG-slot clamps and opposite latch.
    const used = new Set<number>();
    const targets: Triple[] = [];
    if (options.anchorLayout === 'central-four') {
      const centerX = (this.minX + this.maxX) / 2, centerZ = (this.minZ + this.maxZ) / 2;
      for (const z of [-1, 1]) for (const x of [-1, 1]) {
        targets.push([centerX + x * (this.maxX - this.minX) * 0.32, options.mount[1], centerZ + z * (this.maxZ - this.minZ) * 0.12]);
      }
    } else {
      for (const sign of [-1, 1]) targets.push([options.mount[0] + sign * (this.maxX - this.minX) * 0.32, options.mount[1], options.mount[2]]);
      targets.push([(this.minX + this.maxX) / 2, options.mount[1], Math.abs(options.mount[2] - this.minZ) > Math.abs(options.mount[2] - this.maxZ) ? this.minZ : this.maxZ]);
    }
    for (const target of targets) {
      const nodes: number[] = [];
      for (let l = 0; l < 2; l++) {
        let best = -1, distance = Infinity;
        for (let z = 0; z < this.nz; z++) for (let x = 0; x < this.nx; x++) { const n = this.index(x, z, l), i = n * 3, d = (this.rest[i] - target[0]) ** 2 + (this.rest[i + 1] - target[1]) ** 2 + (this.rest[i + 2] - target[2]) ** 2; if (!used.has(n) && d < distance) { distance = d; best = n; } }
        nodes.push(best); used.add(best);
      }
      this.mounts.push({ nodes, broken: false, force: 0, overload: 0 });
    }
    if(options.anchorLayout==='hood-five'){
      const frontZ=Math.abs(options.mount[2]-this.minZ)>Math.abs(options.mount[2]-this.maxZ)?this.minZ:this.maxZ;
      for(const x of [this.minX,this.maxX]){
        let best=-1,distance=Infinity;
        for(let z=0;z<this.nz;z++)for(let xx=0;xx<this.nx;xx++){
          const node=this.index(xx,z,0),i=node*3;
          const d=(this.rest[i]-x)**2+(this.rest[i+2]-frontZ)**2;
          if(!used.has(node)&&d<distance){distance=d;best=node;}
        }
        if(best>=0){this.supports.push({node:best});used.add(best);}
      }
    }
    this.template = this.rest.slice();
    this.kernel = softBodyRuntime.create(count, this.beams.length, this.mounts.length, options.mass, options.backend ?? 'auto');
    if (this.kernel) {
      this.kernel.positions.set(this.positions); this.positions = this.kernel.positions;
      this.kernel.rest.set(this.rest); this.rest = this.kernel.rest;
      this.velocities = this.kernel.velocities; this.previous = this.kernel.previous;
      this.anchorLambda = this.kernel.anchorLambda; this.incoming = this.kernel.incoming;
      this.anchorVelocities = this.kernel.anchorVelocities; this.ground = this.kernel.ground;
      this.kernel.onBoxContact = (i, axis, sign, restitution, friction) => {
        const normal: Triple = [0, 0, 0]; normal[axis] = sign;
        this.stepContacts.set(i, { normal, point: [this.positions[i], this.positions[i + 1], this.positions[i + 2]], restitution, friction, collider: true });
      };
    }
    this.reset();
  }
  private index(x: number, z: number, l: number) { return (l * this.nz + z) * this.nx + x; }
  get attached() { return this.mounts.some(m => !m.broken); }
  /** Move anchor targets, not simulated nodes. Existing node velocity supplies inertia on release. */
  setAnchorFrame(e: ArrayLike<number>) {
    if (e.length !== 16 || !Array.from(e).every(Number.isFinite)) throw new Error('Invalid anchor frame');
    const length=Math.hypot(e[4],e[5],e[6]);
    if(length>1e-12)this.supportNormal=[e[4]/length,e[5]/length,e[6]/length];
    for (let i = 0; i < this.rest.length; i += 3) {
      const x = this.template[i], y = this.template[i + 1], z = this.template[i + 2];
      for (let axis = 0; axis < 3; axis++) {
        const next = e[axis] * x + e[axis + 4] * y + e[axis + 8] * z + e[axis + 12];
        this.anchorVelocities[i + axis] = (next - this.rest[i + axis]) / this.clock.dt; this.rest[i + axis] = next;
      }
    }
  }
  /** Rubber stops resist compression only and cease supporting a released hood. */
  private supportContact(node:number):PanelContact|undefined{
    if(!this.attached)return;
    const i=node*3,p=this.positions,n=this.supportNormal;
    const delta:Triple=[p[i]-this.rest[i],p[i+1]-this.rest[i+1],p[i+2]-this.rest[i+2]];
    const depth=delta[0]*n[0]+delta[1]*n[1]+delta[2]*n[2];
    if(depth>=0)return;
    const lateral=delta.reduce((sum,value,axis)=>sum+(value-depth*n[axis])**2,0);
    if(lateral>0.08**2)return;
    for(let axis=0;axis<3;axis++)p[i+axis]-=depth*n[axis];
    return {normal:[...n],point:[p[i],p[i+1],p[i+2]],velocity:[this.anchorVelocities[i],this.anchorVelocities[i+1],this.anchorVelocities[i+2]],restitution:0,friction:0.4};
  }
  get plasticBeams() { return this.beams.filter(b => Math.abs(b.rest - b.initial) > b.initial * 0.001).length; }
  /** Permanent beam-length change, normalized to the solver's maximum plastic range. */
  get permanentDamage() {
    if (!this.beams.length) return 0;
    return this.beams.reduce((sum, beam) => sum + Math.min(1, Math.abs(beam.rest - beam.initial) / (beam.initial * 0.5)), 0) / this.beams.length;
  }
  /** Persistent plastic strain only: springs flexing elastically do not consume condition.
   * RMS keeps a badly crumpled local region from disappearing in a large undamaged panel.
   * 2% RMS plastic strain -> 50% condition; 4% -> 20%. Never releases a mount by itself.
   */
  get deformationCondition(): number {
    if(!this.beams.length)return 1;
    let squared=0;
    for(const beam of this.beams){const strain=(beam.rest-beam.initial)/beam.initial;squared+=strain*strain;}
    return 1/(1+squared/this.beams.length/(0.02*0.02));
  }
  captureDamage(frame: Matrix4): PanelDamageState {
    const inverse=frame.clone().invert(), point=new Vector3();
    const local=(values:Float64Array, vector=false) => {
      const out:number[]=[];
      const transform=vector?inverse.clone().setPosition(0,0,0):inverse;
      for(let i=0;i<values.length;i+=3) out.push(...point.fromArray(values,i).applyMatrix4(transform).toArray());
      return out;
    };
    return { nx:this.nx,nz:this.nz,thickness:this.thickness,bounds:[this.minX,this.maxX,this.minZ,this.maxZ],
      template:Array.from(this.template),positions:local(this.positions),rest:local(this.rest),velocities:local(this.velocities,true),
      beams:this.beams.map(b=>b.rest),mounts:this.mounts.map(m=>({broken:m.broken,force:m.force,overload:m.overload})) };
  }
  restoreDamage(state: PanelDamageState, frame: Matrix4) {
    if(state.nx!==this.nx||state.nz!==this.nz||state.positions.length!==this.positions.length
      ||state.beams.length!==this.beams.length||state.mounts.length!==this.mounts.length)
      throw new Error('Saved panel topology does not match the installed part');
    const point=new Vector3(), rotation=frame.clone().setPosition(0,0,0);
    this.template.set(state.template);
    this.setAnchorFrame(frame.elements);
    for(let i=0;i<this.positions.length;i+=3) {
      point.fromArray(state.positions,i).applyMatrix4(frame).toArray(this.positions,i);
      point.fromArray(state.rest,i).applyMatrix4(frame).toArray(this.rest,i);
      point.fromArray(state.velocities,i).applyMatrix4(rotation).toArray(this.velocities,i);
    }
    this.previous.set(this.positions);this.anchorLambda.fill(0);this.anchorVelocities.fill(0);
    this.beams.forEach((b,i)=>{b.rest=state.beams[i];b.lambda=0;});
    this.mounts.forEach((m,i)=>{const saved=state.mounts[i];m.broken=saved.broken;m.force=saved.force;m.overload=saved.overload;});
    this.resetVersion++;this.shapeVersion++;
  }
  reset() {
    this.resetVersion++;
    this.shapeVersion++;
    this.positions.set(this.rest); this.previous.set(this.rest); this.velocities.fill(0); this.anchorVelocities.fill(0); this.clock = new FixedClock(this.clock.frequency,32);
    for (const b of this.beams) { b.rest = b.initial; b.lambda = 0; }
    for (const m of this.mounts) { m.broken = false; m.force = m.overload = 0; }
    this.contacts = 0;
    this.collisionImpact = undefined;
  }
  bind(point: ArrayLike<number>): PanelBinding {
    if (point.length !== 3 || !Array.from(point).every(Number.isFinite)) throw new Error('Invalid skin point');
    const u = clamp((point[0] - this.minX) / (this.maxX - this.minX), 0, 1) * (this.nx - 1), v = clamp((point[2] - this.minZ) / (this.maxZ - this.minZ), 0, 1) * (this.nz - 1);
    const x = Math.min(Math.floor(u), this.nx - 2), z = Math.min(Math.floor(v), this.nz - 2), a = u - x, b = v - z;
    const nodes = [this.index(x, z, 0), this.index(x + 1, z, 0), this.index(x, z + 1, 0), this.index(x + 1, z + 1, 0)];
    const w = [(1 - a) * (1 - b), a * (1 - b), (1 - a) * b, a * b], bottomY = nodes.reduce((s, n, i) => s + this.template[n * 3 + 1] * w[i], 0);
    const t = (point[1] - bottomY) / this.thickness;
    return { nodes: [...nodes, ...nodes.map(n => n + this.nx * this.nz)], weights: [...w.map(n => n * (1 - t)), ...w.map(n => n * t)] };
  }
  skin(binding: PanelBinding, out: { [index: number]: number }, offset = 0) {
    for (let axis = 0; axis < 3; axis++) { let value = 0; for (let i = 0; i < 8; i++) value += this.positions[binding.nodes[i] * 3 + axis] * binding.weights[i]; out[offset + axis] = value; }
  }
  hit(impulse: number, u = 0.5, v = 0.35) {
    if (!Number.isFinite(impulse) || impulse < 0 || impulse > 1000 || ![u, v].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error('Invalid panel impact');
    if (impulse > 0) this.impulseVersion++;
    const center = [this.minX + u * (this.maxX - this.minX), 0, this.minZ + v * (this.maxZ - this.minZ)];
    const weights = Array.from({ length: this.positions.length / 3 }, (_, n) => Math.exp(-((this.rest[n * 3] - center[0]) ** 2 + (this.rest[n * 3 + 2] - center[2]) ** 2) / (2 * 0.17 ** 2)));
    const sum = weights.reduce((a, b) => a + b, 0);
    weights.forEach((w, n) => { this.velocities[n * 3 + 1] -= impulse * w / sum * this.inverseMass * 0.94; this.velocities[n * 3 + 2] -= impulse * w / sum * this.inverseMass * Math.sqrt(1 - 0.94 ** 2); });
  }
  impulseAt(impulse: Triple, point: Triple, radius = 0.3) {
    const weights = Array.from({ length: this.positions.length / 3 }, (_, n) => Math.exp(-([0, 1, 2].reduce((s, a) => s + (this.positions[n * 3 + a] - point[a]) ** 2, 0)) / (2 * radius * radius))), total = weights.reduce((a, b) => a + b, 0);
    if (total < 1e-12) return;
    if (impulse.some(v => v !== 0)) this.impulseVersion++;
    weights.forEach((w, n) => { for (let a = 0; a < 3; a++) this.velocities[n * 3 + a] += impulse[a] * w / total * this.inverseMass; });
  }
  /** Preserve local bending/spin while removing attachment-solver translation at release. */
  setReleaseVelocity(velocity: Triple, maxInternalSpeed = 8) {
    if (!velocity.every(Number.isFinite) || !Number.isFinite(maxInternalSpeed) || maxInternalSpeed <= 0) throw new Error('Invalid release velocity');
    const mean: Triple = [0, 0, 0], count = this.velocities.length / 3;
    for (let i = 0; i < this.velocities.length; i += 3) for (let axis = 0; axis < 3; axis++) mean[axis] += this.velocities[i + axis] / count;
    for (let i = 0; i < this.velocities.length; i += 3) {
      const relative: Triple = [this.velocities[i] - mean[0], this.velocities[i + 1] - mean[1], this.velocities[i + 2] - mean[2]];
      const length = Math.hypot(...relative), scale = Math.min(1, maxInternalSpeed / Math.max(length, 1e-10));
      for (let axis = 0; axis < 3; axis++) this.velocities[i + axis] = velocity[axis] + relative[axis] * scale;
    }
    const corrected: Triple = [0, 0, 0];
    for (let i = 0; i < this.velocities.length; i += 3) for (let axis = 0; axis < 3; axis++) corrected[axis] += this.velocities[i + axis] / count;
    for (let i = 0; i < this.velocities.length; i += 3) for (let axis = 0; axis < 3; axis++) this.velocities[i + axis] += velocity[axis] - corrected[axis];
  }
  advance(seconds: number) {
    if(this.profiling)Object.assign(this.profile,{constraints:0,contacts:0,upload:0,integration:0,steps:0,surfaceMs:0,groundMs:0});
    return this.clock.advance(seconds, (_, dt) => this.step(dt));
  }
  /** Carry the existing (possibly dented) cage as one rigid shape. Plastic lengths stay intact. */
  advanceRigid(seconds: number, transform: ArrayLike<number>, velocity: Triple, omega: Triple, center: Triple) {
    if (transform.length !== 16 || ![...Array.from(transform), ...velocity, ...omega, ...center].every(Number.isFinite)) throw new Error('Invalid rigid panel motion');
    return this.clock.advance(seconds, () => {
      for (let i = 0; i < this.positions.length; i += 3) {
        const x = this.positions[i], y = this.positions[i + 1], z = this.positions[i + 2];
        const px = transform[0] * x + transform[4] * y + transform[8] * z + transform[12], py = transform[1] * x + transform[5] * y + transform[9] * z + transform[13], pz = transform[2] * x + transform[6] * y + transform[10] * z + transform[14];
        this.positions[i] = px; this.positions[i + 1] = py; this.positions[i + 2] = pz;
        const rx = px - center[0], ry = py - center[1], rz = pz - center[2];
        this.velocities[i] = velocity[0] + omega[1] * rz - omega[2] * ry;
        this.velocities[i + 1] = velocity[1] + omega[2] * rx - omega[0] * rz;
        this.velocities[i + 2] = velocity[2] + omega[0] * ry - omega[1] * rx;
      }
      this.previous.set(this.positions); this.anchorVelocities.fill(0); this.contacts = 0;
      for (const mount of this.mounts) { mount.force = 0; mount.overload = 0; }
    });
  }
  private step(dt: number) {
    const profile=this.profiling?this.profile:undefined;let stamp=profile?performance.now():0;if(profile)profile.steps++;
    const kernel = this.backend === 'wasm' ? this.kernel : undefined;
    const nativeBoxes = kernel?.uploadColliders(this.colliders) ?? false;
    this.collisionImpact = undefined;
    const p = this.positions, inv = this.inverseMass, dt2 = dt * dt;
    const attached = this.attached;
    if (kernel) {
      kernel.upload(this.beams, this.mounts);
      if(profile){profile.upload+=performance.now()-stamp;stamp=performance.now();}
      kernel.predict(dt, this.options.gravity ?? 9.81, attached);
    } else {
      this.previous.set(p); this.anchorLambda.fill(0);
      const damping = Math.exp(-(attached ? 2 : 0.25) * dt);
      for (let i = 0; i < p.length; i += 3) {
        this.velocities[i + 1] -= (this.options.gravity ?? 9.81) * dt;
        for (let axis = 0; axis < 3; axis++) { const target = attached ? this.anchorVelocities[i + axis] : 0; p[i + axis] += (target + (this.velocities[i + axis] - target) * damping) * dt; }
      }
      this.anchorVelocities.fill(0);
    }
    if(profile){profile.integration+=performance.now()-stamp;stamp=performance.now();}
    // Sample once per node/tick, rather than querying the map in every XPBD
    // iteration. Use the previous height to select the reachable road/deck.
    const groundStart=profile?performance.now():0;
    for (let i = 0; i < p.length; i += 3)
      this.ground[i / 3] = this.groundHeight(p[i], p[i + 2], this.previous[i + 1]) + PANEL_GROUND_CLEARANCE;
    if(profile)profile.groundMs+=performance.now()-groundStart;
    const incoming = this.incoming, contacts = this.stepContacts; contacts.clear();
    if (!kernel) for (let i = 0; i < p.length; i++) incoming[i] = (p[i] - this.previous[i]) / dt;
    const surfaces = () => { const start=profile?performance.now():0;for (const surface of this.surfaces) for (let i = 0; i < p.length; i += 3) { const contact = surface.project(p, this.previous, i); if (contact) contacts.set(i, contact); } if(profile)profile.surfaceMs+=performance.now()-start; };
    if (!kernel) for (const b of this.beams) b.lambda = 0;
    if(profile)profile.contacts+=performance.now()-stamp;
    for (let iteration = 0; iteration < XPBD_ITERATIONS; iteration++) {
      if(profile)stamp=performance.now();
      if (kernel) {if(profile)kernel.solveConstraints(dt);else kernel.solve(dt);}
      else {
        for (const b of this.beams) {
          const a = b.a * 3, c = b.b * 3, dx = p[a] - p[c], dy = p[a + 1] - p[c + 1], dz = p[a + 2] - p[c + 2], length = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (length < 1e-10) continue;
          const alpha = 1 / b.stiffness / dt2, dl = (-(length - b.rest) - alpha * b.lambda) / (2 * inv + alpha), s = inv * dl / length; b.lambda += dl;
          p[a] += dx * s; p[a + 1] += dy * s; p[a + 2] += dz * s; p[c] -= dx * s; p[c + 1] -= dy * s; p[c + 2] -= dz * s;
        }
        for (const m of this.mounts) if (!m.broken) for (const n of m.nodes) for (let axis = 0; axis < 3; axis++) {
          const i = n * 3 + axis, alpha = 1e-7 / dt2, dl = (-(p[i] - this.rest[i]) - alpha * this.anchorLambda[i]) / (inv + alpha);
          this.anchorLambda[i] += dl; p[i] += inv * dl;
        }
      }
      if(profile){profile.constraints+=performance.now()-stamp;stamp=performance.now();}
      if(kernel){if(profile)kernel.solveContacts();}
      else for(let i=1;i<p.length;i+=3)p[i]=Math.max(this.ground[(i-1)/3],p[i]);
      if (!nativeBoxes) for (const box of this.colliders) for (let i = 0; i < p.length; i += 3) { const contact = this.contactBox(i, box); if (contact) contacts.set(i, contact); }
      if (iteration === 0 || iteration === 4 || iteration === 8 || iteration === 11) surfaces();
      for(const support of this.supports){const contact=this.supportContact(support.node);if(contact)contacts.set(support.node*3,contact);}
      if(profile)profile.contacts+=performance.now()-stamp;
    }
    if(profile)stamp=performance.now();
    if (kernel) kernel.release(dt, this.mountStrength, this.mounts);
    else {
      let release = false;
      for (const m of this.mounts) if (!m.broken) {
        m.force = m.nodes.reduce((sum, n) => sum + Math.hypot(this.anchorLambda[n * 3], this.anchorLambda[n * 3 + 1], this.anchorLambda[n * 3 + 2]) / dt2, 0);
        m.overload = m.force > this.mountStrength ? m.overload + dt : 0;
        if (m.overload >= MOUNT_RELEASE_DELAY_S) release = true;
      }
      // The clamps represent one part attachment: a failed clamp releases the whole panel.
      if (release) for (const m of this.mounts) m.broken = true;
    }
    if(profile){profile.integration+=performance.now()-stamp;stamp=performance.now();}
    if (attached && !this.attached) surfaces();
    if(profile){profile.contacts+=performance.now()-stamp;stamp=performance.now();} // Sweep the release step too, before its history is discarded.
    if (kernel) kernel.finish(dt, this.yieldStrain, this.beams, this.options.plasticRate ?? 120);
    else {
      for (const b of this.beams) {
        const a = b.a * 3, c = b.b * 3, dx = p[a] - p[c], dy = p[a + 1] - p[c + 1], dz = p[a + 2] - p[c + 2], length = Math.sqrt(dx * dx + dy * dy + dz * dz), strain = (length - b.rest) / b.initial;
        if (Math.abs(strain) > this.yieldStrain) b.rest = clamp(b.rest + Math.sign(strain) * (Math.abs(strain) - this.yieldStrain) * b.initial * Math.min(1, (this.options.plasticRate ?? 120) * dt), b.initial * 0.5, b.initial * 1.5);
      }
      for (let i = 0; i < p.length; i++) { this.velocities[i] = (p[i] - this.previous[i]) / dt; if (!Number.isFinite(p[i])) throw new Error('Non-finite panel state'); }
    }
    if(profile){profile.integration+=performance.now()-stamp;stamp=performance.now();}
    this.contacts = contacts.size;
    for (const [i, contact] of contacts) {
      const n = contact.normal, surface = contact.velocity ?? [0, 0, 0];
      const before = n.reduce((sum, v, axis) => sum + v * (incoming[i + axis] - surface[axis]), 0);
      const after = n.reduce((sum, v, axis) => sum + v * (this.velocities[i + axis] - surface[axis]), 0);
      const target = before < -0.5 ? -before * (contact.restitution ?? 0) : 0;
      const correction = Math.max(0, target - after), normalChange = Math.max(0, after + correction - before);
      const tangent = n.map((v, axis) => this.velocities[i + axis] - surface[axis] - v * after);
      const length = Math.hypot(...tangent), friction = Math.min(1, (contact.friction ?? 0.4) * normalChange / Math.max(length, 1e-10));
      const impulse: Triple = [0, 0, 0];
      for (let axis = 0; axis < 3; axis++) { this.velocities[i + axis] += n[axis] * correction - tangent[axis] * friction; impulse[axis] = (n[axis] * normalChange - tangent[axis] * friction) / inv; }
      if (contact.collider && before < -1.6 && (!this.collisionImpact || -before > this.collisionImpact.speed))
        this.collisionImpact = { speed: -before, impulse: Math.hypot(...impulse), point: [...contact.point] };
      contact.impulse?.(impulse, contact.point);
    }
    const groundDecay=Math.pow(.96,dt*REFERENCE_PHYSICS_HZ);
    for (let i = 0; i < p.length; i += 3) if (p[i + 1] <= this.ground[i / 3] + 0.000001) { this.velocities[i] *= groundDecay; this.velocities[i + 2] *= groundDecay; if (this.velocities[i + 1] < 0) this.velocities[i + 1] = 0; }
    if(profile)profile.contacts+=performance.now()-stamp;
    this.shapeVersion++;
  }
  private contactBox(i: number, box: PanelCollider) {
    const p = this.positions, previous = this.previous;
    // Segment/slab entry catches even a fast node that crosses the entire obstacle in one step.
    let enter = 0, exit = 1, normal = -1, boundary = 0;
    for (let axis = 0; axis < 3; axis++) {
      const delta = p[i + axis] - previous[i + axis], from = previous[i + axis];
      if (Math.abs(delta) < 1e-12) { if (from < box.min[axis] || from > box.max[axis]) return; continue; }
      const a = (box.min[axis] - from) / delta, b = (box.max[axis] - from) / delta, near = Math.min(a, b), far = Math.max(a, b);
      if (near >= enter) { enter = near; normal = axis; boundary = delta > 0 ? box.min[axis] : box.max[axis]; }
      exit = Math.min(exit, far); if (enter > exit) return;
    }
    const result = (axis: number, face: number): PanelContact => { const n: Triple = [0, 0, 0]; n[axis] = face === box.min[axis] ? -1 : 1; return { normal: n, point: [p[i], p[i + 1], p[i + 2]], restitution: box.restitution, friction: box.friction, collider: true }; };
    if (normal >= 0 && enter >= 0 && enter <= 1 && exit >= 0) { p[i + normal] = boundary; return result(normal, boundary); }
    if ([0, 1, 2].every(a => p[i + a] >= box.min[a] && p[i + a] <= box.max[a])) {
      let distance = Infinity, axis = 0, face = 0;
      for (let a = 0; a < 3; a++) for (const value of [box.min[a], box.max[a]]) { const d = Math.abs(p[i + a] - value); if (d < distance) { distance = d; axis = a; face = value; } }
      p[i + axis] = face;
      return result(axis, face);
    }
  }
}
