import type { JavaValue } from 'slrr-jvm';
import { drivingBrakeAxes, type DrivingInput } from '../engine/driving-demo';
import type { GameTypeNative } from './game-type-native';

/** Below this speed (m/s) the car has come to rest and the finish brake lets go. */
export const JAVA_BRAKE_RELEASE_SPEED = 0.5;

/** The original vehicle command "brake". City's race-finish handlers send it to
 * the player's car when it crosses the line (night and street races). The car
 * brakes to a halt: throttle is cut and the service brake held until it stops
 * (or until Java sends "start"). A street race sends no later "start", so the
 * brake cannot be a permanent lock. */
export class JavaCarBrake {
  private braking = false;
  private readonly unsubscribe: (() => void)[];

  constructor(gameTypes: Pick<GameTypeNative, 'onCommand' | 'getResource'>, car: JavaValue) {
    const node = gameTypes.getResource(car);
    const mine = (receiver: JavaValue) => !!node && gameTypes.getResource(receiver) === node;
    this.unsubscribe = [
      gameTypes.onCommand('brake', receiver => { if (mine(receiver)) this.braking = true; }),
      gameTypes.onCommand('start', receiver => { if (mine(receiver)) this.braking = false; }),
    ];
  }

  get active(): boolean { return this.braking; }

  apply(input: DrivingInput, speed: number): DrivingInput {
    if (!this.braking) return input;
    if (speed < JAVA_BRAKE_RELEASE_SPEED) { this.braking = false; return input; }
    return { ...input, throttle: 0, ...drivingBrakeAxes(1, input.handbrakeAxis ?? 0) };
  }

  dispose(): void { for (const stop of this.unsubscribe) stop(); }
}
