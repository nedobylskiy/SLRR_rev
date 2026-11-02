import { Vector3 } from 'three';

/** A critically damped chase rig with its own world-space velocity. */
export class InertialCamera {
  readonly velocity = new Vector3();
  private readonly springVelocity = new Vector3();
  private readonly springPosition = new Vector3();
  private readonly previousDesired = new Vector3();
  private readonly desired = new Vector3();
  private initialized = false;

  constructor(private readonly lagScale = 2 / 3) {
    if (!Number.isFinite(lagScale) || lagScale <= 0 || lagScale > 1) throw new Error('Invalid inertial camera lag scale');
  }

  reset() { this.initialized = false; this.velocity.set(0, 0, 0); this.springVelocity.set(0, 0, 0); }

  update(position: Vector3, target: Vector3, focus: Vector3, offset: Vector3, seconds: number, rate = 5, snap = false) {
    this.desired.copy(focus).add(offset);
    target.copy(focus);
    if (!this.initialized || snap) {
      this.previousDesired.copy(this.desired);
      this.velocity.set(0, 0, 0);
      this.springVelocity.set(0, 0, 0);
      // Adopt the current rendered view without changing the resting offset.
      this.springPosition.copy(position).sub(this.desired).multiplyScalar(1 / this.lagScale).add(this.desired);
      this.initialized = true;
    }
    if (snap) { position.copy(this.desired); this.springPosition.copy(this.desired); return; }
    if (seconds <= 0) return;

    // Exact spring integration for a target moving linearly between the two
    // rendered poses. Unlike Euler steps this stays stable across FPS dips.
    const decay = Math.exp(-rate * seconds);
    for (let axis = 0; axis < 3; axis++) {
      const start = this.previousDesired.getComponent(axis);
      const end = this.desired.getComponent(axis);
      const speed = (end - start) / seconds;
      const relativeSpeed = this.springVelocity.getComponent(axis) - speed;
      const displacement = this.springPosition.getComponent(axis) - start + 2 * speed / rate;
      const c = relativeSpeed + rate * displacement;
      this.springPosition.setComponent(axis, end + (displacement + c * seconds) * decay - 2 * speed / rate);
      const springSpeed = speed + (relativeSpeed - rate * c * seconds) * decay;
      this.springVelocity.setComponent(axis, springSpeed);
      this.velocity.setComponent(axis, speed + (springSpeed - speed) * this.lagScale);
    }
    // Shorten only the extra inertial separation, not the distance at rest.
    // Keep the spring state unscaled so this does not change its response time.
    position.lerpVectors(this.desired, this.springPosition, this.lagScale);
    this.previousDesired.copy(this.desired);
  }
}
