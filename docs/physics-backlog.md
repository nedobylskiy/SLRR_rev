# Physics behavior backlog

Branch: `physics-behaivor-improve`.
User-reported small bugs are recorded here until reproduced and prioritized.
Create a GitHub issue when an item needs its own discussion or implementation;
link it here to avoid duplicate tracking.

| ID | Status | Observation | Next check |
| --- | --- | --- | --- |
| PHY-001 | Confirmed UI ambiguity | Detached engine is labelled `stalled`, like an ordinary recoverable stall | Distinguish detached/missing/damaged powertrain in diagnostics; restart is already blocked by attachment health |
| PHY-002 | Experiment in progress | WheelRef arm/hub data does not drive the legacy suspension pose | Compare the optional hub geometry path on stock Duhen variants, then Baiern/Einvagen; retain unsupported-mode fallback |
| PHY-003 | Measurement planned | Drivetrain/shift behavior is not qualified against original-game runs | Capture model/engine/configuration and paired pre/post-shift RPM/speed using stock telemetry; qualify gear parameter encoding |
| PHY-004 | Research | Driving hardpoint currently depends on configured rest length | Separate chassis anchor, loaded spring length, hardware mount and rendered tyre centre before changing forces |
| PHY-005 | User reported; reproduction pending | After a frontal crash the engine is severely tilted/displaced, yet can still be started | Compare physical mount condition, engine parent chain and required-component health with the rendered pose; determine whether damage breaks functional connections or only moves their frames |
| SCENE-001 | User reported; reproduction pending | Entering Career after leaving Free Ride leaves a frozen city image or empty 3D view behind the garage interface | Trace track cleanup, pending map loads, scene selection and render-loop lifecycle across Free Ride → menu → Career |

## PHY-005 — displaced engine can restart

Reported 2026-11-05, screenshot `codex-clipboard-ea2ea279-4346-4398-8845-76a1a178c20f.png`.
The yellow car has extensive frontal deformation, a displaced front wheel and
a heavily tilted engine assembly. The user reports that restarting still works.
Exact car variant, component conditions and reproduction sequence are not yet
captured. Visual displacement alone does not establish physical detachment.

The current restart gate checks required-component attachment/condition, not
the visual angle of the engine. Investigate whether mount deformation preserves
a logically healthy parent chain despite a failed physical connection. Capture
mount state, relative engine/chassis transforms and starter eligibility together;
do not introduce an arbitrary engine-angle cutoff without behavioral evidence.

## SCENE-001 — Free Ride to Career leaves stale or empty 3D view

Reported 2026-11-05. Reproduction: enter Free Ride, leave it, then enter Career
in the same browser session. Expected: the career garage scene replaces the
Free Ride scene and continues rendering. Observed: the user reports a frozen
3D image; the garage interface overlays the old city/car in one screenshot and
an empty dark 3D background in another. Screenshots:
`codex-clipboard-9ab06e9d-789a-4e2f-92fc-e0c5a3451443.png` and
`codex-clipboard-b0028a79-a347-43b0-9949-ac12d6d1d8ff.png`.

The screenshots establish a scene/interface mismatch, not whether the render
loop itself stopped. Capture console errors, active Java state/map, pending map
load and cleanup state, and frame-counter progression during this transition.
Check stale asynchronous Free Ride work against Career scene initialization.
No cause or fix has been confirmed. Track this as a scene lifecycle issue,
separately from suspension and drivetrain behavior.

For each new report record: map, car/engine, transmission mode, reproduction,
expected/observed behavior and attachment/log reference. Keep unconfirmed reports
marked as such. Do not treat this list as permission to mix unrelated fixes into
the current experiment.
