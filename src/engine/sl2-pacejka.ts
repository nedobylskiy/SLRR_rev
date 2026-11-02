/**
 * The tyre-force leaf function recovered from SL2 build 606 (FUN_0043bb30).
 *
 * This is a readable double-precision reference, not an x87/float32 replay.
 * The running car still uses tire-model.ts until build 940 and the surrounding
 * slip/contact code have been checked independently.
 */
export type Sl2PacejkaCoefficients = readonly [
  shape: number,
  loadPeakSlope: number,
  peakOffset: number,
  loadStiffnessSlope: number,
  stiffnessOffset: number,
  stiffnessDecay: number,
  curvatureQuadratic: number,
  curvatureLinear: number,
  curvatureOffset: number,
  loadShift: number,
  shiftOffset: number,
];

/** Fz is wheel normal load; slip uses the native caller's convention. */
export function sl2PacejkaForce(
  coefficients: Sl2PacejkaCoefficients,
  slip: number,
  normalLoad: number,
  clampNegative = false,
): number {
  const p = coefficients;
  const peak = normalLoad * p[1] + p[2];
  const denominator = peak * p[0];
  if (denominator === 0) return 0;

  const stiffness = (normalLoad * p[3] + p[4]) * Math.exp(-normalLoad * p[5]) / denominator;
  const x = (normalLoad * p[9] + p[10] + slip) * stiffness;
  const curvature = normalLoad * normalLoad * p[6] + normalLoad * p[7] + p[8];
  const force = peak * normalLoad * Math.sin(
    p[0] * Math.atan(curvature * (Math.atan(x) - x) + x),
  );
  return clampNegative ? Math.max(0, force) : force;
}
