# Verified status

This repository is an unfinished independent SLRR engine. Current work focuses on a shared world, resource loading, vehicle assembly, the script/native boundary, and physics. Multiplayer depends on that foundation. Runtime work currently targets original `.java` sources through [SLRR-JVM](../packages/slrr-jvm/README.md); TUFA `.class` execution is paused.

## Checks

| Check | Result for the tested installation |
|---|---|
| RPK | 147/147; complete table-of-contents traversal and validated payload bounds |
| TUFA | 2921/2921 files, 2993 classes; complete CONS/MTHD/TREE traversal |
| SCX | 3532 v3 + 2500 v4; one empty sample is correctly rejected |
| SDAT | 139/139 decode→encode round trips are byte-identical in memory |
| Vehicle v5 | 64 headers read; full Part-tree decoding is still incomplete |
| TUFA execution | Original `Object.equals(self/other/null)` leaf method runs |
| Java source methods | Seven original Part-related classes, ten synthetic test parts, 1000 in-memory round trips, rollback and cleanup |
| CFG world | Baiern stock assembly: 72 objects with suspension and engine parts; 33-object base assembly and typed mounts checked on four other cars |
| Part native bridge | Four descriptor-aware calls traverse the 33-object CFG assembly and verify back-references |
| Driving prototype | Input, drivetrain, suspension, contact, damage, and fixed-step rendering on Test Track; several behaviors remain approximate |
| Unit tests | 110 tests covering formats, assembly, physics, serialization, source runtime, and UI-related logic |
| Build | Strict TypeScript check and production Vite build |

Checks that use original game files require a local installation; committed fixtures are synthetic. Saves, EXEs, DLLs, and models are not included in the test data.

## Reproduce

```powershell
npm ci
npm test
npm run build
npm run verify:game
npm run verify:saves
npm run verify:vm
npm run verify:parts
npm run verify:world
npm run verify:gameplay
npm run verify:mounts
npm run verify:hood
npm run verify:crash
npm run verify:3d
npm run verify:components
npm run audit
```

Set `SLRR_GAME_ROOT` to use another installation. For a different binary or source revision, record its hash, rerun the parsers, and compare the API. File dates and PE timestamps alone do not establish provenance.

## Limits of these results

Parsing binary structures does not establish full VM compatibility, complete physics, or exact rendering. A thousand codec cycles do not prove the absence of leaks in the original EXE or a future game world. The reported save-to-disk failure has not been reproduced. SRVS is a new format, not a complete decoding of the original `Vehicle/Part.save` data or a network transport.

The external C++ reconstruction claims to boot original scripts, but it has not been built or run as part of this project. Its TREE/native heuristics are research leads, not verified behavior for this installation.

The [engine world](engine-world.md) and [limited Part source runtime](part-runtime.md) still use separate host models. There is no general TUFA VM or execution of all original constructors. The separate [hood test stand](hood-prototype.md) uses original SCX/CFG data with a new XPBD solver: no impact or 5 N·s leaves it intact, 65 N·s produces a lasting dent with intact mounts, and 650 N·s breaks all three stand mounts.

Integration with the [assembled car](car-crash-demo.md) preserves EngineWorld/PartHost topology and includes [contacts between detached panels and the body](body-contacts.md). [Vehicle3D](vehicle-3d.md) adds jumps, pitch/roll, deformable body panels, and moving mounts. The [stock Baiern assembly](original-mechanics.md) contains 72 objects, including suspension, brakes, stabilizers, and nested engine parts. Wheel and brake locations follow original `setSlotPos` calls; shock axes use `bonepos/linked` without car-specific offsets. Part condition affects support, damping, braking, and traction. At zero condition, the engine block and its children detach as one body; a failed strut remains attached but releases its wheel. The motion model, hinge geometry, load-bearing deformation, and physical-state snapshots are still approximations or incomplete.
