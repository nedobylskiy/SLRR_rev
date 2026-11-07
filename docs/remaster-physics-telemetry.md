# Recording remaster driving telemetry

In the Java garage, **Graphics / map debug → Replace car: Einvagen 110 GTK**
replaces the active car tree with a complete stock GTK for testing. It calls the
installed Java Vehicle constructor and garage placement, without calling car-lot,
purchase or save routines. The previous live car is removed after successful
placement. This is a debug replacement, not an additional inventory car.

Open **Vehicle runtime · physics / Java** during a physical driving session.
Click **Start physics recording**, drive the test, then click
**Stop & download telemetry**. Starting recording restores keyboard focus to the
driving canvas. The downloaded file is named `slrr-remaster-physics-<UTC>.txt`.
**Download last recording** downloads the last finished capture again.

Resetting/teleporting the car, leaving the driving scene, or reaching 18,000 samples
stops the recording. The UI attempts a download and retains the last export in
memory for another download. Recordings are not persisted across page reloads;
stop and download before closing the page. Starting another recording replaces
the current recorder buffer. There is a 30-minute simulation-time safety limit.

The recorder samples after fixed physics ticks every 100 ms of **simulation**
time. Pause adds no samples; slow motion takes longer in real time to collect
the same interval. Sample timestamps retain the actual physics time. Recording
is opt-in; while disabled, it does not collect or serialize per-wheel state.

## Fields

Metadata includes chassis resource identity, map pack, host mass in kg, idle and
limiter RPM, installed engine inertia/final drive/clutch parameters, gear ratios,
tyre solver/settings and experimental hub geometry. Engine metadata contains
block health and displacement; a sampled torque curve is captured at start.

Samples include RPM, gear, shift state, applied gas/brake/clutch/steer controls,
temperature, running/starter state, boost estimate, body position and local velocities,
yaw rate, and each wheel's angular speed, radius, longitudinal slip, slip speed,
lateral speed, contact, normal load, suspension length and steering angle.
Wheel indices follow Suspension3D's configured wheel order.

The file uses the original recorder's `SLRR_PHYSICS|v=2` short-field format with
`source=redline-rebuilt`. Compatibility field names such as `throttle_param0`
contain **applied host inputs**, not observations of the original native AI
channels. Brake/clutch are the booleans currently delivered to the host physics.
`speed_mps` is the world-space velocity magnitude, with signed forward/lateral
components supplied separately. `boost_host_bar` is the host's estimate, not a
measured original-game boost channel. `mass_kg` is not `mass_native_raw`.

The shared engine's `manual` flag identifies manual shifting; it does not
distinguish all three original transmission configurations. The initial mode is
metadata and changes are recorded per sample. Initial metadata/torque curves
are not refreshed when tuning or replacing parts during a recording: keep a
configuration fixed and start a new capture after edits.

## Export for comparison

The existing archived v2 exporter accepts both original and remaster files and
retains all additional fields in `samples.csv` and `summary.json`:

```powershell
node data/telemetry/original-game/2026-11-05/provenance/exporter/extract.mjs "C:/path/slrr-remaster-physics-capture.txt" .research/remaster-run
```

For useful comparison, use the same car configuration, track/start point,
transmission mode and launch procedure. Original captures omit wheel speeds,
so they still cannot uniquely separate clutch slip from tyre slip; the added
host channels explain which mechanism is active in the remaster.


## Per-frame CPU trace for collisions

Start physics recording also enables detailed CPU stage timings for every render callback, independently of Detailed GPU diagnostics. Stop & download telemetry writes the physics samples and CPU frames to the same `.txt`. The ordinary physics samples remain at 100 ms simulation intervals. Additional lines have the prefix `SLRR_FRAME|v=1|` followed by a flat JSON object. The archived SLRR_PHYSICS v2 exporter ignores this separate prefix and remains compatible.

A CPU frame records simulation-relative time, wall time since recording started, RAF timestamp/delta, physics tick count and pending debt, active panel/node steps, beam constraint iterations, collision-surface updates (with separate `collision_bvh_builds` and `collision_bvh_refits` counts), loose/sleeping panel counts and actual TS/WASM panel counts. Millisecond stages include:

- `constraints_ms`: XPBD beam and anchor constraints. During recording WASM calls separate constraints and contact exports in the same numerical order; normal unprofiled simulation retains the combined call.
- `panel_contacts_ms`: terrain sampling, ground/AABB constraints, JS triangle/guard queries and contact response of active panels. Native contact callbacks are included here rather than in constraints.
- `wasm_upload_ms`: input collider/beam/mount packing; this is not all JS/WASM synchronization.
- `integration_finalize_ms`: prediction, release, plasticity and velocity finalization, including mount/beam state reads in the wrapper.
- `loose_contacts_ms` and `chassis_contacts_ms`: loose rigid-panel contact probes and chassis contact handling respectively. Loose rigid hardware also appears in the broader Physics other total.
- `body_collision_geometry_ms`: collision skin/refit work. `cpu_vehicle_render_geometry_cpu_ms` covers visual panel skinning/normals, and `cpu_vehicle_world_sync_cpu_ms` covers the surrounding scene synchronization.
- CPU profiler sections, including simulation+visuals, renderer, GPU-occlusion submission and the complete render callback. These are nested totals and must not be added to their inner stages.

Detailed timers run only while recording; recording and timing have their own overhead. TS/WASM regression tests check that profiled and unprofiled state follows the same trajectory. Frequency remains 240 Hz, with 12 XPBD iterations. GPU query results resolve asynchronously and are intentionally excluded from the CPU frame snapshot.

The RAF interval precedes the work in its row. A long interval can reflect work in the **previous** callback, browser scheduling, or both: inspect the previous row as well as the current row. The converter retains that pairing. Paused frames do not repeat old physics timings, and tab hiding breaks the interval sequence so a background pause is not labelled a collision stall.

Capture is bounded to 36,000 CPU frames as well as the existing physics sample limit; reaching either stops recording. A short collision recording should include several seconds before impact and 5–10 seconds afterward. No extra download button is required.

Convert CPU frames to CSV and a summary with the worst intervals and their preceding callbacks:

```powershell
npx tsx tools/report-physics-frames.ts "C:/path/slrr-remaster-physics-capture.txt"
```

This writes `.frames.csv` and `.frames-summary.json` beside the input file. An optional second argument supplies the output prefix. Files recorded before frame_cpu_v1 have no per-frame CPU data.

Incremental geometry counters: `collision_triangles_updated` counts regenerated/refitted faces, `collision_parts_updated` counts changed part ranges (including removals), and `collision_vertices_skinned` counts collision skinning calls. They exclude unchanged cached geometry and are separate from rendered triangle counts.

On the physics-frequency experiment branch, verify `physics_hz=120` / `physics_dt_s=0.008333333333333333` in new captures. The experiment keeps 12 XPBD iterations and 60 Hz collision geometry updates; metadata records these explicitly.
