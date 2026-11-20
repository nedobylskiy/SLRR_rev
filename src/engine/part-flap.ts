import { Matrix4, Vector3 } from 'three';
import type { EnginePart } from './world';

const progress = new WeakMap<EnginePart, number>();

/** OpenSLRR's half-second hinge motion, around the parent CFG slot's pivot. */
export function advancePartFlap(part: EnginePart, open: boolean, seconds: number): boolean {
  const flap = part.parent?.definition.config.slots.find(slot => slot.id === part.parentSlot && slot.flap)?.flap;
  const previous = progress.get(part) ?? 0;
  if (!flap) {
    progress.delete(part);
    const changed = !!part.flapTransform;
    part.flapTransform = undefined;
    return changed;
  }
  const step = Math.max(0, Math.min(.1, seconds)) / .5;
  const next = open ? Math.min(1, previous + step) : Math.max(0, previous - step);
  if (next === previous) return false;
  progress.set(part, next);
  if (!next) { part.flapTransform = undefined; return true; }
  const axis = new Vector3(...flap.axis);
  if (axis.lengthSq() < 1e-12) return false;
  const angle = flap.high * next * next * (3 - 2 * next);
  part.flapTransform = new Matrix4().makeTranslation(...flap.pivot)
    .multiply(new Matrix4().makeRotationAxis(axis.normalize(), angle))
    .multiply(new Matrix4().makeTranslation(-flap.pivot[0], -flap.pivot[1], -flap.pivot[2]));
  return true;
}
