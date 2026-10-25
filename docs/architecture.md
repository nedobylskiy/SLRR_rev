# Architecture of the new engine

## Implemented

TypeScript + Vite + Three.js/WebGL application 2. Pure binary parsers are DOM independent and are used by the browser and Node CLI. The local server serves only allowed resource types, is bound to 127.0.0.1 and checks the real path after symlink resolution. It does not write to the game and does not produce EXE/DLL. The static build works with a user-selected folder, without a local API.

|Module|Responsibility|
|---|---|
| `src/binary.ts` |Reading LE with Bounds Control|
| `src/formats/rpk.ts` |RPAK tables, text RDB/RSD|
| `src/formats/scx.ts` |Geometry SCX v3/v4|
| `src/formats/tufa.ts` |TUFA, typed CONS, methods, TREE|
| `src/formats/sdat.ts` |SDAT envelope, embedded blobs, Vehicle header|
| `src/formats/cfg.ts` |CFG subset, slots, stockpart, body/wheel, unknown commands|
| `src/engine/world.ts` |Resource factory, world instances, slot tree, matrices, lifecycle|
| `src/engine/part-host.ts` |Four Part native for bypassing the real CFG world through script handles|
| `src/engine/slot-frames.ts` |Typed mounting position: root, steering, wheel|
| `src/engine/driving-demo.ts` |Controllable flat kinematic model, same in browser and Node|
| `src/engine/rigid-body-3d.ts` |Center of mass, quaternion, world angular momentum, contact impulses and OBB SAT|
| `src/engine/suspension-3d.ts` |Four ray-mounts on CFG wheel/spring, springs, dampers and contact control|
| `src/engine/vehicle-3d.ts` |Actual 3D scene: suspension, volumetric panels, hard headlights and real separation of parts|
| `src/assets.ts` |VFS, path normalization, pack-local resource graph|
| `src/render/viewer.ts` |GPU geometry, camera, textures, object release|
| `src/runtime/tree-machine.ts` |Verified minimal leaf subset of TREE|
| `src/runtime/native-registry.ts` |Descriptor-aware native calls, runDLL contract|
| `src/runtime/memory-file.ts` |Primitive stream in memory|
| `src/runtime/java-source.ts` |Limited interpreter of selected Java methods|
| `src/runtime/part-assembly.ts` |Host Part/save/load and in-memory transactional recovery|
| `src/runtime/vehicle-state.ts` |Verifiable SRVS snapshot codec|
| `src/runtime/fixed-clock.ts` |Fixed step with explicit backlog|
| `tools/` |Reproducible research and hull testing|

The [first CFG world](engine-world.md) appeared with a rendering of the assembly. Snapshot codec, native registry and [Part source runtime](part-runtime.md) still require integration with it. Physics and general script launch are missing.

## Target structure - design solution

Resource data → world model → simulation → snapshots. Renderer subscribes to world state, but is not the owner of gameplay. The same simulation should be run in Node without a camera and WebGL for server tests.

The VM receives the host API via NativeRegistry. The key is class+method+descriptor. An unknown native function ends the call with a diagnostic rather than returning a successful null. As the API is implemented, maintain coverage: missing, stub, tested, compatible. You cannot replace the coverage table with the number of registered empty functions.

The ResourceManager must separate immutable assets, mutable instances and transient-generated textures. A stable ResourceKey stores the full normalized package path and local ID; manifest stores hashes of packages, scripts, CFGs and geometry. Boot order should not affect network identity.

World model stores the machine as a tree of installed parts with explicit IDs and slot connections. Life cycle: allocated → configured → attached → active → removed. The physical body, VM-instance and render proxy have an explicit owner. When dispose, not only JS links are released, but also GPU/physics/audio resources.

For rendering, Three.js remains a replaceable backend. First the original geometry/UV/material slots are rendered, then normal/reflection/layers/paint are added. Exact appearance should not slow down the checking of the semantics of scripts and the state of the car.

## Full physics - not yet implemented

The main requirement is deformable parts and destructible fasteners. [The prototype of the original hood](hood-prototype.md) is already testing permanent deformation, separation of three supports and falling to the floor through its own XPBD frame. Stand remains a separate mode; The connection with the machine assembly is described below. There is no general automotive solver yet. [Audit of the found reverse and project direction](deformable-physics.md). The assumption that the original SLRR used node-beam has not yet been confirmed.

A separate [CarCrashDemo](car-crash-demo.md) links this solver to the installed EnginePart: moving targets come from the hood matrix, contact with an obstacle deforms the nodes, the last broken support calls EngineWorld.detach. The free hood has separate nodes/speeds and updates its own world pose. [TriangleSurface](body-contacts.md) gives contacts to the original triangles of the assembled body via BVH. The impulses of the hood are transmitted to the car, and the impact of the chassis on an obstacle produces a rebound and a yaw moment. The basic ride remains a bicycle model with flat contact dynamics; There is no full 3D dynamics/suspension and no single car solver.

The current scene uses [Vehicle3D](vehicle-3d.md), which expands on this foundation: 6 degrees of freedom chassis, CFG suspension, 13 deformable shells and rigid detachable lights/glass. Here the motor and steering wheel act by the contact forces of the wheels; the flat bicycle model no longer moves the body. The previous CarCrashDemo remains a regression implementation. The suspension and materials are new, with explicitly stated assumptions; There is no complete original solver/native drivetrain and a unified structural solution for all the details yet.

`DeformedFrame` carries CFG mounts and wheel hardpoints along with the parent frame; The geometry of the supports influences the tire forces and trajectory. `EnginePart.condition` stores state 0..1; zero allows separation of parts, and wheel misalignment is activated below 10% of the support state. [OEM Struts, Springs, Shocks, Brakes and Engine](original-mechanics.md) are now installed from the original Java lists and affect this model. `loadPartCollision` loads the original physical SCX from the CFG body, excluding nocollision, for free part contacts. Condition and physical frameworks have not yet been combined with source-runtime persistence.

There is a [test ride](mounts-and-driving.md) with flat bicycle kinematics and animation of instances; This is not a crash/suspension solver and not a rendition of the original drivetrain. Full native physics and game logic remain the next stages.

Before choosing a backend, you need units, axes, a description of the suspension/tyre/engine API and tests. WASM-backend possible; TypeScript will continue to own the rules of the game. Intrinsic physics do not guarantee the old behavior will match. The initial criterion is a controllable car with reproducible native getters/setters, then a comparison of braking/acceleration/suspension.

## Script execution

The closest way is TREE reference interpreter with tracing and fail-closed behavior. First calls and fields, then arrays and flow control, class initialization and GC, then File/Part.save/load. After that, lowering in JS/WASM is considered for the sake of speed. Errors are visible with class, method, source and op.

Processing `.java` is a separate compiler frontend with specific resource literal syntax and integer truthiness. Direct `javac` is not a compatible solution. Third party JVM capability requires TUFA/source adapter and native library; it does not cancel work on the host API.

## Windows DLL boundary

WebGL works in the browser; the browser cannot load arbitrary Win32 DLLs. Portable mods require a JS/WASM representation of their functions. For Windows extensions, a desktop host with an explicit list of exports and a specific ABI is possible. It remains an optional backend; the server and pure browser should not depend on 32-bit EXE pointers.

`LegacyDllBridge` currently only supports registered synchronous JS capability functions with the same string contract. There is no independent Win32 FFI backend.
