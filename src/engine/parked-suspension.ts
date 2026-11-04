import { Matrix4 } from 'three';
import type { EnginePart } from './world';
import { vehicleAssemblyCenter, vehicleAssemblyMass } from './vehicle-3d';
import { parkedSpringLength, suspensionAnchorLength } from './suspension-geometry';

/** Reset hardware to attachment frames before applying parked steering and travel. */
export function resetParkedRunningGear(root: EnginePart): void {
  for (const part of root.children.values()) {
    const type = root.definition.config.slots.find(slot => slot.id === part.parentSlot)?.type ?? 0;
    if (type >= 101 && type <= 104 || type >= 201 && type <= 204 || type >= 301 && type <= 304)
      root.world.refreshAttachment(part);
  }
}

export function settleParkedSuspension(root: EnginePart): boolean {
  const config = root.definition.config;
  if (config.wheels.length !== 4 || root.world.wheelRefs.filter(wheel => wheel && wheel.force > 0 && wheel.restLength > 0).length !== 4) return false;
  const mass = vehicleAssemblyMass(root.world.parts.values()), center = vehicleAssemblyCenter(root);
  const frontZ = (config.wheels[0].position[2] + config.wheels[1].position[2]) / 2;
  const rearZ = (config.wheels[2].position[2] + config.wheels[3].position[2]) / 2;
  const frontShare = Math.abs(rearZ - frontZ) > 1e-6 ? Math.max(0, Math.min(1, (rearZ - center.z) / (rearZ - frontZ))) : 0.5;
  const shifts = config.wheels.map((wheel, index) => {
    const axle = index < 2 ? 0 : 2;
    const left = config.wheels[axle].position[0], right = config.wheels[axle + 1].position[0];
    const leftShare = Math.abs(right - left) > 1e-6 ? Math.max(0, Math.min(1, (right - center.x) / (right - left))) : 0.5;
    const load = mass * (index < 2 ? frontShare : 1 - frontShare) * (index % 2 ? 1 - leftShare : leftShare);
    return suspensionAnchorLength(wheel) - parkedSpringLength(root.world.wheelRefs[index]!, load)!;
  });
  for (const part of root.children.values()) {
    const type = config.slots.find(slot => slot.id === part.parentSlot)?.type ?? 0;
    if (!(type >= 101 && type <= 104 || type >= 201 && type <= 204 || type >= 301 && type <= 304)) continue;
    part.local.premultiply(new Matrix4().makeTranslation(0, shifts[type % 100 - 1], 0));
  }
  return true;
}
