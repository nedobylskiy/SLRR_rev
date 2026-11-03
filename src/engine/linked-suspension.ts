import { Vector3 } from 'three';
import type { EnginePart } from './world';

/** linked slot IDs are corner-relative chassis anchors, not wheel bone positions. */
export function linkedSuspensionAnchors(root: EnginePart, part: EnginePart) {
  const mount = root.definition.config.slots.find(slot => slot.id === part.parentSlot);
  const type = mount?.type;
  if (part.parent !== root || type === undefined ||
      !(type >= 201 && type <= 204 || type >= 301 && type <= 304)) return;
  const corner = type % 100 - 1;
  for (const link of part.definition.config.links) {
    if (link.length < 2) continue;
    const lower = root.definition.config.slots.find(slot => slot.id === link[0] + corner);
    const upper = root.definition.config.slots.find(slot => slot.id === link[1] + corner);
    if (!lower || !upper) continue;
    const inverse = part.local.clone().invert();
    return {
      lower: new Vector3().setFromMatrixPosition(root.slotFrame(lower)).applyMatrix4(inverse),
      upper: new Vector3().setFromMatrixPosition(root.slotFrame(upper)).applyMatrix4(inverse),
    };
  }
}
