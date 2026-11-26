# Rigs of Rods physics architecture comparison

Source inspection: 2026-11-16. Upstream revision: `ebf31a2187bbc31a38331a86b233dfa7e60c52fb` (2026-11-01). Local comparison: SLRR revision `b28831a`.

This is a source audit, not a measured RoR/SLRR benchmark. RoR was not built or profiled; its FPS on equivalent hardware/content is not established here. No simulation code was changed for this audit.

## Findings

### 1. RoR does more frequent, simpler beam steps

[`SimConstants.h:20`](https://github.com/RigsOfRods/rigs-of-rods/blob/ebf31a2187bbc31a38331a86b233dfa7e60c52fb/source/main/physics/SimConstants.h#L20) defines `PHYSICS_DT = 0.0005f`: 2000 Hz.

[`ActorForcesEuler.cpp:1210`](https://github.com/RigsOfRods/rigs-of-rods/blob/ebf31a2187bbc31a38331a86b233dfa7e60c52fb/source/main/physics/ActorForcesEuler.cpp#L1210) loops over enabled beams once per step. It computes extension and axial relative velocity, then `slen = -k * extension - d * velocity` (line 1317). Plastic deformation changes the beam rest length after a stress threshold; forces are accumulated on its endpoint nodes (1463–1464). `CalcNodes` (1602 onward) integrates velocity from forces, then position from velocity: a semi-implicit Euler update.

Our solver uses 120 Hz with 12 XPBD constraint iterations. With 4750 beams in the example car, activating all panels means about 6.84 million beam constraint visits/second, before mounts and contacts. RoR would visit the same number of beams about 9.5 million times/second. These are different numerical methods and are not equal-cost/equal-accuracy operations. The comparison does establish that a few hundred nodes do not inherently justify tens of milliseconds per car. Switching to Euler at 120 Hz would not reproduce RoR's stability.

### 2. Contact geometry belongs to the physical structure

[`ActorSpawner.cpp:1427`](https://github.com/RigsOfRods/rigs-of-rods/blob/ebf31a2187bbc31a38331a86b233dfa7e60c52fb/source/main/physics/ActorSpawner.cpp#L1427) constructs cab triangles from three physical node indices and selects contact-enabled cabs separately. [`DynamicCollisions.cpp:118`](https://github.com/RigsOfRods/rigs-of-rods/blob/ebf31a2187bbc31a38331a86b233dfa7e60c52fb/source/main/physics/collision/DynamicCollisions.cpp#L118) tests these triangles against physical nodes. Contact forces are distributed to the triangle's three nodes using barycentric weights (98–114).

Our `Vehicle3D.updateSurface` (`src/engine/vehicle-3d.ts:322`) skins detailed part triangles from panel control nodes and refits their collision BVH. That physical-to-visual-to-contact path makes the cost of collision maintenance depend on render mesh detail. It also invalidates cached surface queries when geometry is refitted (`triangle-surface.ts:75,105`). RoR's node/cab contacts do not require this visual mesh round trip.

**Most relevant change:** maintain a dedicated deformable collision shell driven directly by physical nodes. Use it for panel-to-car contacts and reaction forces; keep detailed SCX geometry for rendering. Construct and validate an outer shell (including seams, thickness and openings), rather than indiscriminately using every internal lattice face. Changing the shell must preserve high-speed impacts and avoid new penetration gaps.

### 3. Broad phase and contact selection precede expensive work

[`PointColDetector.cpp:50`](https://github.com/RigsOfRods/rigs-of-rods/blob/ebf31a2187bbc31a38331a86b233dfa7e60c52fb/source/main/physics/collision/PointColDetector.cpp#L50) first selects actors whose bounding boxes overlap. It inserts only nodes with applicable contacter/contactable flags into its point structure, reuses partner structures when membership is unchanged, and queries a KD-tree with expanded triangle bounds (126 onward).

`ResolveInterActorCollisions` also keeps per-triangle retry counters. Triangles without useful nearby contact candidates can skip subsequent steps; a confirmed collision resets the counter. Importantly, `UpdateInterPoint` resets counters when relative node-0 speed exceeds 4 m/s (squared difference >16), so this shortcut is not an unconditional high-speed contact throttle.

Our panel `surfaces()` loop (`deformable-panel.ts:313–335`) calls each surface for every panel node four times per step. The surfaces already have BVHs/query caches: this is not a brute-force all-triangle test. However, candidate selection is still inside repeated JavaScript node queries. A persistent candidate manifold and explicit exterior-node selection could reduce that work. RoR's exact retry constants should not be copied into our 120 Hz solver: 12 skipped RoR steps are only 6 ms.

### 4. One physical world clock, separate from presentation

[`ActorManager.cpp:1130`](https://github.com/RigsOfRods/rigs-of-rods/blob/ebf31a2187bbc31a38331a86b233dfa7e60c52fb/source/main/physics/ActorManager.cpp#L1130) derives whole fixed steps and preserves the remainder. `UpdatePhysicsSimulation` (1248 onward) runs all actors' force updates, inter-actor beams and inter-actor contacts inside each common substep. Actor force work and collision work use thread-pool phases with synchronization.

Our full rival path (`src/render/viewer.ts:2114`) advances an individual car and then checks vehicle-pair contact once per render callback. Separate vehicle clocks and a render-rate pair check are not equivalent to the shared-clock stand (`vehicle-pair-test.ts`). This can change overlap correction and impact timing as FPS falls, independently of the softbody solver's speed.

**Required structural fix:** a shared world step for player and full-physics rivals, with pair detection/response at a defined point on every substep. Account for each pair once. Do not solve one car's complete frame before beginning the other's.

### 5. Physics and visual deformation can run outside rendering

`ActorManager` creates a dedicated simulation worker; [`UpdateActors scheduling:1224`](https://github.com/RigsOfRods/rigs-of-rods/blob/ebf31a2187bbc31a38331a86b233dfa7e60c52fb/source/main/physics/ActorManager.cpp#L1224) submits the simulation task and waits immediately only when asynchronous physics is disabled. The next synchronization still waits for unfinished work: this is overlap, not unlimited background capacity.

[`GfxScene.cpp:295`](https://github.com/RigsOfRods/rigs-of-rods/blob/ebf31a2187bbc31a38331a86b233dfa7e60c52fb/source/main/gfx/GfxScene.cpp#L295) buffers simulation data for graphics. [`GfxActor.cpp:3181`](https://github.com/RigsOfRods/rigs-of-rods/blob/ebf31a2187bbc31a38331a86b233dfa7e60c52fb/source/main/gfx/GfxActor.cpp#L3181) schedules flexbody deformation on background tasks; `FinishFlexbodyTasks` joins and uploads vertex buffers. Its visibility check here uses flexbody visibility/camera mode; this is not proof of a general frustum-based physics shutdown.

Our WASM backend already shares node arrays with JavaScript, so this is not a claim that all positions are copied every iteration. But beam/mount upload and multiple solve/contact calls still straddle JS/WASM, and triangle surface queries remain in JS. Move the complete step, including candidate contacts and plasticity, behind one batched native interface with persistent topology. Then move the world simulation to a worker and publish buffered render snapshots. A worker frees the render thread; it does not make a 30 ms step fit inside an 8.33 ms physics budget by itself.

### 6. Compiled data loops and sleeping support the architecture

`Actor.h:365,383` stores node and beam arrays; `beam_t` holds endpoint pointers. These are contiguous arrays of structs, not a demonstrated structure-of-arrays/SIMD design. The beam loop uses relative coordinates and `fast_invSqrt`, but those details alone do not explain total performance.

[`ActorManager.cpp:840`](https://github.com/RigsOfRods/rigs-of-rods/blob/ebf31a2187bbc31a38331a86b233dfa7e60c52fb/source/main/physics/ActorManager.cpp#L840) sleeps eligible actors after 10 seconds below its speed threshold, keeps the player active, and recursively wakes nearby potentially interacting actors. Thus its ordinary driven-car performance cannot be explained by sleeping every undamaged panel. Our existing per-panel sleep remains useful; reducing wake duration is not a substitute for reducing active-step cost.

## Recommended implementation order

1. Add a dedicated physical contact shell and remove render-triangle skinning/BVH refitting from panel-to-car contact maintenance. Keep a comparison switch during validation.
2. Unify player/rival stepping and pair contacts under a shared world clock, matching the stand's scheduling principle.
3. Keep physical topology, candidates, constraints and contact response in persistent WASM buffers; batch a complete substep rather than only the constraint loop. Preserve current plastic deformation behavior first.
4. Run that physical world in a worker; publish transforms/deformation snapshots independently of rendering. Keep detached pieces rigid as required by this project.
5. Optimize candidate refresh and repeated quiet contacts based on measured counts. Consider a different beam integrator only as a separate controlled experiment.

Validation should use the existing 60 m / approximately 82 km/h two-car impact, both in the stand and city, plus glancing contact, detached pieces, sustained contact and a deliberate render FPS cap. Record constraint/contact/BVH costs, simulated time per real second, penetration and final dents. Report both average and peak step cost. Do not trade away deformation or collision correctness to obtain a lower timer.


## Implementation update, 2026-11-17

The original whole-world worker recommendation above is superseded by the user requirement to keep driving/chassis physics synchronous. The RoR normal-beam kernel has been ported into C++/WASM with a scalar reference; see [current implementation](vehicle-physics-worker.md). The old whole-car worker is an explicit offline test mode, not the browser default. Equivalent-hardware RoR FPS has still not been measured, and this port does not establish a city FPS claim.
