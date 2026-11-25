import type { DrivingInput } from '../engine/driving-demo';

/** Set by Vite `define` when building with SLRR_TOUCH=1 (see vite.config.ts). */
declare const __SLRR_TOUCH__: boolean | undefined;

/** Wheel rotation for full steering lock, in degrees either way. */
export const WHEEL_LOCK_DEGREES = 150;
/** Lever travel near the centre that counts as neither throttle nor brake. */
export const LEVER_DEAD_ZONE = 0.06;

/** Experimental on-screen driving controls: on in a SLRR_TOUCH=1 build, and
 * forced on or off at runtime with `?touch=1` / `?touch=0`. */
export function touchControlsEnabled(search = globalThis.location?.search ?? '',
  built = typeof __SLRR_TOUCH__ !== 'undefined' && __SLRR_TOUCH__): boolean {
  const flag = new URLSearchParams(search).get('touch');
  if (flag === '1' || flag === 'true' || flag === 'on') return true;
  if (flag === '0' || flag === 'false' || flag === 'off') return false;
  return built;
}

/** Wheel angle (degrees, clockwise positive) to the game's steer axis, where +1 is left. */
export function wheelSteer(angle: number): number {
  return Math.max(-1, Math.min(1, -angle / WHEEL_LOCK_DEGREES));
}

/** Lever deflection (-1 fully back .. +1 fully forward) to throttle and brake, each 0..1. */
export function leverAxes(deflection: number): { throttle: number; brake: number } {
  const d = Math.max(-1, Math.min(1, deflection));
  const amount = Math.max(0, Math.abs(d) - LEVER_DEAD_ZONE) / (1 - LEVER_DEAD_ZONE);
  return d >= 0 ? { throttle: amount, brake: 0 } : { throttle: 0, brake: amount };
}

/** Released wheel: exponential return (time constant 90 ms) with a 300°/s floor. */
export function wheelReturn(angle: number, seconds: number): number {
  const step = Math.max(300 * seconds, Math.abs(angle) * (1 - Math.exp(-seconds / .09)));
  return Math.abs(angle) <= step ? 0 : angle - Math.sign(angle) * step;
}

/** Shortest signed difference between two angles in degrees. */
export function angleDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

export interface TouchDrivingState { steer: number; throttle: number; brake: number; steering: boolean }

/** Touch axes join the keyboard/controller input: the wheel replaces steering
 * while held (or still returning), the lever adds to the pedals. */
export function mergeTouchInput(input: DrivingInput, touch: TouchDrivingState): DrivingInput {
  const steering = touch.steering || Math.abs(touch.steer) > 1e-3;
  const brake = Math.max(input.serviceBrakeAxis ?? input.brakeAxis ?? (input.brake ? 1 : 0), touch.brake);
  return {
    ...input,
    ...(steering ? { steer: touch.steer, steerDigital: false } : {}),
    throttle: Math.max(input.throttle, touch.throttle),
    brake: brake > .2, brakeAxis: brake, serviceBrakeAxis: brake,
  };
}

/** Keep a finger on its widget even when it slides off; a pointer that cannot be
 * captured (already released, or synthetic) still drives the widget while over it. */
function capture(element: HTMLElement, pointerId: number): void {
  try { element.setPointerCapture(pointerId); } catch { /* See above. */ }
}

const WHEEL_SVG = `<svg viewBox="-100 -100 200 200" aria-hidden="true">
  <circle r="88" class="touch-wheel-rim"/><circle r="74" class="touch-wheel-rim-inner"/>
  <path class="touch-wheel-spoke" d="M-72 6 L-24 14 L-14 34 L14 34 L24 14 L72 6 L72 -6 L24 -12 L0 -18 L-24 -12 L-72 -6 Z"/>
  <path class="touch-wheel-spoke" d="M-12 30 L-8 74 L8 74 L12 30 Z"/>
  <circle r="20" class="touch-wheel-hub"/><rect x="-5" y="-92" width="10" height="16" rx="2" class="touch-wheel-mark"/>
</svg>`;

/** DOM overlay over the game viewport: a steering wheel (left) and a
 * spring-centred throttle/brake lever (right). Each widget follows its own
 * pointer, so both can be used at once with two fingers. */
export class TouchDrivingControls {
  readonly root = document.createElement('div');
  private angle = 0;
  private deflection = 0;
  private wheelPointer?: number;
  private leverPointer?: number;
  private lastPointerAngle = 0;
  private frame = 0;
  private lastFrame?: number;
  private readonly wheel: HTMLElement;
  private readonly wheelGraphic: HTMLElement;
  private readonly lever: HTMLElement;
  private readonly knob: HTMLElement;

  constructor(container: HTMLElement) {
    this.root.className = 'touch-driving';
    this.root.innerHTML = `<div class="touch-wheel" role="slider" aria-label="Steering wheel"><div class="touch-wheel-graphic">${WHEEL_SVG}</div></div>
      <div class="touch-lever" role="slider" aria-label="Throttle and brake"><span class="touch-lever-label gas">GAS</span>
      <div class="touch-lever-track"><div class="touch-lever-fill"></div><div class="touch-lever-knob"></div></div>
      <span class="touch-lever-label brake">BRAKE</span></div>`;
    this.wheel = this.root.querySelector('.touch-wheel')!;
    this.wheelGraphic = this.root.querySelector('.touch-wheel-graphic')!;
    this.lever = this.root.querySelector('.touch-lever-track')!;
    this.knob = this.root.querySelector('.touch-lever-knob')!;
    container.append(this.root);
    this.wheel.addEventListener('pointerdown', this.wheelDown);
    this.wheel.addEventListener('pointermove', this.wheelMove);
    this.lever.addEventListener('pointerdown', this.leverDown);
    this.lever.addEventListener('pointermove', this.leverMove);
    for (const element of [this.wheel, this.lever]) for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const)
      element.addEventListener(type, this.release);
    this.root.addEventListener('contextmenu', event => event.preventDefault());
    this.frame = requestAnimationFrame(this.animate);
    this.render();
  }

  get state(): TouchDrivingState {
    const { throttle, brake } = leverAxes(this.deflection);
    return { steer: wheelSteer(this.angle), throttle, brake, steering: this.wheelPointer !== undefined };
  }

  private pointerAngle(event: PointerEvent): number {
    const box = this.wheel.getBoundingClientRect();
    return Math.atan2(event.clientY - (box.top + box.height / 2), event.clientX - (box.left + box.width / 2)) * 180 / Math.PI;
  }

  private readonly wheelDown = (event: PointerEvent) => {
    if (this.wheelPointer !== undefined) return;
    event.preventDefault();
    this.wheelPointer = event.pointerId;
    capture(this.wheel, event.pointerId);
    this.lastPointerAngle = this.pointerAngle(event);
  };

  private readonly wheelMove = (event: PointerEvent) => {
    if (event.pointerId !== this.wheelPointer) return;
    const current = this.pointerAngle(event);
    this.angle = Math.max(-WHEEL_LOCK_DEGREES, Math.min(WHEEL_LOCK_DEGREES, this.angle + angleDelta(this.lastPointerAngle, current)));
    this.lastPointerAngle = current;
    this.render();
  };

  private leverDeflection(event: PointerEvent): number {
    const box = this.lever.getBoundingClientRect();
    return Math.max(-1, Math.min(1, ((box.top + box.height / 2) - event.clientY) / (box.height / 2)));
  }

  private readonly leverDown = (event: PointerEvent) => {
    if (this.leverPointer !== undefined) return;
    event.preventDefault();
    this.leverPointer = event.pointerId;
    capture(this.lever, event.pointerId);
    this.deflection = this.leverDeflection(event);
    this.render();
  };

  private readonly leverMove = (event: PointerEvent) => {
    if (event.pointerId !== this.leverPointer) return;
    this.deflection = this.leverDeflection(event);
    this.render();
  };

  private readonly release = (event: PointerEvent) => {
    if (event.pointerId === this.wheelPointer) this.wheelPointer = undefined;
    if (event.pointerId === this.leverPointer) { this.leverPointer = undefined; this.deflection = 0; this.render(); }
  };

  /** A released wheel springs back to centre, by elapsed time so that a low
   * frame rate does not slow it down. */
  private readonly animate = (now: number) => {
    const seconds = this.lastFrame === undefined ? 0 : Math.min(.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.wheelPointer === undefined && this.angle !== 0) {
      this.angle = wheelReturn(this.angle, seconds);
      this.render();
    }
    this.frame = requestAnimationFrame(this.animate);
  };

  private render(): void {
    this.wheelGraphic.style.transform = `rotate(${this.angle}deg)`;
    const { throttle, brake } = leverAxes(this.deflection);
    this.knob.style.top = `${50 - this.deflection * 50}%`;
    this.root.style.setProperty('--touch-throttle', String(throttle));
    this.root.style.setProperty('--touch-brake', String(brake));
    this.lever.classList.toggle('gas', throttle > 0);
    this.lever.classList.toggle('brake', brake > 0);
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.root.remove();
  }
}
