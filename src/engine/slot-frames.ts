import { Matrix4 } from 'three';
import type { CfgSlot, PartConfig } from '../formats/cfg';
import { poseMatrix } from './transforms';

export type WheelFrameOffsets = readonly (readonly [number, number, number])[];
/** User-measured shared placement correction, in chassis metres: FL, FR, RL, RR. */
export const SUSPENSION_ATTACHMENT_OFFSETS: WheelFrameOffsets = [
  [0.055, 0, 0], [-0.055, 0, 0], [-0.075, 0, 0], [0.075, 0, 0],
];

export function wheelFrameMatrix(config: PartConfig, index: number, height = 0, offsets: WheelFrameOffsets = []) {
  const wheel = config.wheels[index];
  if (!wheel) throw new Error(`Wheel frame ${index} missing`);
  const frame = poseMatrix(wheel), offset = offsets[index];
  frame.elements[12] += offset?.[0] ?? 0;
  frame.elements[13] += height + (offset?.[1] ?? 0);
  frame.elements[14] += offset?.[2] ?? 0;
  return frame;
}

/** Native slottype selects a frame, independently of the user-defined slot ID. */
export function slotMatrix(config: PartConfig, slot: CfgSlot, wheelFrameOffsetY = 0, offsets: WheelFrameOffsets = []) {
  const type = slot.type ?? 0;
  let frame = new Matrix4();
  if (type === 11) {
    if (!config.steering) throw new Error('slottype 11 requires a steering frame');
    frame = poseMatrix(config.steering);
  } else if (type >= 101 && type <= 199 || type >= 201 && type <= 204 || type >= 301 && type <= 304) {
    const wheel = config.wheels[(type % 100) - 1];
    if (!wheel) throw new Error(`slottype ${type}: wheel frame missing`);
    frame = wheelFrameMatrix(config, (type % 100) - 1, wheelFrameOffsetY, offsets);
  } else if (type !== 0) throw new Error(`Unsupported slot frame type ${type}`);
  return frame.multiply(poseMatrix(slot));
}
