# Recorded collision: frame-level CPU profile

Source: `slrr-remaster-physics-2026-11-07T17-58-18-874Z.txt`, with the graphics report exported at 2026-11-07T17:58:29.582Z. Parsed 648 CPU frames, zero rejected rows, about 15.89 wall seconds / 15.83 simulation seconds. RAF interval p50 16.7 ms, p95 49.9 ms, maximum 150.5 ms. This capture does not itself contain a measured 333–500 ms interval corresponding to 2–3 FPS.

## Matched callback evidence

All times below are CPU milliseconds in the same callback. The RAF delta before that callback is not its execution time.

| CPU frame | Simulation time | Physics ticks | Panel steps | Geometry updates | XPBD constraints | Panel contacts | Body collision geometry | Render callback |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 542 | 11.733 s | 8 | 0 | 0 | 0 | 0 | 0 | 17.2 |
| 543 | 11.750 s | 4 | 44 | 2 | 6.5 | 13.4 | 70.4 | 119.0 |
| 544 | 11.883 s | 32 | 352 | 9 | 25.0 | 35.8 | 35.4 | 138.0 |
| 545 | 12.033 s | 36 | 396 | 9 | 35.4 | 27.8 | 13.0 | 130.9 |
| 546 | 12.167 s | 32 | 352 | 8 | 30.0 | 24.5 | 12.2 | 105.0 |

Frame 543 is the first large collision-related callback in this sequence: its preceding RAF delta is only 16.9 ms, and it runs four physics ticks, so catch-up cannot explain the initial geometry spike. Subsequent callbacks run 32–36 ticks and 8–9 geometry updates to catch up elapsed time. All 44/352/396 panel steps correspond to eleven active panels per physics tick. The initial geometry work is followed by genuine catch-up amplification; the numerical solver and contacts become expensive in aggregate once many ticks run in one render callback.

WASM input upload costs 0.5 / 1.7 / 1.6 ms in frames 543–545. Visual panel geometry costs 1.8 / 1.5 / 2.2 ms; main render submission costs 8.2 / 8.1 / 9.9 ms. These do not dominate the collision callbacks. The CPU record proves the geometry-stage spike; attributing all 70.4 ms exclusively to BVH construction would overstate the timer's scope, since skinning and allocation/GC can also occur inside it.

Across this capture: constraints 531.9 ms; panel contacts 361.8 ms; WASM input upload 29.0 ms; integration/finalize 63.7 ms; loose-body contacts 277.4 ms; body collision geometry 451.4 ms; visual panel geometry 148.5 ms. Broad simulation and callback totals include these stages and must not be added to them.

## Stable collision triangle slots

Previously `Vehicle3D.updateSurface` removed disconnected parts' triangles and changed a topology string. That created a new TriangleSurface and recursively sorted a new BVH when a part detached. Even the first update could reconstruct an already initialized surface.

Keep per-part triangle ranges and the full coordinate count stable instead. Disconnected parts occupy degenerate inactive slots; refit excludes inactive faces from bounds and contacts. Reuse the initialized BVH whenever the coordinate count matches. Actual registration/count changes still construct a tree. Reset/reattachment can restore faces. The former mutable topology string is unnecessary. This keeps physical geometry exclusion while removing repeated constructor/sort/allocation work on ordinary detachments.

New frame counters `collision_bvh_builds` and `collision_bvh_refits` distinguish tree construction from bounds updates in subsequent recordings. The original `body_refits` field continues to count all collision geometry updates for compatibility.

## Validation and limits

Regression tests verify that disconnected triangle slots cannot produce cached contacts, inactive faces leave the tree bounds, active contacts remain valid, restored slots become collidable, and detaching registered geometry preserves the surface/tree object. Existing deformation, release, sleeping, contact and TS/WASM tests also run.

`npx tsx tools/benchmark-collision-surface.ts` measures 15 synthetic detachments of a 12,800-triangle surface, median of five warmed runs: reconstructing trees 404.78 ms total; stable slots/refit 29.16 ms total, about 13.9x for that isolated operation. Both paths include preparing their coordinate arrays. This is not a rerun of the recorded city's car, a claim about all geometry work, or a demonstrated whole-frame/FPS improvement. No fixed-step frequency, XPBD iteration count, collision cadence or catch-up time is dropped.

Next check: repeat a comparable crash with the new build/refit counters and compare the initial geometry callback plus the following catch-up sequence. Remaining costs include regular skin/refit work, contact queries and many simultaneous active panels. The recorded capture remains useful for comparison, but exact deterministic replay of solver/contact warm-start state is not provided by the telemetry.

Validation after the stable-slot change: production build passes, all 487 standard tests pass, and all 52 explicit WASM tests pass. Real-drive frame-time improvement still needs a new capture.
