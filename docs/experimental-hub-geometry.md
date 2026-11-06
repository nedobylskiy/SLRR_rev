# Experimental hub and arm geometry

Enable **Graphics / map debug → Suspension alignment → Experimental hub geometry**.
It defaults off, is reported by Copy graphics report, and can be toggled while
parked or driving. Supported corners use the experimental pose; other corners
retain the previous pose. Turning it off restores the previous path on the next
parked update or driving sync.

The pure `solveHubGeometry` kernel independently reimplements the numerical
arm-circle and hub `0`/`-1` geometry described in the
[upstream audit](physics-upstream-audit-2026-11-05.md). It normalizes the hinge
and strut directions, closes supported strut attachments and returns distinct
arm/hub matrices. Hardware mount/mate transforms are applied once. Wheel spin
does not reach the arm frame, and linked single-anchor arms can follow that
frame independently of the hub. Existing per-corner calibration offsets remain
additional adjustments; the loaded solve replaces the fallback global height.

Inputs include live WheelRef position, orientation, arm and hub values and the
CFG spring base/travel. No model-specific placement constants were added.
Positive hub-length modes, zero arm radius, degenerate data and opposite-wheel
coupling return unsupported. Severely damaged driving mounts use the old pose.
This experiment does **not** replace forces, contacts, inertia or the driving
hardpoint calculation. A visible wheel/contact mismatch must be measured rather
than hidden with a new force offset.

## Checks and observations

- Numerical tests: hinge coordinate/radius, mirrored travel, lower/upper strut
  closure, invalid inputs, repeatability, authored mount transforms, independent
  arm versus wheel rotation, and disabled/unsupported paths.
- Headless original-Java assembly probe: Duhen 1.5 DVC (`cars/racers/duhen.rpk:6`)
  and 1.8 DVC (`:294`) resolve both front hub-0 corners. Their rear raw arm radius
  is zero, so both rear corners correctly retain the old pose. Repeated settling
  does not accumulate transforms.
- On the sampled 1.8 assembly, front rim attachment X moved from roughly
  `±0.722 m` to `±0.630 m` with the current retained calibration. These are
  **attachment origins**, not tyre mesh centres or a claim of matching native
  track width. They differ from the other host's published observations, so
  visual/original-executable qualification is still required.
- The installed Steam EXE differs from the binary cited by that geometry
  research. No original-binary pose oracle or original-game pixel comparison
  was executed here.

For review: hide the body, compare neutral and both steering directions, observe
spring/arm endpoints during travel, and toggle the experiment without changing
other settings. Record the car variant and offsets with any screenshot. Keep
the flag off when collecting baseline drivetrain measurements.
