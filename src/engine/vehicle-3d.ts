import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import { CarCrashDemo } from './car-crash-demo';
import { RigidBody3D, boxContact } from './rigid-body-3d';
import { Suspension3D, TestTerrain } from './suspension-3d';
import { DeformablePanel, type PanelBinding, type Triple } from './deformable-panel';
import { TriangleSurface } from './triangle-surface';
import type { EnginePart } from './world';
import type { DrivingInput } from './driving-demo';

export interface SoftBodyPart { part: EnginePart; panel: DeformablePanel; center: Vector3; inverseBasis: Matrix4; root: boolean }
export interface RigidPart { part: EnginePart; body: RigidBody3D; previous: Matrix4; peakForce: number }
interface Geometry { part: EnginePart; triangles: number[]; bindings?: PanelBinding[] }
const mass = (p: EnginePart) => Math.max(0.1, p.definition.config.bodies.reduce((s, b) => s + b.mass, 0));
const boundsOf = (samples: ArrayLike<number>) => { const box = new Box3(); for (let i = 0; i < samples.length; i += 3) box.expandByPoint(new Vector3().fromArray(samples, i)); return box; };
const centerOf = (p: ArrayLike<number>) => { const out = new Vector3(); for (let i = 0; i < p.length; i += 3) out.add(new Vector3().fromArray(p, i)); return out.multiplyScalar(3 / p.length); };
function basis(panel: DeformablePanel) {
  const p = panel.positions, point = (x: number, z: number) => new Vector3().fromArray(p, (z * panel.nx + x) * 3);
  const x = point(panel.nx - 1, 0).sub(point(0, 0)).normalize(), z = point(0, panel.nz - 1).sub(point(0, 0)).normalize(), y = new Vector3().crossVectors(z, x).normalize(); z.crossVectors(x, y).normalize(); return new Matrix4().makeBasis(x, y, z);
}

/** Full rigid chassis motion with ray suspension and separate deformable or rigid detachable parts. */
export class Vehicle3D extends CarCrashDemo {
  readonly body: RigidBody3D;
  readonly terrain = new TestTerrain();
  readonly suspension: Suspension3D;
  readonly soft = new Map<EnginePart, SoftBodyPart>();
  readonly rigid = new Map<EnginePart, RigidPart>();
  private geometry: Geometry[] = [];
  private originalTree: { part: EnginePart; parent?: EnginePart; parentSlot?: number; ownSlot?: number; local: Matrix4 }[];
  private originalObstacle: { min: Triple; max: Triple };
  private rigidSurface?: TriangleSurface;
  private triangleSource?: number[];
  constructor(root: EnginePart, hood: EnginePart, samples: number[], chassisBounds: Box3) {
    super(root, hood, samples, chassisBounds);
    this.originalTree = [...root.world.parts.values()].map(part => ({ part, parent: part.parent, parentSlot: part.parentSlot, ownSlot: part.ownSlot, local: part.local.clone() }));
    const total = [...root.world.parts.values()].reduce((s, p) => s + mass(p), 0), center = new Vector3();
    const inverse = root.matrix().invert();
    for (const p of root.world.parts.values()) for (const b of p.definition.config.bodies) center.addScaledVector(new Vector3(...b.position).applyMatrix4(p.matrix()).applyMatrix4(inverse), b.mass);
    center.multiplyScalar(1 / total);
    this.body = new RigidBody3D(total, chassisBounds, center); this.body.setFrame(root.matrix()); this.suspension = new Suspension3D(root, this.body, this.terrain);
    this.originalObstacle = { min: [...this.obstacle.min], max: [...this.obstacle.max] };
    this.addSoft(hood, this.panel, false);
  }
  private addSoft(part: EnginePart, panel: DeformablePanel, root: boolean) {
    // Bind reference basis before moving targets into the world.
    const old = panel.positions.slice(); panel.reset();
    if (part === this.hood) { const inverse = part.matrix().invert(); for (let i = 0; i < panel.positions.length; i += 3) new Vector3().fromArray(panel.positions, i).applyMatrix4(inverse).toArray(panel.positions, i); }
    const soft = { part, panel, center: centerOf(panel.positions), inverseBasis: basis(panel).invert(), root };
    panel.positions.set(old); this.soft.set(part, soft);
    if (panel !== this.panel) panel.colliders.push(this.obstacle);
    if (!root && panel !== this.panel) panel.surfaces.push({ project: (p, previous, i) => !part.parent ? this.rigidSurface?.project(p, previous, i) : undefined });
  }
  register(part: EnginePart, samples: number[], triangles: number[]) {
    const file = part.definition.cfgPath.split('/').at(-1) ?? '';
    const isRoot = part === this.root, metal = isRoot || /hood|trunk|door|quarterpanel|bumper|sideskirt/i.test(file), rigid = /headlight|taillight|window|windshield/i.test(file);
    if (metal && part !== this.hood) {
      const own = part.definition.config.slots.find(s => s.id === part.ownSlot);
      const panel = new DeformablePanel(samples, { mass: mass(part), mount: own ? [...own.position] : [0, 0, 0], volume: true, resolution: isRoot ? [5, 7] : [4, 5], stiffness: isRoot ? 8000000 : 600000, yieldStrain: isRoot ? 0.02 : 0.012, mountStrength: isRoot ? 1e15 : Math.max(6000, mass(part) * 1000), gravity: isRoot ? 0 : 9.81 });
      this.addSoft(part, panel, isRoot); panel.setAnchorFrame(part.matrix().elements); panel.reset();
    } else if (rigid && !this.rigid.has(part)) {
      const body = new RigidBody3D(mass(part), boundsOf(samples)); body.setFrame(part.matrix()); this.rigid.set(part, { part, body, previous: part.matrix(), peakForce: 0 });
    }
    const soft = this.soft.get(part);
    this.geometry.push({ part, triangles, bindings: soft && Array.from({ length: triangles.length / 3 }, (_, i) => soft.panel.bind(triangles.slice(i * 3, i * 3 + 3))) });
  }
  override setBodyTriangles(triangles: ArrayLike<number>) { super.setBodyTriangles(triangles); this.triangleSource = Array.from(triangles); this.makeRigidSurface(this.triangleSource); }
  private makeRigidSurface(triangles: number[]) {
    this.rigidSurface = new TriangleSurface(triangles, () => true, point => this.body.pointVelocity(point), (j, p) => this.body.impulse(new Vector3(...j).negate(), new Vector3(...p)));
  }
  private updateSurface() {
    if (!this.geometry.length) return;
    const inverse = this.root.matrix().invert(), triangles: number[] = [], out = [0, 0, 0];
    for (const g of this.geometry) {
      if (g.part === this.hood || !this.connected(g.part)) continue;
      const matrix = inverse.clone().multiply(g.part.matrix());
      for (let i = 0; i < g.triangles.length; i += 3) {
        if (g.bindings) { this.soft.get(g.part)!.panel.skin(g.bindings[i / 3], out); triangles.push(...new Vector3(...out).applyMatrix4(inverse).toArray()); }
        else triangles.push(...new Vector3().fromArray(g.triangles, i).applyMatrix4(matrix).toArray());
      }
    }
    if (!triangles.length) return;
    super.setBodyTriangles(triangles); this.makeRigidSurface(triangles);
  }
  private connected(part: EnginePart) { for (let p: EnginePart | undefined = part; p; p = p.parent) if (p === this.root) return true; return false; }
  override velocity() { return this.body ? this.body.velocity.clone() : super.velocity(); }
  override pointVelocity(point: Vector3) { return this.body ? this.body.pointVelocity(point) : super.pointVelocity(point); }
  override applyImpulse(j: Vector3, point: Vector3) { if (this.body) this.body.impulse(j, point); else super.applyImpulse(j, point); }
  override reset(speed = 0) {
    super.reset(speed);
    if (!this.body) return;
    for (const s of this.originalTree) if (s.parent && s.part.parent !== s.parent) { if (s.part.parent) this.root.world.detach(s.part); this.root.world.install(s.parent, s.parentSlot!, s.part, s.ownSlot!); }
    for (const s of this.originalTree) if (s.part !== this.root) s.part.local.copy(s.local);
    this.body.setMass([...this.root.world.parts.values()].reduce((s, p) => s + mass(p), 0)); this.body.setFrame(this.root.matrix()); this.body.velocity.z = -speed; this.suspension.reset(); this.terrain.ramp = false;
    this.obstacle.min.splice(0, 3, ...this.originalObstacle.min); this.obstacle.max.splice(0, 3, ...this.originalObstacle.max);
    for (const s of this.soft.values()) { s.panel.setAnchorFrame(s.part.matrix().elements); s.panel.reset(); for (let i = 0; i < s.panel.velocities.length; i += 3) this.body.pointVelocity(new Vector3().fromArray(s.panel.positions, i)).toArray(s.panel.velocities, i); }
    for (const r of this.rigid.values()) { r.body.setFrame(r.part.matrix()); r.previous.copy(r.part.matrix()); r.peakForce = 0; }
    if (this.triangleSource) { super.setBodyTriangles(this.triangleSource); this.makeRigidSurface(this.triangleSource); }
  }
  jump() { this.reset(14); this.terrain.ramp = true; this.obstacle.min[0] += 20; this.obstacle.max[0] += 20; }
  override dropOnRoof() { super.dropOnRoof(); this.body.setMass([...this.root.world.parts.values()].filter(p => this.connected(p)).reduce((s, p) => s + mass(p), 0)); }
  roll() { this.reset(); this.body.impulse(new Vector3(this.body.mass * 5, this.body.mass * 2, 0), this.body.position.clone().add(new Vector3(0, 1, 0))); }
  private syncBody() {
    this.root.local.copy(this.body.matrix()); this.driving.position.setFromMatrixPosition(this.root.local); this.driving.speed = this.body.velocity.dot(new Vector3(0, 0, -1).applyQuaternion(this.body.orientation)); this.suspension.sync();
  }
  override advance(seconds: number, input: DrivingInput) {
    if (this.root.world.disposed) throw new Error('3D world disposed');
    if (![input.throttle, input.steer].every(Number.isFinite)) throw new Error('Finite vehicle input required');
    return this.clock.advance(seconds, tick => {
      const dt = this.clock.dt, previous = this.root.matrix();
      this.suspension.step(dt, input); this.body.integrate(dt);
      const incomingVelocity = this.body.velocity.clone(), incomingOmega = this.body.omega;
      const obstacle = new Box3(new Vector3(...this.obstacle.min), new Vector3(...this.obstacle.max));
      for (let iteration = 0; iteration < 4; iteration++) {
        for (const p of this.body.corners()) {
          const height = this.terrain.height(p.x, p.z); if (p.y < height) {
            const j = this.body.contact(p, this.terrain.normal(p.x, p.z), height - p.y, 0.12);
            if (j.length() > 40) this.soft.get(this.root)?.panel.impulseAt(j.clone().multiplyScalar(0.08).toArray() as Triple, p.toArray() as Triple);
          }
        }
        const c = boxContact(this.body, obstacle);
        if (c) {
          const speed = Math.max(0, -this.body.pointVelocity(c.point).dot(c.normal)), j = this.body.contact(c.point, c.normal, c.depth, 0.22);
          this.impactSpeed = Math.max(this.impactSpeed, speed); this.reboundSpeed = Math.max(this.reboundSpeed, this.body.velocity.length());
          this.soft.get(this.root)?.panel.impulseAt(j.clone().multiplyScalar(0.12).toArray() as Triple, c.point.toArray() as Triple);
        }
      }
      this.syncBody(); this.bodySurface?.setFrames(previous, this.root.matrix()); this.rigidSurface?.setFrames(previous, this.root.matrix());
      let detached = false;
      for (const s of this.soft.values()) {
        if (s.part.parent || s.root) s.panel.setAnchorFrame(s.part.matrix().elements);
        s.panel.advance(dt);
        if (!s.root && !s.panel.attached && s.part.parent) { this.root.world.detach(s.part); detached = true; }
        if (!s.root && !s.part.parent) {
          const frame = basis(s.panel).multiply(s.inverseBasis), center = centerOf(s.panel.positions); frame.setPosition(center.sub(s.center.clone().applyMatrix4(frame))); s.part.local.copy(frame);
        }
      }
      for (const r of this.rigid.values()) {
        const wasAttached = !!r.part.parent;
        const mount = r.part.definition.config.slots.find(s => s.id === r.part.ownSlot), mountPoint = mount ? new Vector3(...mount.position).applyMatrix4(r.part.matrix()) : r.body.position.clone();
        const size = r.body.bounds.getSize(new Vector3()), bracket = Math.max(0.02, Math.min(size.x, size.y, size.z) * 0.2);
        const load = (j: Vector3, point: Vector3) => (j.length() + new Vector3().crossVectors(point.clone().sub(mountPoint), j).length() / bracket) / dt;
        if (wasAttached) { r.body.setFrame(r.part.matrix()); r.body.velocity.copy(incomingVelocity).add(new Vector3().crossVectors(incomingOmega, r.body.position.clone().sub(this.body.position))); r.body.setAngularVelocity(incomingOmega); }
        else r.body.integrate(dt);
        const contact = boxContact(r.body, obstacle);
        if (contact) {
          const j = r.body.contact(contact.point, contact.normal, contact.depth);
          r.peakForce = Math.max(r.peakForce, load(j, contact.point));
          if (wasAttached && r.peakForce > 1800) { this.root.world.detach(r.part); detached = true; }
        }
        if (r.part.parent) for (const point of r.body.corners()) {
          const h = this.terrain.height(point.x, point.z);
          if (point.y < h) { const j = r.body.contact(point, this.terrain.normal(point.x, point.z), h - point.y); r.peakForce = Math.max(r.peakForce, load(j, point)); if (r.peakForce > 1800) { this.root.world.detach(r.part); detached = true; break; } }
        }
        if (!r.part.parent) {
          for (const point of r.body.corners()) {
            const h = this.terrain.height(point.x, point.z); if (point.y < h) r.body.contact(point, this.terrain.normal(point.x, point.z), h - point.y);
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
      if (tick % 24 === 0) this.updateSurface();
    });
  }
  override dispose() { this.reset(); }
}
