# Engine coupling against the original-game captures

The [November 5 capture corpus](../data/telemetry/original-game/2026-11-05/README.md)
contains five models, including turbo/naturally aspirated Einvagen comparisons
and manual high-gear launches. It supports fixing a shared clutch adapter defect;
it does not yet establish matching acceleration, tyre slip or native units.

## Defect and change

For Java-generated engines, MechanicalSystem applies the recovered primary-engine
torque multiplier of 2. Its old manual clutch capacity was limited to roughly
0.95–1.15 times instantaneous dyno torque. At full throttle this often made an
intact clutch unable to transmit engine torque even after a shift. Increasing
engine speed did not restore coupling: the capacity followed the same curve.
The automatic path had a separate curve-derived capacity with a similar risk.

Native-curve engines now use the recovered exchange directly, governed by
engagement, component health and both inertias. There is no additional SI
torque ceiling. An intermediate adapter interpreted installed `ClutchF=500`
as a 500-Nm ceiling; the SuperDuty/MC capture below disproved that adaptation
for high-torque engines. The recovered exchange does not use `ClutchF` as a
torque limit, and its native units remain unqualified. Curve-derived friction
remains only for engines without a native curve. No model-name rules or per-car
fitted coefficients were added.

Automatic clutch control limits engagement when exchange would pull a running
engine below 85% of idle. Manual clutch mode can still stall under load. This
idle guard is a host control policy, not a recovered native controller. Open and
closed clutch paths now use the same Java engine-inertia conversion, instead of
the open path falling back to the crank definition.

## Original-game observations

Capture 06 includes an Einvagen third-gear launch reported as stalled: recorded
RPM falls from about 6,558 to 281 within 0.604 seconds of the first sampled clutch
release. There is no explicit stalled-state channel. In second gear, the turbo
run falls to about 4,017 RPM and then stays near 4,400 during initial acceleration;
the naturally aspirated run falls to about 1,688 RPM before recovering. Thus a
high-RPM launch plateau is possible in the original; removing every plateau is
not the target. Wheel speed is missing, so these traces cannot uniquely assign
slip to clutch versus tyres. Launch pedal histories and wear also differ.

## Reproducible regression

`tests/telemetry-engine.test.ts` builds engines from archived metadata and sampled
dyno curves, then prescribes wheel speed as a brake dynamometer. Every model uses
second gear, a 2,000-RPM equivalent shaft and full throttle with manual clutch
control, irrespective of the capture's original transmission mode. This isolates
coupling from unmeasured road slope, mass and tyre slip. It is not a replay of
the recorded vehicle trajectory. The 500-RPM curve samples are test inputs only;
the running game continues to calculate its curves through Java/DynoData.

Engine RPM after two seconds on that fixed shaft, at a 240-Hz physics cadence:

| Captured configuration | Before | After |
| --- | ---: | ---: |
| Shimutshibu ST9 Challenge | 7,499 | 2,424 |
| Baiern CoupeSport 2.5 | 6,126 | 2,450 |
| Emer Nonus Street GT | 7,984 | 2,532 |
| Einvagen 110 GTK, naturally aspirated | 5,594 | 2,174 |
| Duhen SunStrip 1.5 DVC | 5,756 | 2,417 |
| Einvagen 110 GTK, turbo | 6,495 | 2,247 |

The residual loaded speed difference comes from the host's finite-inertia,
per-step exchange; exact clutch lock and timestep/unit qualification remain
unfinished. Tests also cover manual stalling on a held shaft, automatic idle
release, high-torque engines and zero transmitted torque with the clutch open.

Run with the repository's local `tsx`:

```powershell
node node_modules/tsx/dist/cli.mjs --test tests/telemetry-engine.test.ts
```

Set `SLRR_ENGINE_REPORT=1` to print the numerical dynamometer results. Further
fitting of inertia, drag, torque scaling and traction needs independent channels
or constrained tests; the present fix does not change their shared constants.

## SuperDuty high-torque regression

User capture `slrr-remaster-physics-2026-11-05T23-56-22-657Z.txt` contains
261 samples of Hauler_s_SuperDuty_Extra_750 / MC_block. Its sampled torque
peaks near 749 at 2500 RPM. With the intermediate 500-unit capacity adapter,
at t=10.1 s it records 6501 engine RPM against about 1062 RPM computed from
the driven wheels and fifth gear, at 63.5 km/h. All four tyre slips are around
0.013: this is drivetrain slip, not a high-speed tyre burnout.

The native-path SI capacity adapter has therefore been removed. Regression
coverage includes engines with 4x and 6x the sampled NA Einvagen torque, using
the same equations. These tests settle under a prescribed load rather than
running to the limiter. They are stress cases, not fitted SuperDuty parameters
or measurements of its original-game acceleration.

## Engine/wheel feedback stability

Removing the false torque cap exposed a second adapter error on cars such as
Furrano GT54: the exchange used `CFG enginepower[4] * 0.01`, while returned torque
was integrated using 1.6 kg m² per wheel. These independently chosen inertias
over-applied wheel angular impulse. A passive closed-loop regression with CFG
value 1000 reproduced energy increasing from 67061.99 J to 75891.42 J in one
step, without combustion. Prescribed-speed tests concealed that feedback.

Both sides now share `HOST_WHEEL_INERTIA`. For normalized drive shares `s_i`,
the shaft inertia is `1 / sum(s_i² / I_i)`: this is the effective inertia of the
weighted mean wheel speed actually used by the exchange. It gives 3.2 kg m²
for equal two-wheel drive and 6.4 for equal four-wheel drive. The SI host does
not currently simulate the native CFG transmission inertia as an additional
rotor, so that value cannot independently set its wheel impulse conversion.
This fixes the unit/inertia adapter rather than imposing an RPM clamp.

Tests now integrate returned torque back into wheel speeds, checking passive
energy decay and powered boundedness for RWD, AWD, asymmetric drive splits and
forward/reverse gears. The suspension integration test also exercises a native
high-torque engine with live wheels and chassis. The fixed-shaft table above
retains a finite per-step offset because its external dynamometer resets wheel
speed; it is not a measurement of residual slip in the closed free-wheel loop.

## Starter motor

A stopped engine cranks while gas exceeds 0.1. The explicit start-key edge also
requests up to two seconds of cranking. The starter supplies installed Java
`starter_torque` (or the transmission definition, with a 40-unit host fallback)
through the same flywheel and clutch exchange; it does not seed RPM or enable
combustion immediately. A closed manual clutch can therefore drive the wheels
on starter torque alone, including in reverse. The automatic path opens its
clutch while the engine is stopped.

Combustion catches at max(500 RPM, 65% of idle), using the existing host restart
threshold. Cranking requires an attached, functional engine assembly. Starter
unit conversion, catch threshold and key-request timeout remain host policies;
this change does not claim a native electrical/battery simulation. The existing
ignition sound begins on starter activation, and telemetry records
`starter_active` separately from `engine_running`.
