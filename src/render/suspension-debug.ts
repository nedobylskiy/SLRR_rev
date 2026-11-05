import { Euler, Matrix4, MathUtils } from 'three';
import type { EnginePart } from '../engine/world';

export type DebugTriple = [number, number, number];
export interface SuspensionDebugSettings {
  frontOffset: DebugTriple;
  rearOffset: DebugTriple;
  rearRotation: DebugTriple;
  rearShaftRotation: DebugTriple;
  rearLeftArmOffset: DebugTriple;
  rearRightArmOffset: DebugTriple;
  rearLeftArmRotation: DebugTriple;
  rearRightArmRotation: DebugTriple;
  frontLeftWheelOffset: DebugTriple;
  frontRightWheelOffset: DebugTriple;
  rearLeftWheelOffset: DebugTriple;
  rearRightWheelOffset: DebugTriple;
  frontLeftAttachmentOffset: DebugTriple;
  frontRightAttachmentOffset: DebugTriple;
  rearLeftAttachmentOffset: DebugTriple;
  rearRightAttachmentOffset: DebugTriple;
}
export const defaultSuspensionDebug = (): SuspensionDebugSettings => ({
  frontOffset: [0, 0, 0], rearOffset: [0, 0, 0], rearRotation: [0, 0, 0], rearShaftRotation: [0, 0, 0],
  rearLeftArmOffset: [0, 0, 0], rearRightArmOffset: [0, 0, 0],
  rearLeftArmRotation: [0, 0, 0], rearRightArmRotation: [0, 0, 0],
  frontLeftWheelOffset: [0, 0, 0], frontRightWheelOffset: [0, 0, 0],
  rearLeftWheelOffset: [0, 0, 0], rearRightWheelOffset: [0, 0, 0],
  frontLeftAttachmentOffset: [0, 0, 0], frontRightAttachmentOffset: [0, 0, 0],
  rearLeftAttachmentOffset: [0, 0, 0], rearRightAttachmentOffset: [0, 0, 0],
});
/** Reflect the right-side adjustment across X for the left arm. Positive X is outward. */
export function rearArmAdjustment(settings: SuspensionDebugSettings, corner: number) {
  const left = corner === 2, offset = left ? settings.rearLeftArmOffset : settings.rearRightArmOffset;
  const rotation = left ? settings.rearLeftArmRotation : settings.rearRightArmRotation;
  const sign = left ? -1 : 1;
  return { offset: [sign * offset[0], offset[1], offset[2]] as DebugTriple,
    rotation: rotation.map((value, axis) => settings.rearRotation[axis] + value * (axis === 0 ? 1 : sign)) as DebugTriple };
}
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
  const type = part.parent?.definition.config.slots.find(slot => slot.id === part.parentSlot)?.type;
  let inherited = false;
  for (let parent = part.parent; parent; parent = parent.parent) if (suspensionCorner(parent) !== undefined) inherited = true;
  if (corner !== undefined && !inherited) {
    const offset = corner < 2 ? settings.frontOffset : settings.rearOffset;
    local.premultiply(new Matrix4().makeTranslation(...offset));
    const individual = [settings.frontLeftAttachmentOffset, settings.frontRightAttachmentOffset, settings.rearLeftAttachmentOffset, settings.rearRightAttachmentOffset][corner];
    local.premultiply(new Matrix4().makeTranslation(...individual));
  }
  if (type !== undefined && type >= 101 && type <= 104) {
    const offsets = [settings.frontLeftWheelOffset, settings.frontRightWheelOffset, settings.rearLeftWheelOffset, settings.rearRightWheelOffset];
    local.premultiply(new Matrix4().makeTranslation(...offsets[type - 101]));
  }
  return part.parent ? suspensionDebugMatrix(part.parent, settings).multiply(local) : local;
}
