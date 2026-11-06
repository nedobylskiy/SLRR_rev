import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { WheelRefState } from '../runtime/wheel-ref-native';
import type { EnginePart } from './world';
import { suspensionAnchorLength } from './suspension-geometry';

export interface HubFrames { arm: Matrix4; hub: Matrix4 }

/** Experimental numerical reconstruction of the documented arm-circle and hub 0/-1 paths.
 * See docs/physics-upstream-audit-2026-11-05.md; no upstream implementation is bundled.
 * Inputs are chassis-space template coordinates, not mounted tyre mesh positions.
 */
export function solveHubGeometry(reference: Vector3, point: Vector3, wheel: Pick<WheelRefState, 'arm' | 'hub' | 'orientation'>): HubFrames | undefined {
  const a = wheel.arm, h = wheel.hub;
  if (a.length !== 7 || h.length !== 10 || !(a[0] > 0) || h[0] !== 0 && h[0] !== -1
    || ![...a, ...h, ...wheel.orientation, ...reference.toArray(), ...point.toArray()].every(Number.isFinite)) return;
  const axis = new Vector3(a[4], a[5], a[6]);
  if (axis.lengthSq() < 1e-16) return;
  axis.normalize();
  const pivot = reference.clone().add(new Vector3(a[1], a[2], a[3]));
  const lower = new Vector3(h[1], h[2], h[3]);
  const relative = point.clone().add(new Vector3(0, h[0] === 0 ? lower.y : 0, 0)).sub(pivot);
  const axial = relative.dot(axis), radial = relative.clone().addScaledVector(axis, -axial);
  const radius = radial.length(), horizontal2 = radius * radius - relative.y * relative.y;
  if (radius < 1e-9 || horizontal2 < -1e-8) return;
  const side = Math.sign(relative.x * axis.z - relative.z * axis.x);
  const angle = Math.atan2(relative.y, Math.sqrt(Math.max(0, horizontal2))) * side;
  const armRotation = new Quaternion().setFromAxisAngle(axis, angle);
  const armPosition = pivot.addScaledVector(axis, axial).addScaledVector(radial, a[0] / radius);
  const [yaw, pitch, roll] = wheel.orientation;
  let hubRotation = armRotation.clone().multiply(new Quaternion().setFromEuler(new Euler(pitch, yaw, roll, 'YXZ')));
  let hubPosition = armPosition.clone();
  if (h[0] === 0) {
    const strut = new Vector3(h[4], h[5], h[6]);
    if (strut.lengthSq() < 1e-16) return;
    strut.normalize();
    const span = reference.clone().add(new Vector3(h[7], h[8], h[9])).sub(lower).sub(armPosition);
    const projection = lower.dot(strut), discriminant = span.lengthSq() - lower.lengthSq() + projection * projection;
    if (span.lengthSq() < 1e-12 || discriminant <= 0) return;
    let distance = projection + Math.sqrt(discriminant);
    if (distance < 0) distance = projection - Math.sqrt(discriminant);
    const line = strut.multiplyScalar(distance).sub(lower);
    if (line.lengthSq() < 1e-16) return;
    line.normalize(); span.normalize();
    // The documented native fit has no qualified antiparallel fallback axis.
    if (line.dot(span) < -1 + 1e-10) return;
    hubRotation = new Quaternion().setFromUnitVectors(line, span);
    hubPosition.sub(lower.applyQuaternion(hubRotation));
  }
  const unit = new Vector3(1, 1, 1);
  const arm = new Matrix4().compose(armPosition, armRotation, unit);
  const hub = new Matrix4().compose(hubPosition, hubRotation, unit);
  if (![...arm.elements, ...hub.elements].every(Number.isFinite)) return;
  return { arm, hub };
}

/** Apply authored hardware mounts exactly once, with distinct arm/hub frames. */
export function applyExperimentalHubPose(root: EnginePart, index: number, length: number, steer: number, spin = 0): boolean {
  if (!root.world.experimentalHubGeometry || !Number.isFinite(length)) return false;
  const config = root.definition.config, cfg = config.wheels[index], state = root.world.wheelRefs[index];
  if (!cfg || !state || state.oppositeWheel >= 0) return false;
  const reference = new Vector3(...state.position);
  const point = reference.clone().add(new Vector3(0, suspensionAnchorLength(cfg) - length, 0));
  const frames = solveHubGeometry(reference, point, state);
  if (!frames) return false;
  // Retain per-corner debug offsets. Loaded geometry replaces the global
  // fallback ride-height offset, as in parked spring settling.
  const offset = root.wheelFrameOffsets[index] ?? [0, 0, 0];
  const adjustment = new Matrix4().makeTranslation(...offset);
  frames.arm.premultiply(adjustment); frames.hub.premultiply(adjustment);
  const inverse = root.wheelFrame(index).invert();
  const armDelta = frames.arm.clone().multiply(inverse);
  const hubSteered = frames.hub.clone().multiply(new Matrix4().makeRotationY(steer));
  const steering = hubSteered.clone().multiply(frames.hub.clone().invert());
  for (const part of root.children.values()) {
    const slot = config.slots.find(slot => slot.id === part.parentSlot), type = slot?.type ?? 0;
    if (!slot || !((type >= 101 && type <= 104 || type >= 201 && type <= 204 || type >= 301 && type <= 304) && type % 100 - 1 === index)) continue;
    const own = part.definition.config.slots.find(slot => slot.id === part.ownSlot);
    if (!own) continue;
    const frame = type >= 301 ? frames.arm.clone() : hubSteered.clone();
    if (type < 200) frame.multiply(new Matrix4().makeRotationX(-spin));
    part.local.copy(frame.multiply(inverse).multiply(root.slotFrame(slot)).multiply(part.slotFrame(own).invert()));
    part.steeringTransform.copy(type >= 301 ? new Matrix4() : steering);
    part.armTravelTransform = armDelta;
  }
  return true;
}
