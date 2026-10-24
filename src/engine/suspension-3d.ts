import { Matrix4, Vector3 } from 'three';
import type { EnginePart } from './world';
import { slotMatrix } from './slot-frames';
import { RigidBody3D } from './rigid-body-3d';
import type { DrivingInput } from './driving-demo';

export interface Terrain { height(x: number, z: number): number; normal(x: number, z: number): Vector3 }
export class TestTerrain implements Terrain {
  ramp = false;
  height(x: number, z: number) { return this.ramp && x > -1.8 && x < 1.8 && z < -4 && z > -8 ? (-z - 4) * 0.28 : 0; }
  normal(x: number, z: number) { return this.height(x, z) > 0 ? new Vector3(0, 1, 0.28).normalize() : new Vector3(0, 1, 0); }
}
export class Suspension3D {
  private springMass: number;
  private steering?: { part: EnginePart; frame: Matrix4; inverseOwn: Matrix4 };
  readonly wheels: { part: EnginePart; center: Vector3; hardpoint: Vector3; radius: number; rest: number; bump: number; droop: number; length: number; contact: boolean; force: number; frame: Matrix4; inverseOwn: Matrix4; steering: number; spin: number }[];
  steer = 0;
  constructor(readonly root: EnginePart, readonly body: RigidBody3D, readonly terrain: Terrain) {
    this.springMass = body.mass;
    const cfg = root.definition.config;
    this.wheels = cfg.slots.filter(s => s.type !== undefined && s.type >= 101 && s.type < 200).map(slot => {
      const wheel = cfg.wheels[slot.type! - 101], part = root.children.get(slot.id);
      if (!wheel?.radius || !part) throw new Error('3D suspension needs installed wheels and CFG radii');
      const [rest, bump, droop] = wheel.spring ?? [0.29, 0.1, 0.05], center = new Vector3(...wheel.position);
      return { part, center, hardpoint: center.clone().add(new Vector3(0, rest, 0)), radius: wheel.radius, rest, bump, droop, length: rest, contact: false, force: 0, frame: slotMatrix(cfg, slot), inverseOwn: slotMatrix(part.definition.config, part.definition.config.slots.find(s => s.id === part.ownSlot)!).invert(), steering: wheel.parameters[0] ?? 0, spin: 0 };
    });
    if (this.wheels.length !== 4) throw new Error('3D prototype requires four configured wheels');
    const slot = cfg.slots.find(s => s.type === 11), part = slot && root.children.get(slot.id);
    if (slot && part) this.steering = { part, frame: slotMatrix(cfg, slot), inverseOwn: slotMatrix(part.definition.config, part.definition.config.slots.find(s => s.id === part.ownSlot)!).invert() };
  }
  reset() { this.steer = 0; this.wheels.forEach(w => { w.spin = 0; w.length = w.rest; w.force = 0; w.contact = false; }); }
  step(dt: number, input: DrivingInput) {
    const target = Math.max(-1, Math.min(1, input.steer)) * (this.root.definition.config.maxSteer ?? 0.6); this.steer += Math.max(-2 * dt, Math.min(2 * dt, target - this.steer));
    const frame = this.body.matrix(), down = new Vector3(0, -1, 0).applyQuaternion(this.body.orientation), count = this.wheels.length;
    for (const w of this.wheels) {
      const hard = w.hardpoint.clone().applyMatrix4(frame), sag = Math.min(w.bump * 0.4, 0.04), k = this.springMass * 9.81 / count / sag, damping = 2 * 0.75 * Math.sqrt(k * this.springMass / count);
      let length = w.rest + w.droop;
      if (down.y < -0.05) {
        let ray = (hard.y - this.terrain.height(hard.x, hard.z) - w.radius) / -down.y;
        for (let i = 0; i < 2; i++) { const p = hard.clone().addScaledVector(down, ray); ray = (hard.y - this.terrain.height(p.x, p.z) - w.radius) / -down.y; }
        length = ray;
      }
      w.contact = length < w.rest + w.droop && down.y < -0.05; w.length = Math.max(w.rest - w.bump, Math.min(w.rest + w.droop, length)); w.force = 0;
      if (w.contact) {
        const patch = hard.clone().addScaledVector(down, length).add(new Vector3(0, -w.radius, 0)), normal = this.terrain.normal(patch.x, patch.z), speed = this.body.pointVelocity(hard).dot(normal);
        w.force = Math.max(0, Math.min(this.body.mass * 9.81 * 3, (w.rest - length) * k - damping * speed + Math.max(0, w.rest - w.bump - length) * k * 8));
        this.body.addForce(normal.clone().multiplyScalar(w.force), hard);
        const forward = new Vector3(0, 0, -1).applyAxisAngle(new Vector3(0, 1, 0), this.steer * w.steering).applyQuaternion(this.body.orientation); forward.addScaledVector(normal, -forward.dot(normal)).normalize();
        const side = new Vector3().crossVectors(forward, normal).normalize(), velocity = this.body.pointVelocity(patch), longitudinal = velocity.dot(forward);
        const drive = Math.max(-1, Math.min(1, input.throttle)) * this.body.mass * 5 / count;
        const braking = input.brake ? -longitudinal * this.body.mass / count / dt : -longitudinal * this.body.mass * 0.08 / count;
        const lateral = -velocity.dot(side) * this.body.mass / count / (dt * 6), force = forward.multiplyScalar(drive + braking).addScaledVector(side, lateral), limit = w.force * 1.05;
        if (force.length() > limit) force.setLength(limit); this.body.addForce(force, patch); w.spin += longitudinal * dt / w.radius;
      }
    }
  }
  sync() {
    for (const w of this.wheels) {
      if (w.part.parent !== this.root) continue;
      const sign = new Vector3(1, 0, 0).transformDirection(w.frame).x < 0 ? -1 : 1;
      w.part.local.copy(new Matrix4().makeTranslation(0, w.rest - w.length, 0)).multiply(w.frame).multiply(new Matrix4().makeRotationY(this.steer * w.steering)).multiply(new Matrix4().makeRotationX(-w.spin * sign)).multiply(w.inverseOwn);
    }
    if (this.steering) this.steering.part.local.copy(this.steering.frame).multiply(new Matrix4().makeRotationZ(-this.steer * 14)).multiply(this.steering.inverseOwn);
  }
}
