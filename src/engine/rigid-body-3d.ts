import { Box3, Matrix4, Quaternion, Vector3 } from 'three';

/** Six degrees of freedom. Position is centre of mass; angular momentum is stored in world space. */
export class RigidBody3D {
  readonly position = new Vector3(); readonly orientation = new Quaternion();
  readonly velocity = new Vector3(); readonly momentum = new Vector3();
  private force = new Vector3(); private torque = new Vector3();
  private inverseInertia = new Vector3();
  constructor(public mass: number, readonly bounds: Box3, readonly center = bounds.getCenter(new Vector3())) { this.setMass(mass); }
  setMass(mass: number) {
    if (!Number.isFinite(mass) || mass <= 0) throw new Error('Invalid rigid mass'); this.mass = mass;
    const s = this.bounds.getSize(new Vector3()); this.inverseInertia.set(12 / (mass * (s.y * s.y + s.z * s.z)), 12 / (mass * (s.x * s.x + s.z * s.z)), 12 / (mass * (s.x * s.x + s.y * s.y)));
  }
  inverseWorld(v: Vector3) { return v.clone().applyQuaternion(this.orientation.clone().invert()).multiply(this.inverseInertia).applyQuaternion(this.orientation); }
  get omega() { return this.inverseWorld(this.momentum); }
  setAngularVelocity(v: Vector3) { this.momentum.copy(v).applyQuaternion(this.orientation.clone().invert()); this.momentum.set(this.momentum.x / this.inverseInertia.x, this.momentum.y / this.inverseInertia.y, this.momentum.z / this.inverseInertia.z).applyQuaternion(this.orientation); }
  pointVelocity(point: Vector3) { return this.velocity.clone().add(new Vector3().crossVectors(this.omega, point.clone().sub(this.position))); }
  matrix() { return new Matrix4().compose(this.position, this.orientation, new Vector3(1, 1, 1)).multiply(new Matrix4().makeTranslation(-this.center.x, -this.center.y, -this.center.z)); }
  setFrame(frame: Matrix4) { frame.decompose(new Vector3(), this.orientation, new Vector3()); this.position.copy(this.center).applyMatrix4(frame); this.velocity.set(0, 0, 0); this.momentum.set(0, 0, 0); this.force.set(0, 0, 0); this.torque.set(0, 0, 0); }
  addForce(force: Vector3, point = this.position) { this.force.add(force); this.torque.add(new Vector3().crossVectors(point.clone().sub(this.position), force)); }
  impulse(j: Vector3, point = this.position) { this.velocity.addScaledVector(j, 1 / this.mass); this.momentum.add(new Vector3().crossVectors(point.clone().sub(this.position), j)); }
  integrate(dt: number) {
    this.velocity.addScaledVector(this.force, dt / this.mass); this.velocity.y -= 9.81 * dt;
    this.momentum.addScaledVector(this.torque, dt).multiplyScalar(Math.exp(-0.08 * dt));
    this.position.addScaledVector(this.velocity, dt);
    const omega = this.omega, angle = omega.length() * dt;
    if (angle > 1e-12) this.orientation.premultiply(new Quaternion().setFromAxisAngle(omega.normalize(), angle)).normalize();
    this.force.set(0, 0, 0); this.torque.set(0, 0, 0);
    if (![...this.position.toArray(), ...this.velocity.toArray(), ...this.orientation.toArray()].every(Number.isFinite)) throw new Error('Non-finite rigid state');
  }
  contact(point: Vector3, normal: Vector3, depth: number, restitution = 0.18, friction = 0.6) {
    const r = point.clone().sub(this.position), v = this.pointVelocity(point), vn = v.dot(normal);
    this.position.addScaledVector(normal, Math.max(0, depth - 0.001) * 0.6);
    let magnitude = 0;
    if (vn < 0) {
      const cross = new Vector3().crossVectors(r, normal), denominator = 1 / this.mass + normal.dot(new Vector3().crossVectors(this.inverseWorld(cross), r));
      magnitude = -(1 + (vn < -0.8 ? restitution : 0)) * vn / denominator;
      this.impulse(normal.clone().multiplyScalar(magnitude), point);
      const tangent = v.addScaledVector(normal, -vn), speed = tangent.length();
      if (speed > 1e-8) {
        tangent.multiplyScalar(1 / speed); const rt = new Vector3().crossVectors(r, tangent);
        const jt = Math.min(friction * magnitude, speed / (1 / this.mass + tangent.dot(new Vector3().crossVectors(this.inverseWorld(rt), r))));
        this.impulse(tangent.multiplyScalar(-jt), point);
      }
    }
    return normal.clone().multiplyScalar(magnitude);
  }
  corners() {
    const result: Vector3[] = [], m = this.matrix();
    for (const x of [this.bounds.min.x, this.bounds.max.x]) for (const y of [this.bounds.min.y, this.bounds.max.y]) for (const z of [this.bounds.min.z, this.bounds.max.z]) result.push(new Vector3(x, y, z).applyMatrix4(m));
    return result;
  }
}

/** OBB / static AABB SAT including all cross axes; returns the minimum translation and contact patch centre. */
export function boxContact(body: RigidBody3D, obstacle: Box3) {
  const vertices = body.corners(), center = obstacle.getCenter(new Vector3()), size = obstacle.getSize(new Vector3()).multiplyScalar(0.5);
  const local = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].map(v => v.applyQuaternion(body.orientation));
  const world = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)], axes = [...world, ...local];
  for (const a of local) for (const b of world) { const c = new Vector3().crossVectors(a, b); if (c.lengthSq() > 1e-10) axes.push(c.normalize()); }
  let depth = Infinity, normal = new Vector3();
  for (const axis of axes) {
    const projections = vertices.map(p => p.dot(axis)), min = Math.min(...projections), max = Math.max(...projections), c = center.dot(axis), extent = Math.abs(axis.x) * size.x + Math.abs(axis.y) * size.y + Math.abs(axis.z) * size.z;
    if (max < c - extent || min > c + extent) return;
    const positive = c + extent - min, negative = max - (c - extent), d = Math.min(positive, negative);
    if (d < depth) { depth = d; normal.copy(axis).multiplyScalar(positive < negative ? 1 : -1); }
  }
  const minimum = Math.min(...vertices.map(p => p.dot(normal))), support = vertices.filter(p => p.dot(normal) < minimum + 1e-5), point = support.reduce((a, b) => a.add(b), new Vector3()).multiplyScalar(1 / support.length).clamp(obstacle.min, obstacle.max);
  return { normal, depth, point };
}
