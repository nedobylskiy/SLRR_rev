import { Matrix4 } from 'three';
import type { EnginePart } from './world';

/** Original native_install::mount_group: inherited root mount, not the child slot ID. */
export function linkedMountGroup(part: EnginePart): number | undefined {
  let type = 0;
  for (let child = part; child.parent; child = child.parent)
    type = child.parent.definition.config.slots.find(slot => slot.id === child.parentSlot)?.type ?? 0;
  return type >= 101 && type <= 400 ? (type - 101) % 10 : undefined;
}

/** First matching declaration wins; the optional third value selects the parent attachment slot. */
export function selectLinkedRule(part: EnginePart, rules: readonly (readonly number[])[]) {
  return rules.find(rule => !rule[2] || rule[2] === part.parentSlot);
}

/** Search self then installed-on ancestors, preserving full anchor orientation. */
export function linkedSlotFrame(part: EnginePart, baseId: number, followSteering = true): Matrix4 | undefined {
  if (!baseId) return;
  const id = baseId + (linkedMountGroup(part) ?? 0);
  for (let owner: EnginePart | undefined = part; owner; owner = owner.parent) {
    const slot = owner.definition.config.slots.find(slot => slot.id === id);
    if (!slot) continue;
    const frame = owner.slotFrame(slot), type = slot.type ?? 0;
    // Slots on a live hub/wheel carrier follow that carrier's travel/steering.
    if (type >= 101 && type <= 400) {
      const carrier = [...owner.children.values()].find(child =>
        child.definition.config.slots.some(own => own.id === child.ownSlot) &&
        owner!.definition.config.slots.find(mount => mount.id === child.parentSlot)?.type === type);
      if (carrier) {
        const mount = owner.definition.config.slots.find(mount => mount.id === carrier.parentSlot)!;
        const own = carrier.definition.config.slots.find(own => own.id === carrier.ownSlot)!;
        const local = carrier.local.clone();
        if (!followSteering) local.premultiply(carrier.steeringTransform.clone().invert());
        frame.premultiply(local.multiply(carrier.slotFrame(own)).multiply(owner.slotFrame(mount).invert()));
      }
    }
    return part.matrix().invert().multiply(owner.matrix()).multiply(frame);
  }
}

