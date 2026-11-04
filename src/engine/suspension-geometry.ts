import type { CfgWheel } from '../formats/cfg';
import type { WheelRefState } from '../runtime/wheel-ref-native';

/** Native chassis anchor uses CFG spring base + travel, not the tuned spring length. */
export function suspensionAnchorLength(wheel: CfgWheel): number {
  const spring = wheel.spring ?? [0.29, 0.1, 0.05];
  return spring[0] + spring[1];
}

export function parkedSpringLength(wheel: WheelRefState, massOnWheel: number): number | undefined {
  if (!(wheel.force > 0 && wheel.restLength > 0)) return;
  const minimum = wheel.minLength > 0 ? wheel.minLength : 0;
  const maximum = wheel.maxLength > 0 ? wheel.maxLength : wheel.restLength;
  return Math.max(minimum, Math.min(maximum, wheel.restLength - massOnWheel * 9.81 / wheel.force));
}
