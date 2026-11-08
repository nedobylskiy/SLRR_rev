import {steeringHelpStep,absBrakeStep,type DrivingHelping} from './driving-helping';
import {CpuWorkProfile} from '../runtime/cpu-work-profile';
import { nativeSuspensionForce, nativeTireForces, updateSlip, wheelBrake } from './native-vehicle-physics';
import { Box3, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { EnginePart } from './world';
import { slotMatrix } from './slot-frames';
import { RigidBody3D } from './rigid-body-3d';
import { handbrakeEffort, type DrivingInput } from './driving-demo';
import { MechanicalSystem } from './mechanical-system';
import type { TireSurface } from './map-terrain';
import { DEFAULT_TIRE_MODEL, tireForces, type TireModelSettings } from './tire-model';
import type { WheelRefState } from '../runtime/wheel-ref-native';
import { applyExperimentalHubPose } from './hub-geometry';
import { HOST_WHEEL_INERTIA } from './wheel-inertia';

export interface Terrain { queryProfile?:CpuWorkProfile; height(x: number, z: number, fromY?: number): number; normal(x: number, z: number, fromY?: number): Vector3; mayReach?(bounds: Box3): boolean; sample?(x: number, z: number, fromY?: number): { height: number; normal: Vector3; surface: TireSurface } | undefined }
export interface TireContactState { contact: boolean; force: number; contactPoint: Vector3; contactNormal: Vector3; forward: Vector3; slipSpeed: number; lateralSpeed: number; slip: number; surface: TireSurface }
/** Legacy contact response retained for comparisons with the tunable model. */
export function tyreContactForces(normalLoad: number, alignment: number, slipSpeed: number, lateralSpeed: number) {
  return tireForces(normalLoad, alignment, slipSpeed, lateralSpeed, 0, 0, { ...DEFAULT_TIRE_MODEL, model: 'legacy' });
}
/** CFG maxsteer supplies the center angle and Ackermann length; wheel x selects inner/outer angle. */
export function ackermannSteerAngle(centerAngle: number, wheelX: number, length: number, steerFactor = 1): number {
  if (Math.abs(centerAngle) < 1e-7 || !steerFactor) return 0;
  if (length === 0) return centerAngle * steerFactor;
  const radius = length / Math.tan(centerAngle);
  return (radius <= 0 ? -Math.atan2(length, -radius - wheelX) : Math.atan2(length, radius + wheelX)) * steerFactor;
}
export class TestTerrain implements Terrain {
  ramp = false;
  height(x: number, z: number) { return this.ramp && x > -1.8 && x < 1.8 && z < -4 && z > -8 ? (-z - 4) * 0.28 : 0; }
  normal(x: number, z: number) { return this.height(x, z) > 0 ? new Vector3(0, 1, 0.28).normalize() : new Vector3(0, 1, 0); }
}
export class Suspension3D {
  readonly workProfile=new CpuWorkProfile();
  private terrainQuery<T>(name:string,work:()=>T):T{
    const profile=this.workProfile;if(!profile.enabled)return work();
    const previous=this.terrain.queryProfile;this.terrain.queryProfile=profile;
    profile.add(name+'_count');
    try{return profile.measure(name+'_ms',work);}finally{this.terrain.queryProfile=previous;}
  }
  private springMass: number;
  private movingParts: { part: EnginePart; base: Matrix4 }[][] = [[], [], [], []];
  readonly mechanics?: MechanicalSystem;
  private steering?: { part: EnginePart; frame: Matrix4; inverseOwn: Matrix4 };
  readonly wheels: (TireContactState & { part: EnginePart; center: Vector3; hardpoint: Vector3; originalHardpoint: Vector3; damage: Matrix4; mountCondition: number; radius: number; originalTyre?: WheelRefState; rest: number; bump: number; droop: number; length: number; supportHeight?: number; supportX: number; supportZ: number; frame: Matrix4; inverseOwn: Matrix4; nativeSlip: { longitudinal: number; angle: number }; steering: number; spin: number; omega: number })[];
  helping:DrivingHelping={brake:0,steer:0,clutch:0,acceleration:0,abs:0};
  steer = 0;
  tireModel: TireModelSettings = structuredClone(DEFAULT_TIRE_MODEL);
  constructor(readonly root: EnginePart, readonly body: RigidBody3D, readonly terrain: Terrain) {
    this.springMass = body.mass;
    if (root.world.mechanical) this.mechanics = new MechanicalSystem(root);
    const cfg = root.definition.config;
    this.wheels = cfg.slots.filter(s => s.type !== undefined && s.type >= 101 && s.type < 200).map(slot => {
      const wheel = cfg.wheels[slot.type! - 101], installed = root.children.get(slot.id);
      if (!wheel?.radius) throw new Error('3D suspension needs CFG wheel radii');
      // Keep four query slots, but an absent wheel has no world membership, mass,
      // renderer or parent and therefore cannot generate contact/drive forces.
      const part=installed ?? new EnginePart(root.world,-slot.id,root.definition);
      if(!installed)part.condition=0;
      const originalTyre = root.world.wheelRefs[slot.type! - 101];
      const fallback = wheel.spring ?? [0.29,0.1,0.05];
      const rest = originalTyre && originalTyre.restLength>0 ? originalTyre.restLength : fallback[0];
      const bump = originalTyre && originalTyre.minLength>0 ? Math.max(0,rest-originalTyre.minLength) : fallback[1];
      const droop = originalTyre && originalTyre.maxLength>0 ? Math.max(0,originalTyre.maxLength-rest) : fallback[2];
      const frame = root.slotFrame(slot), center = new Vector3().setFromMatrixPosition(frame);
      const hardpoint = center.clone().add(new Vector3(0, rest, 0));
      return { nativeSlip: {longitudinal:0,angle:0}, part, center, hardpoint, originalHardpoint: hardpoint.clone(), damage: new Matrix4(), mountCondition: 1, radius: originalTyre?.radius ?? wheel.radius, originalTyre, rest, bump, droop, length: rest, supportX: 0, supportZ: 0, contact: false, force: 0, contactPoint: new Vector3(), contactNormal: new Vector3(0, 1, 0), forward: new Vector3(0, 0, -1), slipSpeed: 0, lateralSpeed: 0, surface: 'road' as const, frame, inverseOwn: installed ? slotMatrix(part.definition.config, part.definition.config.slots.find(s => s.id === part.ownSlot)!).invert() : new Matrix4(), steering: wheel.parameters[0] ?? 0, spin: 0, omega: 0, slip: 0 };
    });
    if (root.world.javaPowertrain) this.tireModel.model = 'sl2';
    if (this.wheels.length !== 4) throw new Error('3D prototype requires four configured wheels');
    for (const part of root.children.values()) {
      const kind = part.definition.mechanics?.kind, slot = cfg.slots.find(s => s.id === part.parentSlot), type = slot?.type ?? 0;
      if (!kind || kind === 'sway' || kind === 'engine') continue;
      const index = type >= 201 && type <= 204 || type >= 301 && type <= 304 ? type % 100 - 1 : -1;
      if (index >= 0) this.movingParts[index].push({ part, base: part.local.clone() });
    }
    const slot = cfg.slots.find(s => s.type === 11), part = slot && root.children.get(slot.id);
    if (slot && part) this.steering = { part, frame: root.slotFrame(slot), inverseOwn: part.slotFrame(part.definition.config.slots.find(s => s.id === part.ownSlot)!).invert() };
  }
  reset() { this.steer = 0; this.mechanics?.reset(); this.wheels.forEach(w => { w.nativeSlip = {longitudinal:0,angle:0}; w.spin = w.omega = w.slip = w.slipSpeed = w.lateralSpeed = 0; w.length = w.rest; w.force = 0; w.contact = false; w.damage.identity(); w.mountCondition = 1; w.supportHeight = undefined; w.supportX = w.supportZ = 0; w.hardpoint.copy(w.originalHardpoint); }); this.movingParts.flat().forEach(m => m.base.copy(m.part.local)); }
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
    const target = Math.max(-1, Math.min(1, input.steer)) * (this.root.definition.config.maxSteer ?? 0.6); this.steer = steeringHelpStep(this.steer,target,Math.hypot(this.body.velocity.x,this.body.velocity.z),dt,this.helping.steer,input.steerDigital===true);
    const frame = this.body.matrix(), count = this.wheels.length;
    const chassisForward = new Vector3(0, 0, -1).applyQuaternion(this.body.orientation);
    const roadSpeed = this.body.velocity.dot(chassisForward);
    const drivetrain = this.mechanics?.advance(dt, input, this.wheels.map(w => w.omega), this.wheels.map(w => roadSpeed / w.radius), roadSpeed,this.helping.acceleration>0?this.wheels.map(w=>w.contact):undefined);
    const serviceBrake=Math.max(0,Math.min(1,input.serviceBrakeAxis??input.brakeAxis??(input.brake?1:0)));
    const handbrake=handbrakeEffort(input.handbrakeAxis??0);
    const serviceDemand=drivetrain?.directionBrake?1:serviceBrake;
    for (const [index, w] of this.wheels.entries()) {
      const support = this.mechanics?.support(index) ?? 1;
      const failure = Math.max(0, 1 - Math.min(w.mountCondition, support) / 0.1);
      const side = index % 2 ? -1 : 1, alignment = w.damage.clone().multiply(new Matrix4().makeRotationZ(side * failure * 0.4));
      if (w.originalTyre) {
        const [yaw,pitch,roll]=w.originalTyre.orientation;
        alignment.multiply(new Matrix4().makeRotationFromEuler(new Euler(pitch,yaw,roll,'YXZ')));
      }
      const down = new Vector3(0, -1, 0).transformDirection(alignment).applyQuaternion(this.body.orientation);
      const hard = w.hardpoint.clone().applyMatrix4(frame), sag = Math.min(w.bump * 0.4, 0.04);
      const k = w.originalTyre?.force ? w.originalTyre.force * support : this.mechanics ? this.mechanics.spring(index) : this.springMass * 9.81 / count / sag;
      const damping = w.originalTyre?.damping[0] ? w.originalTyre.damping[0] * support : this.mechanics ? this.mechanics.damper(index) : 2 * 0.75 * Math.sqrt(k * this.springMass / count);
      let length = w.rest + w.droop;
      let groundHeight = this.terrainQuery("height",()=>this.terrain.height(hard.x, hard.z, hard.y));
      if (down.y < -0.05) {
        if (groundHeight > -999) {
          // Reject near-vertical upward jumps from overlapping map meshes. Real ramps remain
          // supported, while a bad triangle cannot kick the wheel through its full travel.
          const distance = w.supportHeight === undefined ? Infinity : Math.hypot(hard.x - w.supportX, hard.z - w.supportZ);
          if (Number.isFinite(distance)) groundHeight = Math.min(groundHeight, w.supportHeight! + distance * 2.2 + 0.04);
          w.supportHeight = groundHeight; w.supportX = hard.x; w.supportZ = hard.z;
        }
        const ray = (hard.y - groundHeight - w.radius) / -down.y;
        length = ray;
      }
      w.contact = w.part.parent === this.root && w.part.condition > 0 && w.mountCondition > 0 && support > 0 && length < w.rest + w.droop && down.y < -0.05; w.length = Math.max(w.rest - w.bump, Math.min(w.rest + w.droop, length)); w.force = w.slipSpeed = w.lateralSpeed = 0;
      if (w.contact) {
        const patch = hard.clone().addScaledVector(down, length).add(new Vector3(0, -w.radius, 0));
        const terrainHit = this.terrain.sample?this.terrainQuery("patch_sample",()=>this.terrain.sample!(patch.x,patch.z,hard.y)):undefined;
        const normal = terrainHit?.normal ?? this.terrainQuery("normal_fallback",()=>this.terrain.normal(patch.x, patch.z, hard.y)), speed = this.body.pointVelocity(hard).dot(normal);
        const springForce = w.originalTyre ? nativeSuspensionForce(length,w.length,speed,w.rest,w.rest+w.droop,k,damping,w.originalTyre.damping[1]*support).force
          : (w.rest-length)*k-damping*speed;
        w.force = Math.max(0,Math.min(this.body.mass*9.81*3,springForce+Math.max(0,w.rest-w.bump-length)*k*8));
        this.body.addForce(normal.clone().multiplyScalar(w.force), hard);
        const wheelSteer = ackermannSteerAngle(this.steer, w.center.x, this.root.definition.config.ackermann ?? 2, w.steering);
        const forward = new Vector3(0, 0, -1).applyAxisAngle(new Vector3(0, 1, 0), wheelSteer).transformDirection(alignment).applyQuaternion(this.body.orientation); forward.addScaledVector(normal, -forward.dot(normal)).normalize();
        const side = new Vector3().crossVectors(forward, normal).normalize(), velocity = this.body.pointVelocity(patch), longitudinal = velocity.dot(forward);
        w.contactPoint.set(patch.x, groundHeight + 0.012, patch.z);
        w.contactNormal.copy(normal); w.forward.copy(forward); w.surface = terrainHit?.surface ?? 'road';
        w.lateralSpeed = velocity.dot(side);
        const drive = this.mechanics ? drivetrain!.torque[index] : Math.max(-1, Math.min(1, input.throttle)) * this.body.mass * 5 / count;
        const braking = serviceDemand>0||handbrake>0;
        const limit = w.force * 1.05 * Math.max(0.25, Math.pow(Math.abs(down.dot(normal)), 2));
        if (this.mechanics) {
          const slipSpeed = w.omega * w.radius - longitudinal;
          w.slipSpeed = slipSpeed;
          w.slip = slipSpeed / Math.max(2, Math.abs(longitudinal), Math.abs(w.omega * w.radius));
          const native = this.tireModel.model === 'sl2' && w.originalTyre;
          const tyre = native ? nativeTireForces(w.force,w.omega*w.radius,longitudinal,w.lateralSpeed,dt,w.nativeSlip,native.pacejka)
            : tireForces(w.force,Math.max(0.25,Math.pow(Math.abs(down.dot(normal)),2)),slipSpeed,w.lateralSpeed,longitudinal,w.omega*w.radius,this.tireModel,w.originalTyre);
          if ('slip' in tyre) w.nativeSlip = tyre.slip as {longitudinal:number;angle:number};
          if (native) {
            // Recovered predictor prevents the tire reaction crossing zero slip.
            const predicted = updateSlip((w.omega-tyre.longitudinal*w.radius/HOST_WHEEL_INERTIA*dt)*w.radius,longitudinal,w.lateralSpeed,dt,w.nativeSlip);
            if (predicted.longitudinal*w.nativeSlip.longitudinal<0)
              tyre.longitudinal *= Math.abs(w.nativeSlip.longitudinal/(predicted.longitudinal-w.nativeSlip.longitudinal));
          }
          const force = forward.clone().multiplyScalar(tyre.longitudinal).addScaledVector(side, tyre.lateral);
          this.body.addForce(force, patch);
          const brakeTorque = serviceDemand>0 && !native ? Math.min(Math.abs(w.omega) * 80, 950 * this.mechanics.brake(index)) * serviceDemand * Math.sign(w.omega) : 0;
          const rollingTorque = w.originalTyre ? Math.sign(w.omega) * w.force * w.radius * (this.tireModel.model === 'sl2' ? w.originalTyre.rollResistance*0.01 : w.originalTyre.rollResistance - 0.003625) : 0;
          const beforeBrake=w.omega+(drive-force.dot(forward)*w.radius-rollingTorque-w.omega*.15)/HOST_WHEEL_INERTIA*dt;
          w.omega=absBrakeStep(beforeBrake,beforeBrake-brakeTorque/HOST_WHEEL_INERTIA*dt,longitudinal,w.radius,this.helping.abs);
          if(!native&&handbrake>0&&index>=2){
            const amount=950*this.mechanics.brake(index)*handbrake/HOST_WHEEL_INERTIA*dt;
            w.omega=Math.sign(w.omega)*Math.max(0,Math.abs(w.omega)-amount);
          }
          if (native) {
            const config=this.root.definition.config, inertia=config.enginePower?.[5] ?? 50;
            const [brakeStrength,handbrakeStrength]=config.brakePower ?? [1000,2000];
            const inverseInertia=0.1/Math.max(0.01,inertia);
            const free=wheelBrake(w.omega,dt,inverseInertia,0,0,Math.max(0,native.brake)*support,Math.max(0,native.handBrake),native.bearing,brakeStrength,handbrakeStrength);
            const braked=wheelBrake(w.omega,dt,inverseInertia,serviceDemand,0,Math.max(0,native.brake)*support,Math.max(0,native.handBrake),native.bearing,brakeStrength,handbrakeStrength);
            w.omega=absBrakeStep(free,braked,longitudinal,w.radius,this.helping.abs);
            if(handbrake>0)w.omega=wheelBrake(w.omega,dt,inverseInertia,0,handbrake,Math.max(0,native.brake)*support,Math.max(0,native.handBrake),0,brakeStrength,handbrakeStrength);
          }
          w.spin += w.omega * dt;
        } else {
          const wheelBraking=Math.max(serviceDemand,index>=2?handbrake:0);
          const brakeForce = wheelBraking>0 ? -longitudinal * this.body.mass / count / dt * wheelBraking : -longitudinal * this.body.mass * 0.08 / count;
          const force = forward.multiplyScalar(drive + brakeForce).addScaledVector(side, -velocity.dot(side) * this.body.mass / count / (dt * 6));
          if (force.length() > limit) force.setLength(limit); this.body.addForce(force, patch); w.spin += longitudinal * dt / w.radius;
        }
      }
      else if (this.mechanics) {
        w.nativeSlip = {longitudinal:0,angle:0};
        const brakeDemand=Math.max(serviceDemand,index>=2?handbrake:0);
        const brakeTorque = brakeDemand>0 ? Math.min(Math.abs(w.omega) * 80, 950 * this.mechanics.brake(index))*brakeDemand * Math.sign(w.omega) : 0;
        w.omega += (drivetrain!.torque[index] - brakeTorque - w.omega * 0.25) / HOST_WHEEL_INERTIA * dt; w.spin += w.omega * dt; w.slip = 0;
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
      if (w.originalTyre) {
        const [yaw,pitch,roll]=w.originalTyre.orientation;
        damaged.multiply(new Matrix4().makeRotationFromEuler(new Euler(pitch,yaw,roll,'YXZ')));
      }
      const down = new Vector3(0, -1, 0).transformDirection(damaged), rotation = new Quaternion().setFromRotationMatrix(damaged);
      const offset = new Vector3().setFromMatrixPosition(w.frame).sub(w.center).applyQuaternion(rotation);
      const position = w.hardpoint.clone().addScaledVector(down, w.length).add(offset);
      const wheelSteer = ackermannSteerAngle(this.steer, w.center.x, this.root.definition.config.ackermann ?? 2, w.steering);
      if (w.mountCondition === 1 && applyExperimentalHubPose(this.root, index, w.length, wheelSteer, w.spin * sign)) continue;
      w.part.armTravelTransform = undefined;
      const unsteered = damaged.clone().multiply(w.frame).setPosition(position);
      const carrier = unsteered.clone().multiply(new Matrix4().makeRotationY(wheelSteer));
      const steeringTransform = carrier.clone().multiply(unsteered.clone().invert());
      w.part.local.copy(carrier).multiply(new Matrix4().makeRotationX(-w.spin * sign)).multiply(w.inverseOwn);
      w.part.steeringTransform.copy(steeringTransform);
      const travel = carrier.multiply(w.frame.clone().invert());
      for (const moving of this.movingParts[index]) if (moving.part.parent === this.root) {
        moving.part.armTravelTransform = undefined;
        moving.part.local.copy(travel).multiply(moving.base);
        moving.part.steeringTransform.copy(steeringTransform);
      }
    }
    if (this.steering) this.steering.part.local.copy(this.steering.frame).multiply(new Matrix4().makeRotationZ(this.steer * 14)).multiply(this.steering.inverseOwn);
  }
}
