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
