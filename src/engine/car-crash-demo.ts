import { Box3, Matrix4, Vector3 } from 'three';
import { DrivingDemo, type DrivingInput } from './driving-demo';
import { DeformablePanel, type PanelCollider, type PanelOptions } from './deformable-panel';
import type { EnginePart } from './world';
import { FixedClock } from '../runtime/fixed-clock';

/** Kinematic chassis + deformable hood. Contact drives damage; no impact preset mutates damage. */
export class CarCrashDemo {
  readonly driving: DrivingDemo;
  readonly panel: DeformablePanel;
  clock = new FixedClock(240, 32);
  readonly obstacle: PanelCollider;
  impactSpeed = 0;
  private parent: EnginePart; private parentSlot: number; private ownSlot: number;
  private originalLocal: Matrix4;
  private localCenter: Vector3;
  private referenceInverse: Matrix4;
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
  }
  private center(p: ArrayLike<number>) {
    const out = new Vector3(); for (let i = 0; i < p.length; i += 3) out.add(new Vector3(p[i], p[i + 1], p[i + 2])); return out.multiplyScalar(3 / p.length);
  }
  reset(speed = 0) {
    if (!Number.isFinite(speed) || speed < 0 || speed > 20) throw new Error('Invalid launch speed');
    if (!this.hood.parent) this.hood.world.install(this.parent, this.parentSlot, this.hood, this.ownSlot);
    this.hood.local.copy(this.originalLocal); this.driving.reset(); this.driving.speed = speed; this.impactSpeed = 0;
    this.clock = new FixedClock(240, 32);
    this.panel.setAnchorFrame(this.hood.matrix().elements); this.panel.reset();
    // A launch starts both the car and its attached mass with the same world velocity.
    for (let i = 2; i < this.panel.velocities.length; i += 3) this.panel.velocities[i] = -speed;
  }
  advance(seconds: number, input: DrivingInput) {
    if (this.root.world.disposed || this.root.world.parts.get(this.hood.id) !== this.hood) throw new Error('Crash world disposed');
    return this.clock.advance(seconds, () => {
      const dt = this.clock.dt, previous = this.driving.position.clone();
      this.driving.tick(dt, input);
      const box = this.chassisBounds.clone().applyMatrix4(this.root.matrix()), obstacle = new Box3(new Vector3(...this.obstacle.min), new Vector3(...this.obstacle.max));
      if (box.intersectsBox(obstacle)) {
        // Conservative whole-chassis proxy; place at the entry surface, then remove normal speed.
        const before = this.chassisBounds.clone().applyMatrix4(new Matrix4().copy(this.root.matrix()).setPosition(previous));
        const corrections: Vector3[] = [];
        for (const axis of ['x', 'z'] as const) {
          if (before.min[axis] >= obstacle.max[axis]) { const c = new Vector3(); c[axis] = obstacle.max[axis] - box.min[axis]; corrections.push(c); }
          else if (before.max[axis] <= obstacle.min[axis]) { const c = new Vector3(); c[axis] = obstacle.min[axis] - box.max[axis]; corrections.push(c); }
        }
        if (corrections.length) this.driving.position.add(corrections.sort((a, b) => a.lengthSq() - b.lengthSq())[0]);
        else this.driving.position.copy(previous);
        this.impactSpeed = Math.max(this.impactSpeed, Math.abs(this.driving.speed)); this.driving.speed = 0; this.driving.sync();
      }
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
