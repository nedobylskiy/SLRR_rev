import { Box3, Matrix3, Matrix4, Vector3 } from 'three';
import { DeformablePanel, type Triple } from './deformable-panel';
import { RigidBody3D } from './rigid-body-3d';

/** A rigid, dent-preserving shape between impacts; XPBD wakes for contacts and attachment loads. */
export class PanelActivity {
  deforming = false;
  private quietTicks = 0;
  private activeTicks = 0;
  private impulseVersion = 0;
  readonly frame = new Matrix4();
  freeBody?: RigidBody3D;
  resting = false;
  private restTicks = 0;
  constructor(readonly panel: DeformablePanel) {}
  reset(frame: Matrix4) { this.frame.copy(frame); this.deforming = false; this.quietTicks = this.activeTicks = this.restTicks = 0; this.resting = false; this.freeBody = undefined; this.impulseVersion = this.panel.impulseVersion; }
  get forced() { return this.impulseVersion !== this.panel.impulseVersion; }
  wake() { this.deforming = true; this.activeTicks = this.quietTicks = this.restTicks = 0; this.resting = false; this.freeBody = undefined; }
  /** A supported, still rigid fragment needs no repeated gravity/contact solve. */
  rest(dt: number, supported: boolean) {
    const body = this.freeBody;
    this.restTicks = supported && body && body.velocity.lengthSq() < 0.0025 && body.omega.lengthSq() < 0.01 ? this.restTicks + 1 : 0;
    this.resting = this.restTicks * dt >= 0.5;
    if (this.resting && body) { body.velocity.set(0, 0, 0); body.setAngularVelocity(new Vector3()); }
  }
  /** Conservative swept cage bounds, used only to wake the exact node/contact solver. */
  threatened(nextFrame: Matrix4, obstacle: Box3, groundMayReach?: (bounds: Box3) => boolean) {
    const delta = nextFrame.clone().multiply(this.frame.clone().invert()), box = new Box3(), point = new Vector3(), p = this.panel.positions;
    for (let i = 0; i < p.length; i += 3) {
      point.fromArray(p, i); box.expandByPoint(point); box.expandByPoint(point.applyMatrix4(delta));
    }
    if (box.intersectsBox(obstacle)) return true;
    if (groundMayReach && !groundMayReach(box)) return false;
    for (let i = 0; i < p.length; i += 3) {
      point.fromArray(p, i).applyMatrix4(delta);
      if (Math.min(p[i + 1], point.y) < this.panel.groundHeight(point.x, point.z, p[i + 1]) + 0.025) return true;
    }
    return false;
  }
  carry(dt: number, frame: Matrix4, body: RigidBody3D) {
    const delta = frame.clone().multiply(this.frame.clone().invert());
    this.panel.advanceRigid(dt, delta.elements, body.velocity.toArray() as Triple, body.omega.toArray() as Triple, body.position.toArray() as Triple);
    this.frame.copy(frame);
  }
  /** Fit motion to all nodes, separating rigid spin from internal vibration. */
  motion() {
    const p = this.panel.positions, v = this.panel.velocities, count = p.length / 3, center = new Vector3(), velocity = new Vector3(), point = new Vector3(), relative = new Vector3(), angular = new Vector3();
    for (let i = 0; i < p.length; i += 3) { center.add(point.fromArray(p, i)); velocity.add(point.fromArray(v, i)); }
    center.multiplyScalar(1 / count); velocity.multiplyScalar(1 / count);
    let xx = 0, yy = 0, zz = 0, xy = 0, xz = 0, yz = 0;
    for (let i = 0; i < p.length; i += 3) {
      point.fromArray(p, i).sub(center); relative.fromArray(v, i).sub(velocity); angular.add(new Vector3().crossVectors(point, relative));
      xx += point.y * point.y + point.z * point.z; yy += point.x * point.x + point.z * point.z; zz += point.x * point.x + point.y * point.y;
      xy -= point.x * point.y; xz -= point.x * point.z; yz -= point.y * point.z;
    }
    const inertia = new Matrix3().set(xx, xy, xz, xy, yy, yz, xz, yz, zz);
    const omega = angular.applyMatrix3(inertia.invert());
    let internal = 0;
    for (let i = 0; i < p.length; i += 3) {
      point.fromArray(p, i).sub(center); relative.crossVectors(omega, point).add(velocity);
      relative.x -= v[i]; relative.y -= v[i + 1]; relative.z -= v[i + 2]; internal += relative.lengthSq();
    }
    return { center, velocity, omega, internalSpeed: Math.sqrt(internal / count) };
  }
  settle(dt: number, frame: Matrix4, attached: boolean) {
    this.impulseVersion = this.panel.impulseVersion;
    this.frame.copy(frame); this.activeTicks++;
    if (this.activeTicks * dt < 0.25) return;
    const motion = this.motion();
    const overloaded = this.panel.mounts.some(m => !m.broken && m.force > this.panel.mountStrength * 0.5);
    this.quietTicks = motion.internalSpeed < 0.12 && !overloaded ? this.quietTicks + 1 : 0;
    if (this.quietTicks * dt < 0.2) return;
    this.deforming = false;
    if (!attached) {
      const inverse = frame.clone().invert(), bounds = new Box3(), point = new Vector3();
      for (let i = 0; i < this.panel.positions.length; i += 3) bounds.expandByPoint(point.fromArray(this.panel.positions, i).applyMatrix4(inverse));
      const body = new RigidBody3D(this.panel.options.mass, bounds, motion.center.clone().applyMatrix4(inverse));
      body.setFrame(frame); body.velocity.copy(motion.velocity); body.setAngularVelocity(motion.omega); this.freeBody = body;
    }
  }
}
