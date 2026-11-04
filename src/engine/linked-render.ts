import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import type { EnginePart } from './world';
import { linkedSlotFrame } from './linked-slots';

/** Two-anchor render geometry (e.g. a CV shaft) is authored along local +Y. */
export function linkedRenderPose(part: EnginePart, links: readonly number[], bounds: Box3): Matrix4 | undefined {
  if (!links.length || links[2] && links[2] !== part.parentSlot) return;
  const first = linkedSlotFrame(part, links[0]);
  if (!first) return;
  if (!links[1]) return first;
  const second = linkedSlotFrame(part, links[1]);
  if (!second) return;
  const points = [first, second].map(frame => new Vector3().setFromMatrixPosition(frame));
  const axis = points[1].clone().sub(points[0]), length = axis.length(), height = bounds.max.y - bounds.min.y;
  if (length < 1e-6 || height < 1e-6) return;
  const center = bounds.getCenter(new Vector3());
  return new Matrix4().makeTranslation(points[0].x, points[0].y, points[0].z)
    .multiply(new Matrix4().makeRotationFromQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis.divideScalar(length))))
    .multiply(new Matrix4().makeScale(1, length / height, 1))
    .multiply(new Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));
}
