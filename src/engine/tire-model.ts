/** Tunable, steady-state Magic Formula approximation for the contact patch. */
import type { WheelRefState } from '../runtime/wheel-ref-native';
export interface MagicFormulaAxis { B: number; C: number; D: number; E: number }
export interface TireModelSettings {
  model: 'legacy' | 'pacejka';
  longitudinal: MagicFormulaAxis;
  lateral: MagicFormulaAxis;
}

export const DEFAULT_TIRE_MODEL: TireModelSettings = {
  model: 'pacejka',
  longitudinal: { B: 30, C: 1, D: 0.83, E: 0.97 },
  lateral: { B: 30, C: 1.2, D: 1.2, E: 0.5 },
};

export function magicFormula(slip: number, { B, C, D, E }: MagicFormulaAxis): number {
  const bx = B * slip;
  return D * Math.sin(C * Math.atan(bx - E * (bx - Math.atan(bx))));
}

/** Current Baiern 205/55 R17 sport tyre is the calibrated reference. */
const STOCK_TYRE = { friction: 1.76863, stiffness: 17.6839, sliction: 0.814 };
export function tireForces(normalLoad: number, alignment: number, slipSpeed: number, lateralSpeed: number, longitudinalSpeed: number, wheelSpeed: number, settings: TireModelSettings, original?: WheelRefState) {
  if (settings.model === 'legacy') {
    const limit = normalLoad * Math.max(0, alignment);
    const slide = Math.min(1, Math.hypot(slipSpeed, lateralSpeed) / 3);
    const longitudinalLimit = limit * 1.05 * (1 - 0.28 * slide);
    const lateralLimit = limit * 1.2 * (1 - 0.08 * Math.min(1, Math.abs(slipSpeed) / 3));
    const lateral = Math.max(-lateralLimit, Math.min(lateralLimit, -lateralSpeed * 4200));
    const lateralUse = lateralLimit > 0 ? lateral / lateralLimit : 0;
    const availableLongitudinal = longitudinalLimit * Math.sqrt(Math.max(0, 1 - lateralUse * lateralUse));
    return { longitudinal: Math.max(-availableLongitudinal, Math.min(availableLongitudinal, slipSpeed * 3400)), lateral };
  }

  // The speed floor keeps slip finite at launch and while stationary. A single-load
  // Magic Formula gives each pure-slip curve; the friction ellipse approximates
  // their simultaneous use without claiming the original SL2 coefficients.
  const referenceSpeed = Math.max(2, Math.abs(longitudinalSpeed), Math.abs(wheelSpeed));
  const kappa = slipSpeed / referenceSpeed;
  const alpha = Math.atan2(lateralSpeed, Math.max(2, Math.abs(longitudinalSpeed)));
  const load = Math.max(0, normalLoad * alignment);
  // WheelRef's indexed values belong to SL2's native solver, not to the four
  // coefficients of this Magic Formula. Apply their relative physical effects.
  const grip = original ? Math.max(0.2, Math.min(2.5, original.friction / STOCK_TYRE.friction)) : 1;
  const stiffness = original ? Math.max(0.4, Math.min(2.5, original.stiffness / STOCK_TYRE.stiffness)) : 1;
  const loadRatio = original && original.maxLoad > 0 ? Math.min(1, original.maxLoad / Math.max(original.maxLoad, normalLoad)) : 1;
  const slideRatio = original ? Math.max(0.3, Math.min(1.5, original.sliction / STOCK_TYRE.sliction)) : 1;
  const slide = Math.min(1, Math.hypot(kappa, alpha) * 2);
  const effectiveGrip = grip * loadRatio * (1 + (slideRatio - 1) * slide);
  const lateralAxis = { ...settings.lateral, B: settings.lateral.B * stiffness, D: settings.lateral.D * effectiveGrip };
  const longitudinalAxis = { ...settings.longitudinal, B: settings.longitudinal.B * stiffness, D: settings.longitudinal.D * effectiveGrip * (original?.frictionX ?? 1) };
  const lateralCurve = -load * magicFormula(alpha, lateralAxis);
  const lateral = Math.sign(lateralCurve) * Math.min(Math.abs(lateralCurve), Math.abs(lateralSpeed) * 4200);
  const lateralPeak = load * lateralAxis.D;
  const lateralUse = lateralPeak > 0 ? Math.min(1, Math.abs(lateral) / lateralPeak) : 0;
  const longitudinalCurve = load * magicFormula(kappa, longitudinalAxis) * Math.sqrt(Math.max(0, 1 - lateralUse * lateralUse));
  const longitudinal = Math.sign(longitudinalCurve) * Math.min(Math.abs(longitudinalCurve), Math.abs(slipSpeed) * 3400);
  return { longitudinal, lateral };
}
