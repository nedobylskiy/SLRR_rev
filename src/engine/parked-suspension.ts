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
  if (config.wheels.length !== 4) return false;
  const mass = vehicleAssemblyMass(root.world.parts.values()), center = vehicleAssemblyCenter(root);
  const frames = config.wheels.map((_, index) => root.wheelFrame(index));
  const frontZ = (frames[0].elements[14] + frames[1].elements[14]) / 2;
  const rearZ = (frames[2].elements[14] + frames[3].elements[14]) / 2;
  const frontShare = Math.abs(rearZ - frontZ) > 1e-6 ? Math.max(0, Math.min(1, (rearZ - center.z) / (rearZ - frontZ))) : 0.5;
  const shifts = config.wheels.map((wheel, index) => {
    const state=root.world.wheelRefs[index];
    if(!state||!(state.force>0&&state.restLength>0))return undefined;
    const axle = index < 2 ? 0 : 2;
    const left = frames[axle].elements[12], right = frames[axle + 1].elements[12];
    const leftShare = Math.abs(right - left) > 1e-6 ? Math.max(0, Math.min(1, (right - center.x) / (right - left))) : 0.5;
    const load = mass * (index < 2 ? frontShare : 1 - frontShare) * (index % 2 ? 1 - leftShare : leftShare);
    // The calibrated mount height is the fallback rest pose, not extra spring
    // travel. Replace it with the native loaded pose instead of adding both.
    return suspensionAnchorLength(wheel) - parkedSpringLength(state, load)! - root.wheelFrameOffsetY;
  });
  for (const part of root.children.values()) {
    const type = config.slots.find(slot => slot.id === part.parentSlot)?.type ?? 0;
    if (!(type >= 101 && type <= 104 || type >= 201 && type <= 204 || type >= 301 && type <= 304)) continue;
    const shift=shifts[type % 100 - 1];
    if(shift!==undefined)part.local.premultiply(new Matrix4().makeTranslation(0,shift,0));
  }
  return shifts.some(shift=>shift!==undefined);
}
