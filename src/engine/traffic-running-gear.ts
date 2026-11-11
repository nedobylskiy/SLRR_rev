import type { EnginePart } from './world';

/** Wheel/tyre subtree only. Struts (201..204) and shocks (301..304) never spin. */
export function trafficWheelIndex(part: EnginePart, root: EnginePart): number | undefined {
  if (part === root) return;
  let top = part;
  while (top.parent && top.parent !== root) top = top.parent;
  if (top.parent !== root) return;
  const type = root.definition.config.slots.find(slot => slot.id === top.parentSlot)?.type ?? 0;
  return type >= 101 && type <= 104 ? type - 101 : undefined;
}
