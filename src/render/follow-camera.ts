import { Vector3 } from 'three';

/** Follow translation exactly; damp only the view offset relative to the car. */
export class FollowCamera {
  private readonly previousFocus = new Vector3();
  private readonly desired = new Vector3();
  private readonly translation = new Vector3();
  private initialized = false;

  reset() { this.initialized = false; }

  update(position: Vector3, target: Vector3, focus: Vector3, offset: Vector3, seconds: number, rate: number, snap = false) {
    this.desired.copy(focus).add(offset);
    if (!this.initialized || snap) position.copy(this.desired);
    else {
      // Physics may advance fewer ticks than elapsed wall time during a slow
      // frame. Use its actual displacement, not velocity * render delta.
      this.translation.copy(focus).sub(this.previousFocus);
      position.add(this.translation).lerp(this.desired, 1 - Math.exp(-seconds * rate));
    }
    target.copy(focus);
    this.previousFocus.copy(focus);
    this.initialized = true;
  }
}
