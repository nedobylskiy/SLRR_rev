import { Euler, Matrix4, MathUtils } from 'three';
import type { EnginePart } from '../engine/world';

export type DebugTriple = [number, number, number];
export interface SuspensionDebugSettings {
  frontOffset: DebugTriple;
  rearOffset: DebugTriple;
  rearRotation: DebugTriple;
  rearShaftRotation: DebugTriple;
}
export const defaultSuspensionDebug = (): SuspensionDebugSettings => ({
  frontOffset: [0, 0, 0], rearOffset: [0, 0, 0], rearRotation: [0, 0, 0], rearShaftRotation: [0, 0, 0],
});
export function suspensionCorner(part: EnginePart): number | undefined {
  const type = part.parent?.definition.config.slots.find(slot => slot.id === part.parentSlot)?.type;
  return type !== undefined && (type >= 101 && type <= 104 || type >= 201 && type <= 204 || type >= 301 && type <= 304) ? type % 100 - 1 : undefined;
}
export function debugRotation(degrees: DebugTriple): Matrix4 {
  return new Matrix4().makeRotationFromEuler(new Euler(MathUtils.degToRad(degrees[0]), MathUtils.degToRad(degrees[1]), MathUtils.degToRad(degrees[2]), 'XYZ'));
}
/** Render-only adjustment: never mutate Java slots, physics, or serialized part poses. */
export function suspensionDebugMatrix(part: EnginePart, settings: SuspensionDebugSettings): Matrix4 {
  const local = part.local.clone(), corner = suspensionCorner(part);
  let inherited = false;
  for (let parent = part.parent; parent; parent = parent.parent) if (suspensionCorner(parent) !== undefined) inherited = true;
  if (corner !== undefined && !inherited) {
    const offset = corner < 2 ? settings.frontOffset : settings.rearOffset;
    local.premultiply(new Matrix4().makeTranslation(...offset));
  }
  return part.parent ? suspensionDebugMatrix(part.parent, settings).multiply(local) : local;
}
