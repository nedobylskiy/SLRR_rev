import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { EnginePart } from './world';
import { slotMatrix } from './slot-frames';

export interface DrivingInput { throttle: number; steer: number; brake: boolean; clutch?: boolean; gearUp?: boolean; gearDown?: boolean; neutral?: boolean; start?: boolean }
export const NEUTRAL_INPUT: DrivingInput = { throttle: 0, steer: 0, brake: false };
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const approach = (n: number, target: number, step: number) => n + clamp(target - n, -step, step);

/** Flat-ground bicycle prototype. No collisions, suspension solver, engine scripts or TUFA execution. */
export class DrivingDemo {
  readonly position = new Vector3();
  speed = 0;
  yaw = 0;
  steer = 0;
  distance = 0;
  readonly wheelbase: number;
  readonly maxSteer: number;
  private height: number;
  private pitch: number;
  private mounts: { part: EnginePart; frame: Matrix4; inverseOwn: Matrix4; radius: number; steering: number; axleSign: number }[];
  private steeringMount?: { part: EnginePart; frame: Matrix4; inverseOwn: Matrix4 };
  constructor(readonly root: EnginePart) {
    const cfg = root.definition.config;
    this.mounts = cfg.slots.filter(s => s.type !== undefined && s.type >= 101 && s.type <= 199).map(slot => {
      const part = root.children.get(slot.id), wheel = cfg.wheels[slot.type! - 101];
      if (!part || !wheel || !wheel.radius) throw new Error(`Driving requires a mounted wheel and radius at slot ${slot.id}`);
      const own = part.definition.config.slots.find(s => s.id === part.ownSlot)!;
      const frame = slotMatrix(cfg, slot);
      return { part, frame, inverseOwn: slotMatrix(part.definition.config, own).invert(), radius: wheel.radius, steering: wheel.parameters[0] ?? 0, axleSign: new Vector3(1, 0, 0).transformDirection(frame).x < 0 ? -1 : 1 };
    });
    if (this.mounts.length < 2 || root.parent) throw new Error('Driving requires an independent chassis with mounted wheels');
    const centers = this.mounts.map(m => new Vector3().setFromMatrixPosition(m.frame));
    const front = centers.reduce((a, b) => a.z < b.z ? a : b), rear = centers.reduce((a, b) => a.z > b.z ? a : b);
    this.wheelbase = rear.z - front.z;
    if (this.wheelbase < 0.1) throw new Error('Driving requires two distinct axles');
    this.maxSteer = cfg.maxSteer ?? 0.6;
    this.pitch = Math.atan2(rear.y - front.y, this.wheelbase);
    const level = new Matrix4().makeRotationX(this.pitch);
    this.height = centers.reduce((sum, p, i) => sum + this.mounts[i].radius - p.clone().applyMatrix4(level).y, 0) / centers.length;
    const steeringSlot = cfg.slots.find(s => s.type === 11);
    if (steeringSlot) {
      const part = root.children.get(steeringSlot.id);
      if (part) this.steeringMount = { part, frame: slotMatrix(cfg, steeringSlot), inverseOwn: slotMatrix(part.definition.config, part.definition.config.slots.find(s => s.id === part.ownSlot)!).invert() };
    }
    this.reset();
  }
  reset() {
    this.position.set(0, this.height, 0); this.speed = this.yaw = this.steer = this.distance = 0; this.sync();
  }
  advance(seconds: number, input: DrivingInput) {
    if (this.root.world.disposed) throw new Error('Driving world disposed');
    if (![input.throttle, input.steer].every(Number.isFinite)) throw new Error('Finite driving input required');
    return this.root.world.clock.advance(seconds, () => {
      if (this.root.world.disposed || this.root.world.parts.get(this.root.id) !== this.root) throw new Error('Driving world disposed');
      for (const mount of this.mounts) if (mount.part.parent !== this.root) throw new Error('Driving wheel detached');
      this.tick(this.root.world.clock.dt, input);
    });
  }
  /** Shared fixed-step integration; a coupled physics session can own the clock. */
  tick(dt: number, input: DrivingInput) {
    if (this.root.world.disposed || this.root.world.parts.get(this.root.id) !== this.root) throw new Error('Driving world disposed');
    if (![dt, input.throttle, input.steer].every(Number.isFinite) || dt <= 0 || dt > 0.1) throw new Error('Invalid driving step');
    for (const m of this.mounts) if (m.part.parent !== this.root) throw new Error('Driving wheel detached');
    const throttle = clamp(input.throttle, -1, 1), oldSpeed = this.speed;
    this.steer = approach(this.steer, clamp(input.steer, -1, 1) * this.maxSteer, 1.8 * dt);
    // Demonstration handling constants are shared by every car, never a reconstructed drivetrain.
    if (input.brake || throttle * this.speed < 0) this.speed = approach(this.speed, 0, 9 * dt);
    else this.speed = clamp(this.speed + throttle * 5 * dt, -8, 28);
    this.speed = approach(this.speed, 0, (0.12 + 0.006 * this.speed * this.speed) * dt);
    const travel = (oldSpeed + this.speed) * 0.5 * dt;
    const turn = travel / this.wheelbase * Math.tan(this.steer), middleYaw = this.yaw + turn * 0.5;
    this.position.x -= Math.sin(middleYaw) * travel; this.position.z -= Math.cos(middleYaw) * travel;
    this.yaw += turn; this.distance += travel; this.sync();
  }
  sync() {
    this.root.local.compose(this.position, new Quaternion().setFromEuler(new Euler(this.pitch, this.yaw, 0, 'YXZ')), new Vector3(1, 1, 1));
    for (const m of this.mounts) {
      m.part.local.copy(m.frame).multiply(new Matrix4().makeRotationY(this.steer * m.steering))
        .multiply(new Matrix4().makeRotationX(-this.distance / m.radius * m.axleSign)).multiply(m.inverseOwn);
    }
    const s = this.steeringMount;
    if (s) s.part.local.copy(s.frame).multiply(new Matrix4().makeRotationZ(-this.steer * 14)).multiply(s.inverseOwn);
  }
}
