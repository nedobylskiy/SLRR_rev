# Roadmap and acceptance criteria

## 0. Base - partially achieved

- Reading original RPK, TUFA, SCX v3/v4, SDAT; reports and body check - ready.
- WebGL display of individual models and the transition RPK→mesh - implemented, needs to expand the visual verification of materials.
- The first original method Object.equals is executed; general runtime is not ready.
- Buffer serialization of a new car model - implemented; there is no capture/restore of the living world.

## 1. Engine world - current priority

Plan for the first controlled car and check existing native contracts: [game functionality](gameplay.md). Part ↔ CFG-world bridge started: getSlots/getSlotID/partOnSlot/slotIDOnSlot work on existing instances.

First complete the RPK/CFG factory, suspension/bone/compound frames, single lifecycle of instances and VM, then collisions and physics. Explicit compatibility of slots and wheel/steering wheel frames work on five machines; Baiern is collected from 33 objects without missing stockpart. There is a [test ride](mounts-and-driving.md) with simplified kinematics. Detailed criteria: [engine world](engine-world.md). Multiplayer and expansion of the separate serialization demo have been delayed to a working basis.

## Vehicle state in memory - saved subsystem

The limited Java source runtime already executes selected original Part.save/load via MemoryFile with transactional recovery, 1000 retries and rollback. This is a synthetic build; TUFA of these methods and capture of the CFG world have not yet been implemented. [Details](part-runtime.md).

Determine Part/Chassis host model, stable IDs and ownership. Restore sufficient TREE/File semantics to call the original Part.save/load on MemoryFile or implement versioned adapters with tests for each class. Save RPK-remount and transient paint data. Do not route network baseline through File.open on disk.

Ready: real assembled new world machine → buffer → new independent machine; parts/slots/conditions/damage/painting match; the old machine does not change until a successful commit; error rollback releases everything allocated. 1000 repetitions with real native resources do not increase the counters/heap.

## 2. TUFA VM and native API

Fields and calls by descriptor, inheritance/static initialization, arrays, branching, arithmetic, native adapter. Check with small sources and classes, do not transfer heuristic hacks of external reconstruction. Execution in Worker with limits, errors with source info.

Ready: initial part constructors and their save/load are executed; the list of missing natives is reproduced; unknown op is not skipped. Then minimal GameLogic/garage loading. The `.java` compiler is a standalone task, including resource literals and int truthiness.

## 3. World resources and car assembly

CFG slot/attach, transforms, render/texture overrides, collision shapes and native lifecycle. Full RPK hierarchy, embedded map chunks, map with spawn and camera.

Readiness: assemble the car from the chassis and parts according to standard configs, disassemble/assemble without lost objects; load one real trace with a collision. An empty external SCX card is not considered a successful boot.

## 4. Physics and gameplay

The priority has been clarified: first [deformation and breakable fastenings of one part](deformable-physics.md), then the overall dynamics of the body/suspension. The choice of backend should take this requirement into account; the usual monolithic rigid body of a car is not the target architecture.

The first [stand of the original hood](hood-prototype.md) is implemented: plasticity, reaction/rupture of supports, nodal contact with the floor. The next integration mode is described below; snapshots of the physical state and strength between parts are yet to be realized.

[Hood on assembled car](car-crash-demo.md) gets in contact with an obstacle and is disconnected via EngineWorld.detach; PartHost sees the topology change. [Vehicle3D](vehicle-3d.md) already adds vertical dynamics, pitch/roll, four spring supports, remaining body panels and hard headlights. Next - clarification of the semantics of the spring/tire API, structural deformation of the load-bearing chassis and wheel supports, full fastening reactions and physical snapshots.

Select backend after calibrating units. Reproduce native tire/suspension/engine/gearbox interfaces; minimal input and driving loop; then garage/catalog/repair/tuning/career. A server run without rendering must use the same world model.

Ready: controlled car, baseline saves the configured car; acceleration/braking/suspension/damage tests; the original scripts do not require hidden stubs.

## 5. Network race

Authoritative server, content handshake, inputs, dynamics, late join/reconnect, baseline revision and resync. After correctness - compact binary deltas and optimization.

Readiness: two independent client sessions and a server, identical machine assembly with different load order, movement with correction, damage and replacement of parts, stable reconnect. The serializer in the unit test is not considered multiplayer.

## Research blockers

The exact leak point in the old EXE has not been determined. Examined EXE without PDB. The intended complete original source has not been received from the community. The embedded map geometry/physics and animation formats are not supported. The full semantics of TREE and native API have not been restored. These are ongoing unfinished works, and not grounds to present the project as a finished game.
