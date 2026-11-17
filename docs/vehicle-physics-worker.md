# Shared vehicle physics and RoR beam kernel

Current implementation: 2026-11-17, `codex/local-panel-contacts`.

## Scheduling

The production `VehiclePhysicsClient` defaults to a synchronous main-thread `VehiclePhysicsWorld`. The first vehicle submission advances all registered cars on one fixed clock before their render geometry updates. Chassis, suspension, drivetrain, world/pair collisions and controls do not wait for a worker snapshot. Later submissions in the same render frame cannot integrate the world twice. The optional whole-car worker remains only for explicit offline comparisons/tests; the browser does not instantiate it.

A panel-only worker is **not implemented** in this change. Native panel computation currently runs synchronously too. This avoids claiming that a renderer at 60 FPS establishes that asynchronous simulation keeps up.

Every fixed substep resolves each unordered full-car pair once, then advances all full cars. Backlog is retained. The lightweight traffic system remains separate.

## Deformation kernel

Production Vehicle3D defaults to the ported RoR normal-beam force law, plastic rest-length yield and semi-implicit node integration. The C++/WASM call includes accumulated forces, integration, CFG mount loads, ground and cached contact planes. Exact mesh sweeps occur before/after that call. The scalar TypeScript implementation is the fallback/reference. XPBD remains selectable in offline comparisons and standalone labs.

This is **not the complete RoR vehicle engine**. Our rigid chassis, suspension, attachments and scene collision pipeline remain. RoR attribution/revision and GPL-3.0-only license are included in THIRD_PARTY_NOTICES.md and native/soft-body/ror/COPYING.

The maximum internal step is 0.5 ms; a node-degree/mass/stiffness stability bound can require shorter steps. Mount stiffness is independent of this adaptive step. Plastic stress relief is proportional to the actual rest-length adjustment; this avoids a discontinuity from damping-only yield. Attached cages use 12/s relative velocity damping to settle small vibrations without damping chassis motion. Integration uses actor-relative coordinates. Touching rubber supports use a tolerance and return a contact on both sides of floating-point rounding.

Physical cage sizes are 70 nodes for the hood, 70 for the chassis, 18 for other deformable body parts. The complete render meshes are retained and skinned from these cages. Light-panel stiffness scales with part mass below 15 kg so lightweight trim does not inherit a door's nodal frequency. These are SLRR adapter material/mesh choices, not RoR rig defaults. Detached parts use the existing rigid-body path and do not continue soft-body solving.

Diagnostics count actual beam passes, rather than reporting 12 XPBD iterations for RoR. Telemetry identifies the selected solver and maximum RoR step. Render regression tests check actual vertex movement, not merely changed beam rest lengths.

## Contact geometry and rendering

CFG body SCX files and box/sphere primitives supply collision geometry; nocollision bodies are excluded. A missing referenced physical SCX is an asset error. Parts without body declarations use bounds boxes. The clean 2.2.1 Baiern check has 51 parts, 1260 selected contact triangles and 18436 render triangles.

PanelView owns live draw matrices and invalidates cached skins on shape revisions, including a deform/sleep transition completed between updates. Generic Java scene synchronization and saved-damage restoration must not overwrite those matrices or vertices.

The city impact launcher now awaits existing Java initialization before opening its world; opening the world previously invalidated the in-progress boot sequence.

## Verification

```powershell
node --import tsx --import ./tools/enable-soft-body-wasm.ts --test tests/vehicle-3d.test.ts tests/vehicle-pair-test.test.ts tests/triangle-surface.test.ts
npm test
npm run build
$env:SLRR_GAME_ROOT='C:/Users/jhony/Documents/Street Legal Racing - Redline221'
npx tsx tools/verify-vehicle-worker.ts --main
npx tsx tools/verify-vehicle-worker.ts --main --xpbd
```

`--main` measures a real two-car 86 km/h impact with the main-thread world and original Baiern assets, including separate panel/kernel/contact/skin timings. It excludes the browser city/render loop. Legacy invocation without `--main` measures the whole-car worker and serialization too, so those results must not be presented as production panel computation cost. The check rejects unbounded/NaN geometry and requires a visible non-rigid deformation greater than 2 cm. City FPS and browser interaction still require runtime verification.


Observed local Node check (three simulated seconds, two fixed steps per 60 Hz batch, recording/profiling enabled): RoR panel solve mean 1.6–1.8 ms, p95 2.6–3.1 ms; beam kernel mean 1.3 ms, p95 2.0–2.3 ms. Whole two-car world mean 4.8–4.9 ms with occasional 19–20 ms batches. Maximum measured panel solve varied 6.4–10.9 ms, mostly outside the beam kernel. Visible non-rigid mesh change was about 0.303 m at 86.1 km/h. Earlier dense RoR cages averaged 6.9 ms in panel solving. This improvement includes cage/material changes, not just a solver substitution; it is not an equivalent city/trash-bin/browser benchmark. Offline XPBD reference averaged about 2.2 ms for panels and 4.2 ms for the world, with p95 panel time about 6.3 ms in the observed run. The overall world is not uniformly faster than that reference, and residual contact/geometry peaks remain.


## Panel balance update

RoR body-panel yield strain is 4% instead of 11%; hood yield is 4% instead of 8%. Elastic beam stiffness is raised 2x on ordinary panels, 1.3x on the hood and 1.2x on the chassis (chassis yield 1.6%). Mount strengths rise 1.6x on ordinary panels and 1.25x on the hood. Ordinary mount overload uses the mean transmitted nodal force over each outer step and requires 40 ms, with overload credit decaying under lower load. Immediate failure needs a peak exceeding three times strength and a mean load above half strength; isolated microstep chatter no longer suffices.

Regressions cover local door/bumper/quarter-panel dents with intact mounts and internal vibration below 0.03 m/s after 0.5 s, a 15 km/h bumper collision with plastic damage and retained attachment, and severe hood release at 70 km/h with the stronger mounts. The 50 km/h hood case can now retain a crushed panel, as intended. In the updated original-asset two-car check at 86.6 km/h, average panel time was about 1.9 ms (p95 4.2 ms), whole world about 4.1 ms (p95 9.0 ms), and non-rigid rendered change about 0.36 m. These remain Node stand measurements, not city FPS.
