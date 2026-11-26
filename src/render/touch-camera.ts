/** Two-finger camera gesture on the game canvas: moving both fingers orbits
 * the chase camera, pinching zooms it. One finger does nothing, so taps and
 * the on-screen wheel and lever (separate elements) are unaffected. */
export interface CameraGestureDelta {
  /** Radians to add to the orbit yaw and pitch. */
  yaw: number;
  pitch: number;
  /** Multiplier for the camera distance: below 1 moves closer. */
  zoom: number;
  /** Midpoint travel in pixels, for consumers that orbit through mouse axes. */
  dx: number;
  dy: number;
}

/** Radians per pixel of finger travel. */
export const ORBIT_PER_PIXEL = 0.008;
export const MIN_ZOOM = 0.6;
export const MAX_ZOOM = 2.5;

export function clampZoom(value: number): number {
  return Number.isFinite(value) ? Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value)) : 1;
}

type Point = { x: number; y: number };

export class TwoFingerCamera {
  private readonly points = new Map<number, Point>();

  get active(): boolean { return this.points.size >= 2; }
  get fingers(): number { return this.points.size; }

  down(id: number, x: number, y: number): void {
    this.points.set(id, { x, y });
  }

  up(id: number): void {
    this.points.delete(id);
  }

  clear(): void {
    this.points.clear();
  }

  /** A finger moved: returns the camera change, or undefined unless exactly two fingers are down. */
  move(id: number, x: number, y: number): CameraGestureDelta | undefined {
    const point = this.points.get(id);
    if (!point) return undefined;
    const pair = this.points.size === 2 ? [...this.points.values()] : undefined;
    const before = pair && measure(pair[0], pair[1]);
    point.x = x; point.y = y;
    if (!pair || !before) return undefined;
    const after = measure(pair[0], pair[1]);
    const dx = after.mid.x - before.mid.x, dy = after.mid.y - before.mid.y;
    return {
      dx, dy,
      // Same directions as the right-mouse-button orbit in the viewer.
      yaw: dx * ORBIT_PER_PIXEL,
      pitch: -dy * ORBIT_PER_PIXEL,
      // Fingers apart (spread) brings the camera closer.
      zoom: before.span > 1 && after.span > 1 ? before.span / after.span : 1,
    };
  }
}

function measure(a: Point, b: Point): { mid: Point; span: number } {
  return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, span: Math.hypot(a.x - b.x, a.y - b.y) };
}
