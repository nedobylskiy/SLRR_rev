import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import type { EnginePart } from './world';

/** Two-anchor render geometry (e.g. a CV shaft) is authored along local +Y. */
export function linkedRenderPose(part: EnginePart, links: readonly number[], bounds: Box3): Matrix4 | undefined {
  const root = part.parent;
  if (!root || links.length < 2) return;
  const cfg = root.definition.config;
  const mount = cfg.slots.find(slot => slot.id === part.parentSlot);
  const own = part.definition.config.slots.find(slot => slot.id === part.ownSlot);
  const type = mount?.type ?? 0;
  if (!mount || !own || !(type >= 201 && type <= 204 || type >= 301 && type <= 304)) return;
  const corner = type % 100 - 1;
  const slots = links.slice(0, 2).map(id => cfg.slots.find(slot => slot.id === id + corner));
  if (slots.some(slot => !slot)) return;
  const inverse = part.local.clone().invert();
  // Hub-relative anchors follow live steering/travel. Chassis anchors stay fixed.
  const hubMotion = part.local.clone().multiply(part.slotFrame(own)).multiply(root.slotFrame(mount).invert());
  const points = slots.map(slot => {
    const frame = root.slotFrame(slot!);
    if (slot!.type !== undefined && slot!.type >= 201 && slot!.type <= 204) frame.premultiply(hubMotion);
    return new Vector3().setFromMatrixPosition(frame).applyMatrix4(inverse);
  });
  const axis = points[1].clone().sub(points[0]), length = axis.length(), height = bounds.max.y - bounds.min.y;
  if (length < 1e-6 || height < 1e-6) return;
  const center = bounds.getCenter(new Vector3());
  return new Matrix4().makeTranslation(points[0].x, points[0].y, points[0].z)
    .multiply(new Matrix4().makeRotationFromQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis.divideScalar(length))))
    .multiply(new Matrix4().makeScale(1, length / height, 1))
    .multiply(new Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));
}
