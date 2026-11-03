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
    // Tire/rim and steerable hub/brake frames turn; control arms and springs do not.
    if (!(type >= 101 && type <= 104 || type >= 201 && type <= 204)) continue;
    const wheel = config.wheels[type % 100 - 1];
    if (!wheel) continue;
    const frame = root.slotFrame(slot);
    const steer = ackermannSteerAngle(angle, frame.elements[12], config.ackermann ?? 2, wheel.parameters[0] ?? 0);
    part.local.copy(frame).multiply(new Matrix4().makeRotationY(steer)).multiply(part.slotFrame(own).invert());
  }
}
