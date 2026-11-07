# Collision CPU investigation — 2026-11-07

Inputs: `slrr-remaster-physics-2026-11-07T17-18-17-849Z.txt` and graphics report exported at `2026-11-07T17:18:24.532Z`. The reported 2–3 FPS drops are not claimed fixed by this investigation.

## Recorded evidence

The telemetry contains 167 samples over 16.7 simulation seconds, at 100 ms intervals, for Shimutshibu_Focer_RC_200 (`cars/racers/focer.rpk`, type 6), mass 1467.588 kg, on city.rpk. Physics dt is 1/240 s. The major collision is between t=10.3 and 10.5 s: speed falls from 161.9 to 129.7 to 51.6 km/h; wheel contacts fall from 3 to 1 to 0. Another sharp slowdown occurs at t=12.3 s, from about 39 km/h to 7.1 km/h. By t=13.1 s the chassis is nearly stopped.

The report's worst matched frame callbacks are dominated by simulation and vehicle visuals:

| Frame interval | Simulation + visuals | Main render CPU | GPU occlusion CPU |
| --- | --- | --- | --- |
| 191.8 ms | 156.0 ms | 11.0 ms | 4.5 ms |
| 185.9 ms | 159.4 ms | 6.9 ms | 3.2 ms |
| 165.5 ms | 136.0 ms | 14.7 ms | 0.0 ms |

Current smoothed Physics panels is 9.3 ms; its session maximum is 144.7 ms. Nested Panel solve + contacts is 5.1 ms, session max 115.5 ms. Body collision mesh is 2.8 ms, session max 66.3 ms. These nested rows and separately occurring maxima must not be added. Physics other also reaches 52.9 ms. The report does not provide the per-frame breakdown of all these inner phases for the worst callbacks.

At report time there are 8 physics ticks/frame, 16 active panel solves/frame, 2 body collision surface updates/frame, and 5/8 detached soft parts sleeping; backend is C++/WASM. Thus not every detached part is asleep. Graphics debug UI itself is 4.2 ms smoothed, p95 9.4 ms, so profiling UI has a measurable cost too.

## Local CPU experiments

`npm run benchmark:soft-body`: one 126-node / 1075-beam panel, 1000 active ticks, median of five warmed runs: TS 254.40 ms; WASM 242.35 ms. This synthetic test includes wrapper/contact work and is not a replay of the recorded crash.

`npm run benchmark:vehicle-physics`: stock Baiern, 1200 body triangles / 13 panels, first three simulated seconds cost 9.44 ms per eight ticks; later settled phases cost about 1.7 ms per eight ticks.

A temporary instrumented stock Focer test (944 body triangles / 15 panels), launched at 45 m/s against the test obstacle, used 12,144 panel ticks over twelve simulated seconds. Aggregate kernel input packing was 31.32 ms for beams/mounts plus 7.59 ms for colliders; solve calls including host callbacks cost 1007.66 ms. Finish calls cost another 90.13 ms and include both kernel work and beam-state synchronization, so they cannot be counted as pure copy cost. Total vehicle advance time was about 2334 ms. Input copying alone is therefore not the dominant cost in this synthetic case. The temporary test excludes the city, original script runtime and render-mesh updates; it cannot attribute the recorded crash's exact costs.

## First confirmed optimization

The detached soft-part loop requested a whole-body collision skin/refit before checking whether the fragment was already resting and would skip all contact integration. Defer that request until an awake loose rigid or XPBD panel actually needs the surface. Existing loose rigid hardware still refreshes the body surface as before. A deferred dirty surface is refreshed before contact work when debris wakes.

Regression: an attached panel continues deforming while a detached panel sleeps outside the carrier. Before the change this caused 30 unnecessary updateSurface calls in 120 ticks (0.5 s). Afterward it causes zero. The sleeping panel's coordinates are unchanged, and an external impulse wakes it and requests a fresh surface before contacts. This specifically improves inactive-debris cases; the recorded three awake fragments may still require surface updates, so no claim is made that this alone removes the user's worst drops.

## Next measurements and optimizations

1. Correlate per-frame physics ticks and active panel counts with inner timings, separating kernel solve, input packing/state synchronization, map/body contact queries, collision skinning/refit and render skin/normal updates. The current 100 ms telemetry cannot reconstruct those CPU stages.
2. Reduce collision surface work by updating only changed parts/vertices and checking collision consumers before global work. Preserve topology changes, deformed geometry and fresh contacts when debris wakes.
3. Investigate sustained debris vibration, repeated wake/sleep and per-tick allocations/hierarchy traversal. The high-speed synthetic test kept the chassis and one spinning detached panel active after the chassis stopped.
4. Measure simulation catch-up separately: 240 Hz means 4 ticks at 60 FPS, 8 at 30 FPS; foreground stalls increase work per callback up to the existing budget of 64 ticks, with debt retained. This amplification is possible, but its contribution to the worst recorded callbacks is not established by the available fields.
5. Only after measuring these costs, compare 240 vs 120 Hz and 12 vs 8 iterations as independent experiments, checking deformation, contacts, mount failure and time advancement. This change keeps 240 Hz and 12 iterations.

Validation after the first optimization: production build passes, all 481 standard tests pass, and all 48 explicit WASM tests pass. No physics frequency, iteration count or damage parameters were changed.
