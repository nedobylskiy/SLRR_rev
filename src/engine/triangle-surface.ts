import { Box3, Matrix4, Triangle, Vector3 } from 'three';
import type { PanelContact, PanelSurface, Triple } from './deformable-panel';

interface Face { triangle: Triangle; bounds: Box3; normal: Vector3 }
interface Branch { bounds: Box3; faces?: Face[]; left?: Branch; right?: Branch }
/** Two-sided swept node/sphere contacts against the assembled body's original triangles, in body space. */
export class TriangleSurface implements PanelSurface {
  private tree: Branch;
  private inverse = new Matrix4(); private previousInverse = new Matrix4(); private frame = new Matrix4();
  readonly radius = 0.035;
  hits = 0;
  constructor(triangles: ArrayLike<number>, private enabled: () => boolean, private velocity: (point: Vector3) => Vector3, private reaction: (impulse: Triple, point: Triple) => void) {
    if (!triangles.length || triangles.length % 9) throw new Error('Triangle surface requires triangles');
    const faces: Face[] = [];
    for (let i = 0; i < triangles.length; i += 9) {
      const t = new Triangle(new Vector3().fromArray(triangles, i), new Vector3().fromArray(triangles, i + 3), new Vector3().fromArray(triangles, i + 6));
      if (![...t.a.toArray(), ...t.b.toArray(), ...t.c.toArray()].every(Number.isFinite)) throw new Error('Invalid collision triangle');
      if (t.getArea() < 1e-10) continue;
      faces.push({ triangle: t, normal: t.getNormal(new Vector3()), bounds: new Box3().setFromPoints([t.a, t.b, t.c]) });
    }
    if (!faces.length) throw new Error('Empty collision surface'); this.tree = this.build(faces);
  }
  setFrames(previous: Matrix4, current: Matrix4) { this.previousInverse.copy(previous).invert(); this.inverse.copy(current).invert(); this.frame.copy(current); }
  reset() { this.hits = 0; }
  roofPoint() {
    const top = this.tree.bounds.max.y, center = new Vector3(); let weight = 0;
    const visit = (branch: Branch) => { if (branch.faces) for (const face of branch.faces) { if (face.bounds.max.y > top - 0.12 && Math.abs(face.normal.y) > 0.7) { const area = face.triangle.getArea(); center.addScaledVector(face.triangle.getMidpoint(new Vector3()), area); weight += area; } } else { visit(branch.left!); visit(branch.right!); } }; visit(this.tree);
    if (!weight) return this.tree.bounds.getCenter(center).setY(top); return center.multiplyScalar(1 / weight).setY(top);
  }
  private build(faces: Face[]): Branch {
    const bounds = new Box3(); faces.forEach(f => bounds.union(f.bounds));
    if (faces.length <= 8) return { bounds, faces };
    const size = bounds.getSize(new Vector3()), axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
    faces.sort((a, b) => a.bounds.min[axis] + a.bounds.max[axis] - b.bounds.min[axis] - b.bounds.max[axis]);
    const mid = Math.floor(faces.length / 2); return { bounds, left: this.build(faces.slice(0, mid)), right: this.build(faces.slice(mid)) };
  }
  project(p: Float64Array, previous: Float64Array, offset: number): PanelContact | undefined {
    if (!this.enabled()) return;
    const from = new Vector3().fromArray(previous, offset).applyMatrix4(this.previousInverse), to = new Vector3().fromArray(p, offset).applyMatrix4(this.inverse);
    const query = new Box3().setFromPoints([from, to]).expandByScalar(this.radius), candidates: Face[] = [];
    const visit = (branch: Branch) => { if (!query.intersectsBox(branch.bounds)) return; if (branch.faces) candidates.push(...branch.faces); else { visit(branch.left!); visit(branch.right!); } }; visit(this.tree);
    let first = Infinity, hit: Vector3 | undefined, normal: Vector3 | undefined;
    for (const { triangle, normal: n } of candidates) {
      const a = from.clone().sub(triangle.a).dot(n), b = to.clone().sub(triangle.a).dot(n), sign = a < 0 ? -1 : 1;
      if (sign * b < this.radius && sign * a > sign * b) {
        const time = Math.max(0, (sign * a - this.radius) / (sign * a - sign * b)), center = from.clone().lerp(to, time), surface = center.clone().addScaledVector(n, -center.clone().sub(triangle.a).dot(n));
        if (time >= 0 && time <= 1 && time < first && triangle.containsPoint(surface)) { first = time; normal = n.clone().multiplyScalar(sign); hit = to.clone().addScaledVector(normal, this.radius - sign * b); }
      }
      // Resting contact and triangle edges, including small pre-existing penetrations of the contact shell.
      const closest = triangle.closestPointToPoint(to, new Vector3()), delta = to.clone().sub(closest), distance = delta.length();
      if (distance < this.radius && first === Infinity) { normal = distance > 1e-8 ? delta.multiplyScalar(1 / distance) : n.clone().multiplyScalar(sign); hit = closest.addScaledVector(normal, this.radius); }
    }
    if (!hit || !normal) return;
    const world = hit.applyMatrix4(this.frame), worldNormal = normal.transformDirection(this.frame);
    world.toArray(p, offset); this.hits++;
    return { point: world.toArray() as Triple, normal: worldNormal.toArray() as Triple, velocity: this.velocity(world).toArray() as Triple, restitution: 0.18, friction: 0.55, impulse: this.reaction };
  }
}
