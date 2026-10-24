import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import { CarCrashDemo } from './car-crash-demo';
import { RigidBody3D, boxContact } from './rigid-body-3d';
import { Suspension3D, TestTerrain, type Terrain } from './suspension-3d';
import { DeformablePanel, type PanelBinding, type Triple } from './deformable-panel';
import { TriangleSurface } from './triangle-surface';
import type { EnginePart } from './world';
import type { DrivingInput } from './driving-demo';
import { PanelActivity } from './panel-activity';
import { DeformedFrame } from './deformed-frame';
import { slotMatrix } from './slot-frames';
import { FixedClock } from '../runtime/fixed-clock';
import type { MapCollision } from './map-collision';

export interface SoftBodyPart { part: EnginePart; panel: DeformablePanel; activity: PanelActivity; center: Vector3; inverseBasis: Matrix4; root: boolean; mountVersion?: number }
export interface RigidPart { part: EnginePart; body: RigidBody3D; previous: Matrix4; peakForce: number }
interface Geometry { part: EnginePart; triangles: number[]; bindings?: PanelBinding[] }
const mass = (p: EnginePart) => {
  const type = p.parent?.definition.config.slots.find(s => s.id === p.parentSlot)?.type;
  const minimum = type !== undefined && type >= 101 && type <= 104 ? 14 : p.definition.mechanics ? ({ suspension: 12, spring: 3, shock: 3, brake: 8, sway: 4, engine: 4 }[p.definition.mechanics.kind]) : 0.1;
  return Math.max(minimum, p.definition.config.bodies.reduce((s, b) => s + b.mass, 0));
};
const boundsOf = (samples: ArrayLike<number>) => { const box = new Box3(); for (let i = 0; i < samples.length; i += 3) box.expandByPoint(new Vector3().fromArray(samples, i)); return box; };
const centerOf = (p: ArrayLike<number>) => { const out = new Vector3(); for (let i = 0; i < p.length; i += 3) out.add(new Vector3().fromArray(p, i)); return out.multiplyScalar(3 / p.length); };
function basis(panel: DeformablePanel) {
  const p = panel.positions, point = (x: number, z: number) => new Vector3().fromArray(p, (z * panel.nx + x) * 3);
  const x = point(panel.nx - 1, 0).sub(point(0, 0)).normalize(), z = point(0, panel.nz - 1).sub(point(0, 0)).normalize(), y = new Vector3().crossVectors(z, x).normalize(); z.crossVectors(x, y).normalize(); return new Matrix4().makeBasis(x, y, z);
}

/** Full rigid chassis motion with ray suspension and separate deformable or rigid detachable parts. */
export class Vehicle3D extends CarCrashDemo {
  readonly body: RigidBody3D;
  private spawn?: { position: Vector3; yaw: number };
  readonly suspension: Suspension3D;
  readonly soft = new Map<EnginePart, SoftBodyPart>();
  readonly rigid = new Map<EnginePart, RigidPart>();
  private geometry: Geometry[] = [];
  private originalTree: { part: EnginePart; parent?: EnginePart; parentSlot?: number; ownSlot?: number; local: Matrix4 }[];
  private originalObstacle: { min: Triple; max: Triple };
  private rigidSurface?: TriangleSurface;
  private triangleSource?: number[];
  private surfaceTopology = '';
  private surfaceCoordinates: number[] = [];
  private lastVelocity = new Vector3();
  private lastOmega = new Vector3();
  private surfaceDirty = false;
  private pendingShock = false;
  private structuralMounts = new Map<EnginePart, { parent: EnginePart; field: DeformedFrame; ownInverse: Matrix4 }>();
  private wheelMounts: DeformedFrame[] = [];
  private engineHull = new Box3();
  private surfaceTick = -4;
  private configureStructure() {
    this.structuralMounts.clear(); this.wheelMounts = [];
    for (const s of this.originalTree) {
      const parent = s.parent && this.soft.get(s.parent), slot = s.parent?.definition.config.slots.find(v => v.id === s.parentSlot), own = s.part.definition.config.slots.find(v => v.id === s.ownSlot);
      if (!parent || !slot || !own || slot.type === 11 || slot.type !== undefined && slot.type >= 101 && slot.type < 200) continue;
      this.structuralMounts.set(s.part, { parent: parent.part, field: new DeformedFrame(parent.panel, parent.part.matrix(), parent.part.slotFrame(slot)), ownInverse: s.part.slotFrame(own).invert() });
    }
    const chassis = this.soft.get(this.root);
    if (chassis) this.wheelMounts = this.suspension.wheels.map(w => new DeformedFrame(chassis.panel, this.root.matrix(), new Matrix4().setPosition(w.originalHardpoint)));
  }
  private moveMounts(parent: EnginePart) {
    const soft = this.soft.get(parent)!;
    if (soft.mountVersion === soft.panel.shapeVersion) return;
    soft.mountVersion = soft.panel.shapeVersion;
    const frame = parent.matrix();
    for (const [child, mount] of this.structuralMounts) if (mount.parent === parent && child.parent === parent) {
      child.local.copy(mount.field.local(frame)).multiply(mount.ownInverse);
      if (parent === this.root) this.suspension.setMechanicalBase(child, child.local);
    }
    if (parent !== this.root) return;
    this.wheelMounts.forEach((mount, index) => {
      const current = mount.local(frame), delta = current.clone().multiply(mount.original.clone().invert());
      const shift = new Vector3().setFromMatrixPosition(current).distanceTo(new Vector3().setFromMatrixPosition(mount.original));
      this.suspension.deform(index, delta, Math.max(0, 1 - shift / 0.3));
    });
  }
  /** Rigid chassis correction must not swallow the impact before local panels receive their load. */
  private damageImpact(impulse: Vector3, point: Vector3, obstacle: Box3, predicted: Matrix4, previous: Matrix4) {
    if (impulse.lengthSq() < 1) return;
    const delta = predicted.clone().multiply(previous.clone().invert()), probe = new Vector3(), nearest = new Vector3();
    const candidates: { part: EnginePart; panel?: DeformablePanel; point: Vector3; weight: number }[] = [];
    for (const s of this.soft.values()) {
      if (s.root || !s.part.parent) continue;
      let distance = Infinity; const hit = new Vector3();
      for (let i = 0; i < s.panel.positions.length; i += 3) {
        probe.fromArray(s.panel.positions, i).applyMatrix4(delta); obstacle.clampPoint(probe, nearest); const d = probe.distanceToSquared(nearest);
        if (d < distance) { distance = d; hit.copy(probe); }
      }
      const weight = Math.exp(-distance / (0.22 * 0.22)); if (weight > 0.01) candidates.push({ part: s.part, panel: s.panel, point: hit, weight });
    }
    const root = this.soft.get(this.root);
    const total = candidates.reduce((sum, c) => sum + c.weight, 0), energy = impulse.lengthSq() / (2 * this.body.mass);
    const structuralShare = Math.max(0, Math.min(1, (energy - 2500) / 15000));
    root?.panel.impulseAt(impulse.clone().multiplyScalar(0.28 * structuralShare).toArray() as Triple, point.toArray() as Triple, 0.5);
    for (const c of candidates) {
      const share = c.weight / Math.max(1, total);
      c.panel?.impulseAt(impulse.clone().multiplyScalar(0.3 * share * structuralShare).toArray() as Triple, c.point.toArray() as Triple, 0.3);
      c.part.condition = Math.max(0, c.part.condition - energy * share / (mass(c.part) * 600));
    }
    if (root) root.part.condition = Math.max(0, root.part.condition - energy * 0.35 / (mass(root.part) * 150));
    // Transfer collision energy to nearby installed hardware. The engine is shielded by the body;
    // wheel hardware near the contact receives more of the load.
    for (const part of this.root.world.parts.values()) {
      const kind = part.definition.mechanics?.kind;
      if (!kind || !this.connected(part)) continue;
      const position = new Vector3().setFromMatrixPosition(part.matrix()).applyMatrix4(delta);
      const distance = Math.hypot(position.x - point.x, position.z - point.z);
      const reach = kind === 'engine' ? 0.85 : 0.65;
      const weight = Math.exp(-((distance / reach) ** 2)) * (kind === 'engine' ? 0.25 : 1);
      const threshold = kind === 'engine' ? 180000 : kind === 'suspension' ? 55000 : 40000;
      part.condition = Math.max(0, Math.min(part.condition, 1 - energy * weight / threshold));
    }
  }
  constructor(root: EnginePart, hood: EnginePart, samples: number[], chassisBounds: Box3, readonly terrain: Terrain & { ramp: boolean } = new TestTerrain(), readonly mapCollision?: MapCollision) {
    super(root, hood, samples, chassisBounds, { stiffness: 500000, yieldStrain: 0.012, mountStrength: 50000 });
    this.clock = new FixedClock(240, 8);
    this.originalTree = [...root.world.parts.values()].map(part => ({ part, parent: part.parent, parentSlot: part.parentSlot, ownSlot: part.ownSlot, local: part.local.clone() }));
    const total = [...root.world.parts.values()].reduce((s, p) => s + mass(p), 0), center = new Vector3();
    const inverse = root.matrix().invert();
    for (const p of root.world.parts.values()) {
      const bodies = p.definition.config.bodies;
      if (bodies.length) for (const b of bodies) center.addScaledVector(new Vector3(...b.position).applyMatrix4(p.matrix()).applyMatrix4(inverse), b.mass);
      else center.addScaledVector(new Vector3().setFromMatrixPosition(p.matrix()).applyMatrix4(inverse), mass(p));
    }
    center.multiplyScalar(1 / total);
    this.body = new RigidBody3D(total, chassisBounds, center); this.body.setFrame(root.matrix()); this.suspension = new Suspension3D(root, this.body, this.terrain);
    this.originalObstacle = { min: [...this.obstacle.min], max: [...this.obstacle.max] };
    this.addSoft(hood, this.panel, false);
  }
  private addSoft(part: EnginePart, panel: DeformablePanel, root: boolean) {
    // Bind reference basis before moving targets into the world.
    const old = panel.positions.slice(); panel.reset();
    if (part === this.hood) { const inverse = part.matrix().invert(); for (let i = 0; i < panel.positions.length; i += 3) new Vector3().fromArray(panel.positions, i).applyMatrix4(inverse).toArray(panel.positions, i); }
    const activity = new PanelActivity(panel); activity.reset(part.matrix());
    const soft = { part, panel, activity, center: centerOf(panel.positions), inverseBasis: basis(panel).invert(), root };
    panel.positions.set(old); this.soft.set(part, soft);
    if (panel !== this.panel) panel.colliders.push(this.obstacle);
    if (!root && panel !== this.panel) panel.surfaces.push({ project: (p, previous, i) => !part.parent ? this.rigidSurface?.project(p, previous, i) : undefined });
  }
  register(part: EnginePart, samples: number[], triangles: number[]) {
    const file = part.definition.cfgPath.split('/').at(-1) ?? '';
    const isRoot = part === this.root, isWheel = this.suspension.wheels.some(w => w.part === part);
    const engineBlock = this.suspension.mechanics?.block, isEngine = part.definition.mechanics?.kind === 'engine';
    if (isEngine && engineBlock && samples.length) {
      const relative = engineBlock.matrix().invert().multiply(part.matrix());
      for (let i = 0; i < samples.length; i += 3) this.engineHull.expandByPoint(new Vector3().fromArray(samples, i).applyMatrix4(relative));
      const cluster = this.rigid.get(engineBlock);
      if (cluster) cluster.body.bounds.copy(this.engineHull);
    }
    const metal = isRoot || /hood|trunk|door|quarterpanel|bumper|sideskirt/i.test(file);
    const rigid = isWheel || isEngine && part === engineBlock || !!part.definition.mechanics && !isEngine || /headlight|taillight|window|windshield/i.test(file);
    if (metal && part !== this.hood) {
      const own = part.definition.config.slots.find(s => s.id === part.ownSlot);
      const panel = new DeformablePanel(samples, { mass: mass(part), mount: own ? [...own.position] : [0, 0, 0], volume: true, resolution: isRoot ? [5, 7] : [4, 5], stiffness: isRoot ? 1500000 : 750000, yieldStrain: isRoot ? 0.006 : 0.018, mountStrength: isRoot ? 1e15 : Math.max(9000, mass(part) * 1500), gravity: isRoot ? 0 : 9.81 });
      this.addSoft(part, panel, isRoot); panel.setAnchorFrame(part.matrix().elements); panel.reset();
    } else if (rigid && samples.length && !this.rigid.has(part)) {
      const body = new RigidBody3D(mass(part), isEngine && !this.engineHull.isEmpty() ? this.engineHull.clone() : boundsOf(samples)); body.setFrame(part.matrix()); this.rigid.set(part, { part, body, previous: part.matrix(), peakForce: 0 });
    }
    const soft = this.soft.get(part);
    if (!part.definition.mechanics && !isWheel) this.geometry.push({ part, triangles, bindings: soft && Array.from({ length: triangles.length / 3 }, (_, i) => soft.panel.bind(triangles.slice(i * 3, i * 3 + 3))) });
  }
  override setBodyTriangles(triangles: ArrayLike<number>) { super.setBodyTriangles(triangles, true); this.triangleSource = Array.from(triangles); this.rigidSurface = this.bodySurface; this.surfaceTopology = ''; this.configureStructure(); }
  private updateSurface() {
    if (!this.geometry.length) return;
    const inverse = this.root.matrix().invert(), triangles = this.surfaceCoordinates, out = [0, 0, 0], point = new Vector3();
    triangles.length = 0;
    let topology = '';
    for (const g of this.geometry) {
      if (g.part === this.hood || g.part.definition.mechanics || !this.connected(g.part)) continue;
      topology += `${g.part.id},`;
      const matrix = inverse.clone().multiply(g.part.matrix());
      for (let i = 0; i < g.triangles.length; i += 3) {
        if (g.bindings) { this.soft.get(g.part)!.panel.skin(g.bindings[i / 3], out); point.fromArray(out).applyMatrix4(inverse); }
        else point.fromArray(g.triangles, i).applyMatrix4(matrix);
        triangles.push(point.x, point.y, point.z);
      }
    }
    if (!triangles.length) return;
    if (topology === this.surfaceTopology && this.bodySurface) this.bodySurface.refit(triangles);
    else { super.setBodyTriangles(triangles, true); this.rigidSurface = this.bodySurface; this.surfaceTopology = topology; }
    this.surfaceTick = this.clock.tick + 1;
  }
  private connected(part: EnginePart) { for (let p: EnginePart | undefined = part; p; p = p.parent) if (p === this.root) return true; return false; }
  private subtreeMass(part: EnginePart): number { let total = mass(part); for (const child of part.children.values()) total += this.subtreeMass(child); return total; }
  override velocity() { return this.body ? this.body.velocity.clone() : super.velocity(); }
  override pointVelocity(point: Vector3) { return this.body ? this.body.pointVelocity(point) : super.pointVelocity(point); }
  override applyImpulse(j: Vector3, point: Vector3) {
    if (this.body) { this.body.impulse(j, point); if (j.length() / this.body.mass / this.clock.dt > 25) this.pendingShock = true; }
    else super.applyImpulse(j, point);
  }
  override reset(speed = 0) {
    super.reset(speed);
    if (!this.body) return;
    if (this.spawn) {
      this.driving.position.x = this.spawn.position.x;
      this.driving.position.z = this.spawn.position.z;
      this.driving.position.y += this.spawn.position.y;
      this.driving.yaw = this.spawn.yaw;
      this.driving.sync();
    }
    this.clock = new FixedClock(240, 8);
    for (const s of this.originalTree) if (s.parent && s.part.parent !== s.parent) { if (s.part.parent) this.root.world.detach(s.part); this.root.world.install(s.parent, s.parentSlot!, s.part, s.ownSlot!); }
    for (const s of this.originalTree) if (s.part !== this.root) s.part.local.copy(s.local);
    for (const s of this.originalTree) s.part.condition = 1;
    this.body.setMass([...this.root.world.parts.values()].reduce((s, p) => s + mass(p), 0)); this.body.setFrame(this.root.matrix()); this.body.velocity.z = -speed; this.suspension.reset(); this.terrain.ramp = false;
    this.lastVelocity.copy(this.body.velocity); this.lastOmega.copy(this.body.omega); this.surfaceDirty = this.pendingShock = false;
    this.surfaceTick = -4;
    this.obstacle.min.splice(0, 3, ...this.originalObstacle.min); this.obstacle.max.splice(0, 3, ...this.originalObstacle.max);
    for (const s of this.soft.values()) { s.panel.setAnchorFrame(s.part.matrix().elements); s.panel.reset(); s.activity.reset(s.part.matrix()); for (let i = 0; i < s.panel.velocities.length; i += 3) this.body.pointVelocity(new Vector3().fromArray(s.panel.positions, i)).toArray(s.panel.velocities, i); }
    for (const r of this.rigid.values()) { r.body.setMass(mass(r.part)); r.body.center.copy(r.body.bounds.getCenter(new Vector3())); r.body.setFrame(r.part.matrix()); r.previous.copy(r.part.matrix()); r.peakForce = 0; }
    if (this.triangleSource) { super.setBodyTriangles(this.triangleSource, true); this.rigidSurface = this.bodySurface; this.surfaceTopology = ''; }
    this.configureStructure();
  }
  placeAt(position: Vector3, yaw: number) { this.spawn = { position: position.clone(), yaw }; this.reset(); }
  disableObstacle() {
    this.originalObstacle.min.splice(0, 3, 100000, 100000, 100000);
    this.originalObstacle.max.splice(0, 3, 100001, 100001, 100001);
    this.obstacle.min.splice(0, 3, ...this.originalObstacle.min);
    this.obstacle.max.splice(0, 3, ...this.originalObstacle.max);
  }
  jump() { this.reset(14); this.terrain.ramp = true; this.obstacle.min[0] += 20; this.obstacle.max[0] += 20; }
  rearCrash(speed = 50 / 3.6) { this.reset(speed); this.body.velocity.z = speed; const dz = 16; this.obstacle.min[2] += dz; this.obstacle.max[2] += dz; this.lastVelocity.copy(this.body.velocity); }
  override dropOnRoof() { super.dropOnRoof(); this.body.setMass([...this.root.world.parts.values()].filter(p => this.connected(p)).reduce((s, p) => s + mass(p), 0)); }
  roll() { this.reset(); this.body.impulse(new Vector3(this.body.mass * 5, this.body.mass * 2, 0), this.body.position.clone().add(new Vector3(0, 1, 0))); }
  private syncBody() {
    this.root.local.copy(this.body.matrix()); this.driving.position.setFromMatrixPosition(this.root.local); this.driving.speed = this.body.velocity.dot(new Vector3(0, 0, -1).applyQuaternion(this.body.orientation)); this.suspension.sync();
  }
  private releaseFailedWheels() {
    let released = false;
    this.suspension.wheels.forEach((wheel, index) => {
      if (wheel.part.parent !== this.root) return;
      const strut = this.suspension.mechanics?.component(index, 'strut');
      if (wheel.part.condition > 0 && wheel.mountCondition > 0 && strut !== 0) return;
      const frame = wheel.part.matrix(), rigid = this.rigid.get(wheel.part);
      wheel.part.condition = 0;
      if (rigid) {
        rigid.body.setFrame(frame);
        rigid.body.velocity.copy(this.body.pointVelocity(rigid.body.position));
        rigid.body.setAngularVelocity(this.body.omega);
        rigid.previous.copy(frame);
      }
      this.root.world.detach(wheel.part);
      released = true;
    });
    return released;
  }
  /** Probe first so a hard impact can wake XPBD before any rigid proxy impulse is applied. */
  private freeContacts(body: RigidBody3D, previous: Matrix4, obstacle: Box3, apply: boolean, shape?: Float64Array) {
    let speed = 0;
    const solve = (point: Vector3, normal: Vector3, depth: number, carrier = false) => {
      const relative = body.pointVelocity(point); if (carrier) relative.sub(this.body.pointVelocity(point));
      speed = Math.max(speed, -relative.dot(normal));
      if (apply) { const impulse = body.contact(point, normal, depth); if (carrier) this.applyImpulse(impulse.negate(), point); }
    };
    const contact = boxContact(body, obstacle); if (contact) solve(contact.point, contact.normal, contact.depth);
    const matrix = body.matrix(), inverse = matrix.clone().invert();
    const swept = body.bounds.clone().applyMatrix4(matrix).union(body.bounds.clone().applyMatrix4(previous)), nearBody = this.rigidSurface?.intersectsWorld(swept);
    const points: Vector3[] = [];
    if (shape) { const delta = matrix.clone().multiply(previous.clone().invert()); for (let i = 0; i < shape.length; i += 3) points.push(new Vector3().fromArray(shape, i).applyMatrix4(delta)); }
    else points.push(...body.corners());
    for (const point of points) {
      const height = this.terrain.height(point.x, point.z, point.y);
      if (point.y < height) solve(point, this.terrain.normal(point.x, point.z, point.y), height - point.y);
      if (!nearBody) continue;
      const old = point.clone().applyMatrix4(inverse).applyMatrix4(previous), projected = new Float64Array(point.toArray());
      const hit = this.rigidSurface?.project(projected, new Float64Array(old.toArray()), 0);
      if (hit) { const normal = new Vector3(...hit.normal); solve(point, normal, new Vector3().fromArray(projected).sub(point).dot(normal), true); }
    }
    return speed;
  }
  override advance(seconds: number, input: DrivingInput) {
    if (this.root.world.disposed) throw new Error('3D world disposed');
    if (![input.throttle, input.steer].every(Number.isFinite)) throw new Error('Finite vehicle input required');
    return this.clock.advance(seconds, tick => {
      const dt = this.clock.dt, previous = this.root.matrix();
      let detached = this.releaseFailedWheels();
      this.suspension.step(dt, input); this.body.integrate(dt);
      const incomingVelocity = this.body.velocity.clone(), incomingOmega = this.body.omega, predicted = this.body.matrix();
      const obstacle = new Box3(new Vector3(...this.obstacle.min), new Vector3(...this.obstacle.max));
      for (let iteration = 0; iteration < 4; iteration++) {
        for (const p of this.body.corners()) {
          const height = this.terrain.height(p.x, p.z, p.y); if (p.y < height) {
            const j = this.body.contact(p, this.terrain.normal(p.x, p.z, p.y), height - p.y, 0.12);
            if (j.length() > 40) this.soft.get(this.root)?.panel.impulseAt(j.clone().multiplyScalar(0.08).toArray() as Triple, p.toArray() as Triple);
          }
          const wall = this.mapCollision?.contact(p, 0.2, false);
          if (wall) this.body.contact(wall.point, wall.normal, wall.depth, 0.18);
        }
        const mapBody = this.mapCollision?.bodyContact(this.body);
        if (mapBody) {
          const speed = Math.max(0, -this.body.pointVelocity(mapBody.point).dot(mapBody.normal));
          const j = this.body.contact(mapBody.point, mapBody.normal, mapBody.depth, 0.22);
          this.impactSpeed = Math.max(this.impactSpeed, speed);
          this.reboundSpeed = Math.max(this.reboundSpeed, this.body.velocity.length());
          this.damageImpact(j, mapBody.point, mapBody.bounds, predicted, previous);
        }
        const c = boxContact(this.body, obstacle);
        if (c) {
          const speed = Math.max(0, -this.body.pointVelocity(c.point).dot(c.normal)), j = this.body.contact(c.point, c.normal, c.depth, 0.22);
          this.impactSpeed = Math.max(this.impactSpeed, speed); this.reboundSpeed = Math.max(this.reboundSpeed, this.body.velocity.length());
          this.damageImpact(j, c.point, obstacle, predicted, previous);
        }
      }
      this.syncBody(); this.bodySurface?.setFrames(previous, this.root.matrix());
      const omega = this.body.omega;
      // Gravity and normal suspension load alone do not require a node solve. Hard accelerations,
      // angular shocks and centrifugal loads can deform panels or overload their attachments.
      const shock = this.pendingShock || this.body.velocity.distanceTo(this.lastVelocity) / dt > 25 || omega.distanceTo(this.lastOmega) / dt > 10 || omega.lengthSq() * 3 > 25;
      this.pendingShock = false;
      const ordered = [...this.soft.values()].sort((a, b) => Number(b.root) - Number(a.root) || Number(!!b.part.parent) - Number(!!a.part.parent) || Number(a.part === this.hood) - Number(b.part === this.hood));
      let freeSurfaceUpdated = false;
      for (const s of ordered) {
        const attached = !!s.part.parent || s.root, frame = s.part.matrix();
        if ((!attached || s.part === this.hood && (s.activity.deforming || s.activity.forced)) && !freeSurfaceUpdated && this.surfaceDirty && tick - this.surfaceTick >= 4) { this.updateSurface(); this.surfaceDirty = false; freeSurfaceUpdated = true; }
        if (!s.root && s.part.condition === 0) s.panel.mounts.forEach(m => { m.broken = true; });
        if (attached) s.panel.setAnchorFrame(frame.elements);
        if (!s.activity.deforming && (s.activity.forced || !s.root && s.part.condition === 0 && attached || attached && (shock || s.activity.threatened(frame, obstacle)))) s.activity.wake();
        if (!attached && !s.activity.deforming && !s.activity.freeBody) s.activity.wake();
        if (!attached && !s.activity.deforming) {
          const free = s.activity.freeBody!, old = free.matrix(); free.integrate(dt);
          if (this.freeContacts(free, old, obstacle, false, s.panel.positions) > 0.8) s.activity.wake();
          else { this.freeContacts(free, old, obstacle, true, s.panel.positions); s.part.local.copy(free.matrix()); s.activity.carry(dt, s.part.local, free); }
        } else if (!s.activity.deforming) s.activity.carry(dt, frame, this.body);
        if (!s.activity.deforming) { if (attached) this.moveMounts(s.part); continue; }
        s.panel.advance(dt); if (attached) this.surfaceDirty = true;
        if (tick % 24 === 0) {
          const strain = s.panel.beams.reduce((sum, b) => sum + Math.abs(b.rest - b.initial) / b.initial, 0) / s.panel.beams.length;
          s.part.condition = Math.min(s.part.condition, Math.max(0, 1 - strain / (s.root ? 0.3 : 0.4)));
        }
        if (!s.root && !s.panel.attached) s.part.condition = 0;
        if (!s.root && s.part.condition === 0 && s.part.parent) { this.root.world.detach(s.part); detached = true; }
        if (s.part.parent || s.root) this.moveMounts(s.part);
        if (!s.root && !s.part.parent) {
          const frame = basis(s.panel).multiply(s.inverseBasis), center = centerOf(s.panel.positions); frame.setPosition(center.sub(s.center.clone().applyMatrix4(frame))); s.part.local.copy(frame);
        }
        s.activity.settle(dt, s.part.matrix(), !!s.part.parent || s.root);
      }
      for (const r of this.rigid.values()) {
        const wasAttached = !!r.part.parent;
        if (wasAttached && (this.suspension.wheels.some(w => w.part === r.part) || r.part.definition.mechanics && (r.part !== this.suspension.mechanics?.block || r.part.condition > 0))) continue;
        const mount = r.part.definition.config.slots.find(s => s.id === r.part.ownSlot), mountPoint = mount ? new Vector3(...mount.position).applyMatrix4(r.part.matrix()) : r.body.position.clone();
        const size = r.body.bounds.getSize(new Vector3()), bracket = Math.max(0.02, Math.min(size.x, size.y, size.z) * 0.2);
        const load = (j: Vector3, point: Vector3) => (j.length() + new Vector3().crossVectors(point.clone().sub(mountPoint), j).length() / bracket) / dt;
        if (wasAttached) { r.body.setFrame(r.part.matrix()); r.body.velocity.copy(incomingVelocity).add(new Vector3().crossVectors(incomingOmega, r.body.position.clone().sub(this.body.position))); r.body.setAngularVelocity(incomingOmega); }
        else r.body.integrate(dt);
        if (wasAttached && r.part.condition === 0) {
          if (r.part === this.suspension.mechanics?.block) { r.body.center.copy(r.body.bounds.getCenter(new Vector3())); r.body.setMass(this.subtreeMass(r.part)); r.body.setFrame(r.part.matrix()); r.body.velocity.copy(incomingVelocity); r.body.setAngularVelocity(incomingOmega); }
          this.root.world.detach(r.part); detached = true;
        }
        // Interior hardware is loaded by the chassis impact above. Its render bounds may overlap
        // the chassis and the ground; resolve physical contacts once it actually breaks loose.
        if (wasAttached && r.part.definition.mechanics) { r.previous.copy(r.body.matrix()); continue; }
        const contact = boxContact(r.body, obstacle);
        if (contact) {
          const j = r.body.contact(contact.point, contact.normal, contact.depth);
          r.peakForce = Math.max(r.peakForce, load(j, contact.point));
          if (wasAttached) r.part.condition = Math.min(r.part.condition, Math.max(0, 1 - r.peakForce / 1800));
          if (r.part.parent && r.part.condition === 0) { this.root.world.detach(r.part); detached = true; }
        }
        if (r.part.parent) for (const point of r.body.corners()) {
          const h = this.terrain.height(point.x, point.z, point.y);
          if (point.y < h) { const j = r.body.contact(point, this.terrain.normal(point.x, point.z, point.y), h - point.y); r.peakForce = Math.max(r.peakForce, load(j, point)); r.part.condition = Math.min(r.part.condition, Math.max(0, 1 - r.peakForce / 1800)); if (r.part.condition === 0) { this.root.world.detach(r.part); detached = true; break; } }
        }
        if (!r.part.parent) {
          for (const point of r.body.corners()) {
            const h = this.terrain.height(point.x, point.z, point.y); if (point.y < h) r.body.contact(point, this.terrain.normal(point.x, point.z, point.y), h - point.y);
          }
          const corners = r.body.corners(), old = r.previous;
          for (const p of corners) {
            const local = p.clone().applyMatrix4(r.body.matrix().invert()), prev = local.applyMatrix4(old), current = new Float64Array(p.toArray()), contact = this.rigidSurface?.project(current, new Float64Array(prev.toArray()), 0);
            if (contact) { const n = new Vector3(...contact.normal), j = r.body.contact(p, n, new Vector3().fromArray(current).sub(p).dot(n)); this.body.impulse(j.negate(), p); }
          }
          r.part.local.copy(r.body.matrix());
        }
        r.previous.copy(r.body.matrix());
      }
      if (detached) { const omega = this.body.omega; this.body.setMass([...this.root.world.parts.values()].filter(p => this.connected(p)).reduce((s, p) => s + mass(p), 0)); this.body.setAngularVelocity(omega); this.updateSurface(); }
      // Refit deformed body contact geometry periodically; never retain detached-panel ghost colliders.
      if (tick % 24 === 0 && this.surfaceDirty) { this.updateSurface(); this.surfaceDirty = false; }
      this.suspension.sync();
      this.lastVelocity.copy(this.body.velocity); this.lastOmega.copy(this.body.omega);
    });
  }
  override dispose() { this.reset(); }
}
