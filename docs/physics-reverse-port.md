# Physics recovered from sl-remastered

For subsequent upstream changes and suspension research, see the
[2026-11-05 audit](physics-upstream-audit-2026-11-05.md).

This branch adapts the recovered scalar calculations from
[nicolas-found42/sl-remastered, commit 7aa574d26098e288367a3707f0b7ac7bb892ebbe](https://github.com/nicolas-found42/sl-remastered/tree/7aa574d26098e288367a3707f0b7ac7bb892ebbe).
It continues to execute the installed game's Java source. The Java Block, DynoData,
Chassis and WheelRef instances supply the values; there are no car-name-specific curves.
The known 2005 physics interfaces are treated as compatible with later builds. Additional
native signatures remain separate capabilities.

## Implemented and connected

| Area | Recovered source | Host implementation |
| --- | --- | --- |
| Combustion cycle, valve flow, ignition, heat exchange, consumption, turbo pressure and mixture limits | `src/dyno_model.cpp`, FUN_004b68c0/004b69a0/004b6bf0 and newer 004f50e0/004f4640 | `src/engine/combustion-model.ts`; replaces the synthetic DynoData curve |
| Persistent Dyno state, independent primary/nitrous banks, retained bank on recalculation | `src/dyno_model.hpp/.cpp` | One CombustionModel per Java DynoData, transactional recalculation |
| Torque and watt-table interpolation, excluded final endpoint | `src/natives/car_part.cpp`, sampleDyno | DynoData.getTorque/getHP; the Java sampling methods deliberately ignore their nitrous argument as recovered |
| Engine table ownership | `src/car_variable_refresh.cpp`, bindAddedCarEngine | The installed Java Block's dynodata is projected into the driving world; Chassis has no persistent `engine` field |
| Load-dependent 11-coefficient curve and signed aligning curve | `src/wheel.cpp`, evaluateWheelCurve | `src/engine/native-vehicle-physics.ts` |
| Combined longitudinal/lateral slip and low-speed relaxation | `src/wheel.cpp`, updateWheelSlip/calculateTireSlipForce | Independent persistent slip per wheel, cleared on separation/reset; combined-slip force and angular predictor |
| Effective tire load and saturation | `src/wheel_tire_force.cpp`, tireEffectiveLoad | maxLoad, load smoothing, and native coefficient slots |
| Asymmetric spring/damper force, doubled projected velocity and rebound default | `src/physics_suspension.cpp` | Suspension3D uses Java rest/min/max length, force and bump/rebound damping |
| Wheel radius, toe/camber | WheelRef setters and Java setup | Used by Suspension3D physics and wheel poses |
| Clutch exchange between engine and driven-wheel inertia; predictive limiter | `src/car_engine.cpp` | Recovered arithmetic functions, connected through the host's SI adapter |
| Angular wheel braking without sign reversal, bearing resistance | `src/car_engine.cpp`, calculateWheelBrake | Java WheelRef brake values plus CFG brakepower/enginepower; thermal brake wear is not enabled |
| Engine heating, speed-dependent intact-radiator cooling | `src/car_runtime.cpp` | MechanicalSystem temperature and Java Chassis.setCooling; heat capacity uses Java engine_mass |
| Wear/tear setters | `src/natives/car_part.cpp`, part get/set wear/tear | Independent instance state; setTear no longer discards its argument |
| Mount discovery for original inventory code | `src/natives/car_part.cpp`, partInstallOk | Part.install_OK finds a free compatible mount, binds the output GameRef and returns the two slot IDs without installing |

The original SL2 tire model is selected for Java-generated powertrains. The playground
panel also offers Original SL2, tunable Pacejka and legacy modes. The B/C/D/E sliders
belong to the tunable approximation; Original SL2 uses the Java-written 17-value table.

## Native changes

- New: `Part.install_OK(GameRef,int,GameRef,int,Vector3)`.
- New: `Chassis.getTorque(float,float)`, `Chassis.setCooling(float,float,float)`, `Chassis.getNitro()`.
- New: `WheelRef.getBrake()`, `getHBrake()`, `setOppWheel(int)` (opposite-wheel identity is retained; custom linkage geometry is still pending).
- Fixed: `WheelRef.setLoadSmooth` writes index **14**, not 16. Indices 15/16 remain the stiffness load-correction numerator/denominator.
- Fixed: `WheelRef.setDamping(float)` uses 0.7 times bump damping for rebound; explicit two-value damping remains independent.
- Fixed: WheelRef defaults retain all recovered coefficients, including curvature -1 and the load defaults.
- Fixed: `Part.setTear/getTear` preserve per-instance values and saved state. This does not reconstruct a deformed mesh from a scalar.
- CFG: preserve `enginepower` and `brakepower` instead of dropping them as unknown commands.

These are engine-host native implementations. No changes to the source interpreter
package are required by this port.

## Boundary between recovered equations and the current host

The scalar kernels above follow the recovered grouping. Float32Array stores bound
combustion state to float32, but JavaScript intermediate arithmetic is double precision;
this is a numerical port, not an x87/SSE emulator. Native wheel-curve basic operations
use explicit float32 rounding where practical. The golden combustion witness therefore
uses a numerical tolerance, not bit equality.

The host still integrates rigid bodies and wheel angular motion in SI units. Its
engine inertia conversion (`0.28 + Java inertia * 0.01`), transmission inertia conversion
(`CFG enginepower[4] * 0.01`), clutch torque-capacity adapter and wheel inertia of 1.6
are host adaptations, not recovered stock constants. They are isolated in
MechanicalSystem/Suspension3D. The original low-speed launch-force multiplier is bypassed
when the executed engine has a native dyno curve. Complete drivetrain timestep/unit
qualification against the executable is still required before claiming driving parity.
Automatic shift policy, starter/idle stabilization, turbo spool audio/telemetry, and
surface classification retain existing host behavior. Suspension contacts still use
our terrain sampler, contact-force caps and bump-stop safety response.

The upstream repository also contains a multi-body contact/constraint solver, compound
inertia construction, part refresh/damage propagation, brake thermal failure and full
engine/clutch/transmission wear branches. Those depend on native body/prototype/contact
ownership which our current host does not represent identically. They have **not** been
replaced with no-op native methods or advertised as a completed solver replacement.
Our existing collision solver, XPBD panels, map collision and C++/WASM soft-body backend
remain active. Custom WheelRef arm/hub/instant-center linkage geometry is also not solved
by this port; upstream itself marks parts of that geometry as incomplete.

## Validation

- `npm test`: recovered curve/slip/load/damping/clutch/braking/thermal cases, Java native
  dispatch, CFG values, install_OK output binding, wear/tear isolation, and all existing tests.
- `npm run build`: TypeScript and production bundle.
- Published original-executable witness: default DynoData at 437 RPM gives 82.08735 Nm
  and 4781.287 W here, versus 82.08710 Nm and 4781.273 W in the upstream recorded witness.
  We did not execute the original binary oracle in this environment.
- Local installed-game probe: construct stock Baiern CoupeSport and Duhen through original
  Vehicle/addStockParts/forceUpdate, then read their installed Block dynodata into the host.
  Baiern: 36 rows, peak 206.28 Nm; Duhen: 33 rows, peak 159.71 Nm. An independent flat-terrain
  driving probe checks finite contact forces, engine speed and launch with those Java-selected
  parts. This is a smoke test, not an assertion of matching real-game acceleration.
