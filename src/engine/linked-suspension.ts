import { Vector3 } from 'three';
import type { EnginePart } from './world';
import { linkedSlotFrame, selectLinkedRule } from './linked-slots';

/** linked slot IDs are corner-relative chassis anchors, not wheel bone positions. */
export function linkedSuspensionAnchors(root: EnginePart, part: EnginePart) {
  let ancestor = part.parent;
  while (ancestor && ancestor !== root) ancestor = ancestor.parent;
  if (!ancestor) return;
  const renders = part.definition.config.renders;
  const rules = renders.length ? renders.map(render => selectLinkedRule(part, render.linkRules ?? (render.links ? [render.links] : []))) : part.definition.config.links;
  for (const link of rules) {
    if (!link?.[1] || link[2] && link[2] !== part.parentSlot) continue;
    const lower = linkedSlotFrame(part, link[0]);
    const upper = linkedSlotFrame(part, link[1]);
    if (!lower || !upper) continue;
    return {
      lower: new Vector3().setFromMatrixPosition(lower),
      upper: new Vector3().setFromMatrixPosition(upper),
    };
  }
}
