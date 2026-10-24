import { Box3, Matrix4, Vector3 } from 'three';
import { DrivingDemo, type DrivingInput } from './driving-demo';
import { DeformablePanel, type PanelCollider, type PanelOptions } from './deformable-panel';
import type { EnginePart } from './world';
import { FixedClock } from '../runtime/fixed-clock';
import { TriangleSurface } from './triangle-surface';

/** Planar chassis impulses + deformable hood. Contact drives damage; presets only set initial state. */
export class CarCrashDemo {
  readonly driving: DrivingDemo;
  readonly panel: DeformablePanel;
  clock = new FixedClock(240, 32);
  readonly obstacle: PanelCollider;
  impactSpeed = 0;
  readonly lateralVelocity = new Vector3();
  yawVelocity = 0;
  readonly mass: number;
  readonly inertia: number;
  bodySurface?: TriangleSurface;
  reboundSpeed = 0;
  private parent: EnginePart; private parentSlot: number; private ownSlot: number;
  private originalLocal: Matrix4;
  private localCenter: Vector3;
  private referenceInverse: Matrix4;
  private hoodSurface = { project: (p: Float64Array, previous: Float64Array, offset: number) => !this.panel.attached ? this.bodySurface?.project(p, previous, offset) : undefined };
  constructor(readonly root: EnginePart, readonly hood: EnginePart, samples: ArrayLike<number>, readonly chassisBounds: Box3, material: Pick<PanelOptions, 'stiffness' | 'yieldStrain' | 'mountStrength'> = {}) {
    if (!hood.parent || hood.world !== root.world) throw new Error('Crash demo needs an installed hood');
    this.parent = hood.parent; this.parentSlot = hood.parentSlot!; this.ownSlot = hood.ownSlot!; this.originalLocal = hood.local.clone();
    this.driving = new DrivingDemo(root);
    const cfg = hood.definition.config, slot = cfg.slots.find(s => s.id === this.ownSlot)!;
    this.panel = new DeformablePanel(samples, { ...material, mass: cfg.bodies.reduce((s, b) => s + b.mass, 0), mount: [...slot.position] });
    this.localCenter = this.center(this.panel.positions);
    this.referenceInverse = this.cageBasis(this.panel.positions)!.invert();
    this.panel.setAnchorFrame(hood.matrix().elements); this.panel.reset();
    const ys = Array.from(this.panel.positions).filter((_, i) => i % 3 === 1);
    // Elevated rigid crossbeam intersects the hood; rendering uses these exact contact bounds.
    this.obstacle = { min: [-1.65, Math.min(...ys) - 0.06, -8.4], max: [1.65, Math.max(...ys) + 0.12, -8] };
    this.panel.colliders.push(this.obstacle);
    this.obstacle.restitution = 0.12;
    this.mass = Math.max(1, [...root.world.parts.values()].reduce((sum, p) => sum + p.definition.config.bodies.reduce((s, b) => s + b.mass, 0), 0) - cfg.bodies.reduce((sum, b) => sum + b.mass, 0));
    const size = chassisBounds.getSize(new Vector3()); this.inertia = this.mass * (size.x * size.x + size.z * size.z) / 12;
  }
  setBodyTriangles(triangles: ArrayLike<number>, includeAttached = false) {
    if (!this.bodySurface) this.panel.surfaces.push(this.hoodSurface);
    this.bodySurface = new TriangleSurface(triangles, () => includeAttached || !this.panel.attached, point => this.pointVelocity(point), (impulse, point) => this.applyImpulse(new Vector3(...impulse).negate(), new Vector3(...point)));
    this.bodySurface.setFrames(this.root.matrix(), this.root.matrix());
  }
  velocity() { return new Vector3(-Math.sin(this.driving.yaw), 0, -Math.cos(this.driving.yaw)).multiplyScalar(this.driving.speed).add(this.lateralVelocity); }
  pointVelocity(point: Vector3) { return this.velocity().add(new Vector3().crossVectors(new Vector3(0, this.yawVelocity, 0), point.clone().sub(this.driving.position))); }
  dropOnRoof() {
    if (!this.bodySurface) throw new Error('Body collision surface not loaded');
    this.reset(); this.hood.world.detach(this.hood); this.panel.mounts.forEach(m => { m.broken = true; });
    const roof = this.bodySurface.roofPoint().applyMatrix4(this.root.matrix()), center = this.center(this.panel.positions);
    const bottom = Math.min(...this.panel.positions.filter((_, i) => i % 3 === 1));
    const delta = new Vector3(roof.x - center.x, roof.y + 0.6 - bottom, roof.z - center.z);
    for (let i = 0; i < this.panel.positions.length; i += 3) { for (let a = 0; a < 3; a++) this.panel.positions[i + a] += delta.getComponent(a); this.panel.velocities[i + 1] = -1; }
    this.updateDetachedPose();
  }
  applyImpulse(impulse: Vector3, point: Vector3) {
    const velocity = this.velocity().addScaledVector(impulse, 1 / this.mass), forward = new Vector3(-Math.sin(this.driving.yaw), 0, -Math.cos(this.driving.yaw));
    this.driving.speed = velocity.dot(forward); this.lateralVelocity.copy(velocity).addScaledVector(forward, -this.driving.speed); this.lateralVelocity.y = 0;
    this.yawVelocity += new Vector3().crossVectors(point.clone().sub(this.driving.position), impulse).y / this.inertia;
  }
  private center(p: ArrayLike<number>) {
    const out = new Vector3(); for (let i = 0; i < p.length; i += 3) out.add(new Vector3(p[i], p[i + 1], p[i + 2])); return out.multiplyScalar(3 / p.length);
  }
  reset(speed = 0) {
    if (!Number.isFinite(speed) || speed < 0 || speed > 20) throw new Error('Invalid launch speed');
    if (!this.hood.parent) this.hood.world.install(this.parent, this.parentSlot, this.hood, this.ownSlot);
    this.hood.local.copy(this.originalLocal); this.driving.reset(); this.driving.speed = speed; this.impactSpeed = 0;
    this.clock = new FixedClock(240, 32);
    this.lateralVelocity.set(0, 0, 0); this.yawVelocity = this.reboundSpeed = 0; this.bodySurface?.reset();
    this.panel.setAnchorFrame(this.hood.matrix().elements); this.panel.reset();
    // A launch starts both the car and its attached mass with the same world velocity.
    for (let i = 2; i < this.panel.velocities.length; i += 3) this.panel.velocities[i] = -speed;
  }
  advance(seconds: number, input: DrivingInput) {
    if (this.root.world.disposed || this.root.world.parts.get(this.hood.id) !== this.hood) throw new Error('Crash world disposed');
    return this.clock.advance(seconds, () => {
      const dt = this.clock.dt, previous = this.driving.position.clone(), previousFrame = this.root.matrix();
      this.driving.tick(dt, input);
      this.driving.position.addScaledVector(this.lateralVelocity, dt); this.driving.yaw += this.yawVelocity * dt;
      this.lateralVelocity.multiplyScalar(Math.exp(-2 * dt)); this.yawVelocity *= Math.exp(-2 * dt); this.driving.sync();
      const box = this.chassisBounds.clone().applyMatrix4(this.root.matrix()), obstacle = new Box3(new Vector3(...this.obstacle.min), new Vector3(...this.obstacle.max));
      if (box.intersectsBox(obstacle)) {
        // Conservative whole-chassis proxy: correct overlap, then solve a normal contact impulse.
        const before = this.chassisBounds.clone().applyMatrix4(new Matrix4().copy(this.root.matrix()).setPosition(previous));
        const corrections: Vector3[] = [];
        for (const axis of ['x', 'z'] as const) {
          if (before.min[axis] >= obstacle.max[axis]) { const c = new Vector3(); c[axis] = obstacle.max[axis] - box.min[axis]; corrections.push(c); }
          else if (before.max[axis] <= obstacle.min[axis]) { const c = new Vector3(); c[axis] = obstacle.min[axis] - box.max[axis]; corrections.push(c); }
        }
        const correction = corrections.sort((a, b) => a.lengthSq() - b.lengthSq())[0];
        if (correction) this.driving.position.add(correction);
        else this.driving.position.copy(previous);
        const normal = correction && correction.lengthSq() > 1e-16 ? correction.clone().normalize() : previous.clone().sub(this.driving.position).normalize();
        if (normal.lengthSq() < 0.5) normal.set(0, 0, this.driving.position.z > obstacle.max.z ? 1 : -1);
        const point = this.driving.position.clone(); point.x = normal.x > 0 ? obstacle.max.x : normal.x < 0 ? obstacle.min.x : Math.max(obstacle.min.x, Math.min(obstacle.max.x, point.x)); point.z = normal.z > 0 ? obstacle.max.z : normal.z < 0 ? obstacle.min.z : Math.max(obstacle.min.z, Math.min(obstacle.max.z, point.z));
        const incoming = this.pointVelocity(point).dot(normal);
        if (incoming < 0) {
          this.impactSpeed = Math.max(this.impactSpeed, -incoming);
          const arm = new Vector3().crossVectors(point.clone().sub(this.driving.position), normal).y;
          const impulse = -(1 + (incoming < -0.5 ? 0.22 : 0)) * incoming / (1 / this.mass + arm * arm / this.inertia);
          this.applyImpulse(normal.multiplyScalar(impulse), point); this.reboundSpeed = Math.max(this.reboundSpeed, Math.abs(this.driving.speed));
        }
        this.driving.sync();
      }
      this.bodySurface?.setFrames(previousFrame, this.root.matrix());
      if (this.hood.parent) this.panel.setAnchorFrame(this.hood.matrix().elements);
      this.panel.advance(dt);
      if (!this.panel.attached && this.hood.parent) this.hood.world.detach(this.hood);
      if (!this.hood.parent) this.updateDetachedPose();
    });
  }
  private updateDetachedPose() {
    // Approximate rigid pose for world ownership/descendants; render/contact keep the full deformed nodes.
    const basis = this.cageBasis(this.panel.positions); if (!basis) return;
    basis.multiply(this.referenceInverse);
    basis.setPosition(this.center(this.panel.positions).sub(this.localCenter.clone().applyMatrix4(basis)));
    this.hood.local.copy(basis);
  }
  private cageBasis(p: ArrayLike<number>) {
    const midZ = Math.floor(this.panel.nz / 2), midX = Math.floor(this.panel.nx / 2);
    const point = (x: number, z: number) => new Vector3().fromArray(p, (z * this.panel.nx + x) * 3);
    const x = point(this.panel.nx - 1, midZ).sub(point(0, midZ)).normalize();
    const z = point(midX, this.panel.nz - 1).sub(point(midX, 0)).normalize();
    const y = new Vector3().crossVectors(z, x).normalize(); z.crossVectors(x, y).normalize();
    if (x.lengthSq() < 0.5 || y.lengthSq() < 0.5) return;
    return new Matrix4().makeBasis(x, y, z);
  }
  dispose() { this.reset(); }
}
