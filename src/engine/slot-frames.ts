import { Matrix4 } from 'three';
import type { CfgSlot, PartConfig } from '../formats/cfg';
import { poseMatrix } from './transforms';

/** Native slottype selects a frame, independently of the user-defined slot ID. */
export function slotMatrix(config: PartConfig, slot: CfgSlot) {
  const type = slot.type ?? 0;
  let frame = new Matrix4();
  if (type === 11) {
    if (!config.steering) throw new Error('slottype 11 requires a steering frame');
    frame = poseMatrix(config.steering);
  } else if (type >= 101 && type <= 199 || type >= 201 && type <= 204 || type >= 301 && type <= 304) {
    const wheel = config.wheels[(type % 100) - 1];
    if (!wheel) throw new Error(`slottype ${type}: wheel frame missing`);
    frame = poseMatrix(wheel);
  } else if (type !== 0) throw new Error(`Unsupported slot frame type ${type}`);
  return frame.multiply(poseMatrix(slot));
}
