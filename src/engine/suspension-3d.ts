import { Matrix4, Quaternion, Vector3 } from 'three';
import type { EnginePart } from './world';
import { slotMatrix } from './slot-frames';
import { RigidBody3D } from './rigid-body-3d';
import type { DrivingInput } from './driving-demo';
import { MechanicalSystem } from './mechanical-system';
import type { TireSurface } from './map-terrain';

export interface Terrain { height(x: number, z: number, fromY?: number): number; normal(x: number, z: number, fromY?: number): Vector3; sample?(x: number, z: number, fromY?: number): { height: number; normal: Vector3; surface: TireSurface } | undefined }
export interface TireContactState { contact: boolean; force: number; contactPoint: Vector3; contactNormal: Vector3; forward: Vector3; slipSpeed: number; lateralSpeed: number; surface: TireSurface }
export class TestTerrain implements Terrain {
  ramp = false;
  height(x: number, z: number) { return this.ramp && x > -1.8 && x < 1.8 && z < -4 && z > -8 ? (-z - 4) * 0.28 : 0; }
  normal(x: number, z: number) { return this.height(x, z) > 0 ? new Vector3(0, 1, 0.28).normalize() : new Vector3(0, 1, 0); }
}
/** Lateral grip has priority while a driven tyre is spinning, so throttle does not erase steering force. */
export function tyreContactForces(normalLoad: number, alignment: number, slipSpeed: number, lateralSpeed: number) {
  const limit = normalLoad * Math.max(0, alignment);
  const slide = Math.min(1, Math.hypot(slipSpeed, lateralSpeed) / 3);
  const longitudinalLimit = limit * 1.05 * (1 - 0.28 * slide);
  const lateralLimit = limit * 1.2 * (1 - 0.08 * Math.min(1, Math.abs(slipSpeed) / 3));
  const lateral = Math.max(-lateralLimit, Math.min(lateralLimit, -lateralSpeed * 4200));
  const lateralUse = lateralLimit > 0 ? lateral / lateralLimit : 0;
  const availableLongitudinal = longitudinalLimit * Math.sqrt(Math.max(0, 1 - lateralUse * lateralUse));
  const longitudinal = Math.max(-availableLongitudinal, Math.min(availableLongitudinal, slipSpeed * 3400));
  return { longitudinal, lateral };
}
export class Suspension3D {
  private springMass: number;
  private movingParts: { part: EnginePart; base: Matrix4 }[][] = [[], [], [], []];
  readonly mechanics?: MechanicalSystem;
  private steering?: { part: EnginePart; frame: Matrix4; inverseOwn: Matrix4 };
  readonly wheels: (TireContactState & { part: EnginePart; center: Vector3; hardpoint: Vector3; originalHardpoint: Vector3; damage: Matrix4; mountCondition: number; radius: number; rest: number; bump: number; droop: number; length: number; frame: Matrix4; inverseOwn: Matrix4; steering: number; spin: number; omega: number; slip: number })[];
  steer = 0;
  constructor(readonly root: EnginePart, readonly body: RigidBody3D, readonly terrain: Terrain) {
    this.springMass = body.mass;
    if (root.world.mechanical) this.mechanics = new MechanicalSystem(root);
    const cfg = root.definition.config;
    this.wheels = cfg.slots.filter(s => s.type !== undefined && s.type >= 101 && s.type < 200).map(slot => {
      const wheel = cfg.wheels[slot.type! - 101], part = root.children.get(slot.id);
      if (!wheel?.radius || !part) throw new Error('3D suspension needs installed wheels and CFG radii');
      const [rest, bump, droop] = wheel.spring ?? [0.29, 0.1, 0.05], frame = root.slotFrame(slot), center = new Vector3().setFromMatrixPosition(frame);
      const hardpoint = center.clone().add(new Vector3(0, rest, 0));
      return { part, center, hardpoint, originalHardpoint: hardpoint.clone(), damage: new Matrix4(), mountCondition: 1, radius: wheel.radius, rest, bump, droop, length: rest, contact: false, force: 0, contactPoint: new Vector3(), contactNormal: new Vector3(0, 1, 0), forward: new Vector3(0, 0, -1), slipSpeed: 0, lateralSpeed: 0, surface: 'road' as const, frame, inverseOwn: slotMatrix(part.definition.config, part.definition.config.slots.find(s => s.id === part.ownSlot)!).invert(), steering: wheel.parameters[0] ?? 0, spin: 0, omega: 0, slip: 0 };
    });
    if (this.wheels.length !== 4) throw new Error('3D prototype requires four configured wheels');
    for (const part of root.children.values()) {
      const kind = part.definition.mechanics?.kind, slot = cfg.slots.find(s => s.id === part.parentSlot), type = slot?.type ?? 0;
      if (!kind || kind === 'sway' || kind === 'engine') continue;
      const index = type >= 201 && type <= 204 || type >= 301 && type <= 304 ? type % 100 - 1 : -1;
      if (index >= 0) this.movingParts[index].push({ part, base: part.local.clone() });
    }
    const slot = cfg.slots.find(s => s.type === 11), part = slot && root.children.get(slot.id);
    if (slot && part) this.steering = { part, frame: slotMatrix(cfg, slot), inverseOwn: slotMatrix(part.definition.config, part.definition.config.slots.find(s => s.id === part.ownSlot)!).invert() };
  }
  reset() { this.steer = 0; this.mechanics?.reset(); this.wheels.forEach(w => { w.spin = w.omega = w.slip = w.slipSpeed = w.lateralSpeed = 0; w.length = w.rest; w.force = 0; w.contact = false; w.damage.identity(); w.mountCondition = 1; w.hardpoint.copy(w.originalHardpoint); }); this.movingParts.flat().forEach(m => m.base.copy(m.part.local)); }
  /** A bent chassis moves the rest seat; the wheel travel is applied on top of it. */
  setMechanicalBase(part: EnginePart, local: Matrix4) {
    for (const corner of this.movingParts) {
      const entry = corner.find(m => m.part === part);
      if (entry) { entry.base.copy(local); return; }
    }
  }
  deform(index: number, delta: Matrix4, condition: number) {
    const w = this.wheels[index]; w.mountCondition = Math.min(w.mountCondition, condition);
    const rotation = new Quaternion().setFromRotationMatrix(delta);
    rotation.identity().slerp(new Quaternion().setFromRotationMatrix(delta), Math.max(0, 1 - w.mountCondition / 0.1));
    // Translation is geometric; severe alignment failure starts only below 10% support health.
    const origin = new Vector3().setFromMatrixPosition(w.frame), position = origin.clone().applyMatrix4(delta).sub(origin.clone().applyQuaternion(rotation));
    w.damage.compose(position, rotation, new Vector3(1, 1, 1));
    w.hardpoint.copy(w.originalHardpoint).applyMatrix4(delta);
  }
  step(dt: number, input: DrivingInput) {
    const target = Math.max(-1, Math.min(1, input.steer)) * (this.root.definition.config.maxSteer ?? 0.6); this.steer += Math.max(-2 * dt, Math.min(2 * dt, target - this.steer));
    const frame = this.body.matrix(), count = this.wheels.length;
    const chassisForward = new Vector3(0, 0, -1).applyQuaternion(this.body.orientation);
    const roadSpeed = this.body.velocity.dot(chassisForward);
    const drivetrain = this.mechanics?.advance(dt, input, this.wheels.map(w => w.omega), this.wheels.map(w => roadSpeed / w.radius), roadSpeed);
    for (const [index, w] of this.wheels.entries()) {
      const support = this.mechanics?.support(index) ?? 1;
      const failure = Math.max(0, 1 - Math.min(w.mountCondition, support) / 0.1);
      const side = index % 2 ? -1 : 1, alignment = w.damage.clone().multiply(new Matrix4().makeRotationZ(side * failure * 0.4));
      const down = new Vector3(0, -1, 0).transformDirection(alignment).applyQuaternion(this.body.orientation);
      const hard = w.hardpoint.clone().applyMatrix4(frame), sag = Math.min(w.bump * 0.4, 0.04);
      const k = this.mechanics ? this.mechanics.spring(index) : this.springMass * 9.81 / count / sag;
      const damping = this.mechanics ? this.mechanics.damper(index) : 2 * 0.75 * Math.sqrt(k * this.springMass / count);
      let length = w.rest + w.droop;
      if (down.y < -0.05) {
        let ray = (hard.y - this.terrain.height(hard.x, hard.z, hard.y) - w.radius) / -down.y;
        for (let i = 0; i < 2; i++) { const p = hard.clone().addScaledVector(down, ray); ray = (hard.y - this.terrain.height(p.x, p.z, hard.y) - w.radius) / -down.y; }
        length = ray;
      }
      w.contact = w.part.parent === this.root && w.part.condition > 0 && w.mountCondition > 0 && support > 0 && length < w.rest + w.droop && down.y < -0.05; w.length = Math.max(w.rest - w.bump, Math.min(w.rest + w.droop, length)); w.force = w.slipSpeed = w.lateralSpeed = 0;
      if (w.contact) {
        const patch = hard.clone().addScaledVector(down, length).add(new Vector3(0, -w.radius, 0));
        const terrainHit = this.terrain.sample?.(patch.x, patch.z, hard.y);
        const normal = terrainHit?.normal ?? this.terrain.normal(patch.x, patch.z, hard.y), speed = this.body.pointVelocity(hard).dot(normal);
        w.force = Math.max(0, Math.min(this.body.mass * 9.81 * 3, (w.rest - length) * k - damping * speed + Math.max(0, w.rest - w.bump - length) * k * 8));
        this.body.addForce(normal.clone().multiplyScalar(w.force), hard);
        const forward = new Vector3(0, 0, -1).applyAxisAngle(new Vector3(0, 1, 0), this.steer * w.steering).transformDirection(alignment).applyQuaternion(this.body.orientation); forward.addScaledVector(normal, -forward.dot(normal)).normalize();
        const side = new Vector3().crossVectors(forward, normal).normalize(), velocity = this.body.pointVelocity(patch), longitudinal = velocity.dot(forward);
        w.contactPoint.set(patch.x, (terrainHit?.height ?? this.terrain.height(patch.x, patch.z, hard.y)) + 0.012, patch.z);
        w.contactNormal.copy(normal); w.forward.copy(forward); w.surface = terrainHit?.surface ?? 'road';
        w.lateralSpeed = velocity.dot(side);
        const drive = this.mechanics ? drivetrain!.torque[index] : Math.max(-1, Math.min(1, input.throttle)) * this.body.mass * 5 / count;
        const braking = input.brake || drivetrain?.directionBrake;
        const limit = w.force * 1.05 * Math.max(0.25, Math.pow(Math.abs(down.dot(normal)), 2));
        if (this.mechanics) {
          const slipSpeed = w.omega * w.radius - longitudinal;
          w.slipSpeed = slipSpeed;
          w.slip = slipSpeed / Math.max(2, Math.abs(longitudinal), Math.abs(w.omega * w.radius));
          const tyre = tyreContactForces(w.force, Math.max(0.25, Math.pow(Math.abs(down.dot(normal)), 2)), slipSpeed, velocity.dot(side));
          const force = forward.clone().multiplyScalar(tyre.longitudinal).addScaledVector(side, tyre.lateral);
          this.body.addForce(force, patch);
          const brakeTorque = braking ? Math.min(Math.abs(w.omega) * 80, 950 * this.mechanics.brake(index)) * Math.sign(w.omega) : 0;
          w.omega += (drive - force.dot(forward) * w.radius - brakeTorque - w.omega * 0.15) / 1.6 * dt;
          w.spin += w.omega * dt;
        } else {
          const brakeForce = braking ? -longitudinal * this.body.mass / count / dt : -longitudinal * this.body.mass * 0.08 / count;
          const force = forward.multiplyScalar(drive + brakeForce).addScaledVector(side, -velocity.dot(side) * this.body.mass / count / (dt * 6));
          if (force.length() > limit) force.setLength(limit); this.body.addForce(force, patch); w.spin += longitudinal * dt / w.radius;
        }
      }
      else if (this.mechanics) {
        const brakeTorque = input.brake || drivetrain!.directionBrake ? Math.min(Math.abs(w.omega) * 80, 950 * this.mechanics.brake(index)) * Math.sign(w.omega) : 0;
        w.omega += (drivetrain!.torque[index] - brakeTorque - w.omega * 0.25) / 1.6 * dt; w.spin += w.omega * dt; w.slip = 0;
      }
    }
    if (this.mechanics) for (const first of [0, 2]) {
      const left = this.wheels[first], right = this.wheels[first + 1], tuning = this.mechanics.sway(first);
      if (!tuning.force || !left.contact || !right.contact) continue;
      const a = left.hardpoint.clone().applyMatrix4(frame), b = right.hardpoint.clone().applyMatrix4(frame);
      const vy = this.body.pointVelocity(a).y - this.body.pointVelocity(b).y;
      const force = Math.max(-this.body.mass * 9.81 * 0.5, Math.min(this.body.mass * 9.81 * 0.5, (right.length - left.length) * tuning.force - vy * tuning.damping));
      this.body.addForce(new Vector3(0, force, 0), a);
      this.body.addForce(new Vector3(0, -force, 0), b);
    }
  }
  sync() {
    for (const [index, w] of this.wheels.entries()) {
      if (w.part.parent !== this.root) continue;
      const sign = new Vector3(1, 0, 0).transformDirection(w.frame).x < 0 ? -1 : 1;
      const support = this.mechanics?.support(index) ?? 1, failure = Math.max(0, 1 - Math.min(w.mountCondition, support) / 0.1);
      const damaged = w.damage.clone().multiply(new Matrix4().makeRotationZ((index % 2 ? -1 : 1) * failure * 0.4));
      const down = new Vector3(0, -1, 0).transformDirection(damaged), rotation = new Quaternion().setFromRotationMatrix(damaged);
      const offset = new Vector3().setFromMatrixPosition(w.frame).sub(w.center).applyQuaternion(rotation);
      const position = w.hardpoint.clone().addScaledVector(down, w.length).add(offset);
      const carrier = damaged.clone().multiply(w.frame).setPosition(position).multiply(new Matrix4().makeRotationY(this.steer * w.steering));
      w.part.local.copy(carrier).multiply(new Matrix4().makeRotationX(-w.spin * sign)).multiply(w.inverseOwn);
      const travel = carrier.multiply(w.frame.clone().invert());
      for (const moving of this.movingParts[index]) if (moving.part.parent === this.root) moving.part.local.copy(travel).multiply(moving.base);
    }
    if (this.steering) this.steering.part.local.copy(this.steering.frame).multiply(new Matrix4().makeRotationZ(-this.steer * 14)).multiply(this.steering.inverseOwn);
  }
}
