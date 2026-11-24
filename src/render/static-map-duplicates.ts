import { Matrix4 } from 'three';
import { normalizePath } from '../assets';

const SCALE = new Matrix4().makeScale(0.01, 0.01, 0.01);

/**
 * Models the static map already draws, by SCX path and pose. Scripts sometimes place the same model again where
 * the map has it (the garage script re-creates the props of its room): both copies are coplanar, so any shading
 * difference between them (side, lightmaps, shadow sampling) shows as flickering depth-fight stripes, and every
 * draw is paid twice. A script copy that matches a map copy is not drawn.
 */
export class StaticMapDuplicates {
  private readonly models = new Map<string, Matrix4[]>();
  clear() { this.models.clear(); }
  get size() { let n = 0; for (const list of this.models.values()) n += list.length; return n; }
  /** `pose` places the model's metre-scaled vertices in the static map root (SCX units are centimetres). */
  add(path: string, pose: Matrix4) {
    const key = normalizePath(path);
    const list = this.models.get(key) ?? [];
    list.push(pose.clone().multiply(SCALE)); this.models.set(key, list);
  }
  /** `world` is the script model's world matrix, centimetre vertices included; `root` the static map root's. */
  covers(path: string, world: Matrix4, root: Matrix4) {
    const list = this.models.get(normalizePath(path));
    if (!list) return false;
    const target = new Matrix4();
    return list.some(pose => {
      target.multiplyMatrices(root, pose);
      // 1 mm in position; the 3x3 part carries the 0.01 unit scale, so 1e-5 there is 0.1 % of rotation/scale.
      return world.elements.every((value, i) => Math.abs(value - target.elements[i]) <= (i >= 12 && i <= 14 ? 1e-3 : 1e-5));
    });
  }
}
