import type { EnginePart } from './world';
import {Matrix4} from 'three';

/** Use the actual hub/slot frame, not the separate ray-suspension sample position. */
export function trafficWheelFrame(root:EnginePart,index:number):Matrix4 {
  const slot=root.definition.config.slots.find(slot=>slot.type===101+index);
  return slot?root.slotFrame(slot):new Matrix4().makeTranslation(...root.definition.config.wheels[index].position);
}

/** Wheel/tyre subtree only. Struts (201..204) and shocks (301..304) never spin. */
export function trafficWheelIndex(part: EnginePart, root: EnginePart): number | undefined {
  if (part === root) return;
  let top = part;
  while (top.parent && top.parent !== root) top = top.parent;
  if (top.parent !== root) return;
  const type = root.definition.config.slots.find(slot => slot.id === top.parentSlot)?.type ?? 0;
  return type >= 101 && type <= 104 ? type - 101 : undefined;
}
