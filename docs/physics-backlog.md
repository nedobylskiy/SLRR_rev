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

For each new report record: map, car/engine, transmission mode, reproduction,
expected/observed behavior and attachment/log reference. Keep unconfirmed reports
marked as such. Do not treat this list as permission to mix unrelated fixes into
the current experiment.
