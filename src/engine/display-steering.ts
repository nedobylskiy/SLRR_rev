import { Matrix4 } from 'three';
import type { EnginePart } from './world';
import { ackermannSteerAngle } from './suspension-3d';

/** Pose parked cars from their own CFG frames; never accumulate render rotations. */
export function applyDisplaySteering(root: EnginePart, input: number): void {
  const config = root.definition.config;
  const angle = Math.max(-1, Math.min(1, input)) * (config.maxSteer ?? 0.6);
  for (const part of root.children.values()) {
    const slot = config.slots.find(slot => slot.id === part.parentSlot);
    const own = part.definition.config.slots.find(slot => slot.id === part.ownSlot);
    if (!slot || !own) continue;
    const type = slot.type ?? 0;
    if (type === 11) {
      part.local.copy(root.slotFrame(slot)).multiply(new Matrix4().makeRotationZ(angle * 14)).multiply(part.slotFrame(own).invert());
      continue;
    }
    // WheelRef-mounted rims, hubs and spring/strut seats share steering.
    // Additional linked arm geometry still follows its own CFG anchors.
    if (!(type >= 101 && type <= 104 || type >= 201 && type <= 204 || type >= 301 && type <= 304)) continue;
    const wheel = config.wheels[type % 100 - 1];
    if (!wheel) continue;
    const frame = root.slotFrame(slot);
    // A hub slot may be offset from the rim's slot. Rotate both around the
    // shared WheelRef carrier, not around each individual attachment origin.
    const carrier = root.wheelFrame(type % 100 - 1);
    const steer = ackermannSteerAngle(angle, carrier.elements[12], config.ackermann ?? 2, wheel.parameters[0] ?? 0);
    const delta = steer === 0 ? new Matrix4() : carrier.clone().multiply(new Matrix4().makeRotationY(steer)).multiply(carrier.clone().invert());
    part.local.copy(delta).multiply(frame).multiply(part.slotFrame(own).invert());
  }
}
