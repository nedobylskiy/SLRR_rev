import { Matrix4 } from 'three';

/** SCX geometry uses centimetres; CFG poses use metres. Keep object/slot frames in metres. */
export const SCX_TO_WORLD = 0.01;

/** Right multiplication scales mesh vertices only, never the part's world translation. */
export function modelMatrix(partWorld: Matrix4) {
  return partWorld.clone().multiply(new Matrix4().makeScale(SCX_TO_WORLD, SCX_TO_WORLD, SCX_TO_WORLD));
}
