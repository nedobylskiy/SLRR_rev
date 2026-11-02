import { Vector3 } from 'three';

/** A critically damped chase rig with its own world-space velocity. */
export class InertialCamera {
  readonly velocity = new Vector3();
  private readonly previousDesired = new Vector3();
  private readonly desired = new Vector3();
  private initialized = false;

  reset() { this.initialized = false; this.velocity.set(0, 0, 0); }

  update(position: Vector3, target: Vector3, focus: Vector3, offset: Vector3, seconds: number, rate = 5, snap = false) {
    this.desired.copy(focus).add(offset);
    target.copy(focus);
    if (!this.initialized || snap) {
      this.previousDesired.copy(this.desired);
      this.velocity.set(0, 0, 0);
      this.initialized = true;
    }
    if (snap) { position.copy(this.desired); return; }
    if (seconds <= 0) return;

    // Exact spring integration for a target moving linearly between the two
    // rendered poses. Unlike Euler steps this stays stable across FPS dips.
    const decay = Math.exp(-rate * seconds);
    for (let axis = 0; axis < 3; axis++) {
      const start = this.previousDesired.getComponent(axis);
      const end = this.desired.getComponent(axis);
      const speed = (end - start) / seconds;
      const relativeSpeed = this.velocity.getComponent(axis) - speed;
      const displacement = position.getComponent(axis) - start + 2 * speed / rate;
      const c = relativeSpeed + rate * displacement;
      position.setComponent(axis, end + (displacement + c * seconds) * decay - 2 * speed / rate);
      this.velocity.setComponent(axis, speed + (relativeSpeed - rate * c * seconds) * decay);
    }
    this.previousDesired.copy(this.desired);
  }
}
