import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { CfgPose } from '../formats/cfg';

export function poseMatrix(pose: CfgPose) {
  const [yaw, pitch, roll] = pose.rotation;
  return new Matrix4().compose(new Vector3(...pose.position), new Quaternion().setFromEuler(new Euler(pitch, yaw, roll, 'YXZ')), new Vector3(1, 1, 1));
}
