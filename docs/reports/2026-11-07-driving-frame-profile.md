# Aggressive driving capture, 2026-11-07 20:38

Inputs: `slrr-remaster-physics-2026-11-07T20-38-23-767Z.txt` and accompanying graphics report, compared with `20-10-14-914Z`. Both are manual driving captures, not identical deterministic workloads. Do not infer isolated speedups from their difference.

| Frame capture metric | 20:10 | 20:38 |
| --- | ---: | ---: |
| Frames / duration | 3016 / 75.09 s | 3406 / 68.53 s |
| Mean interval | 24.89 ms | 20.11 ms |
| p95 interval | 36.5 ms | 33.4 ms |
| Maximum interval | 67.0 ms | 66.6 ms |
| Intervals >50 ms | 49 (1.62%) | 9 (0.26%) |
| Mean render callback CPU | 18.76 ms | 15.24 ms |
| Render CPU mean / p95 / max | 12.46 / 18.1 / 62.0 ms | 10.12 / 14.5 / 45.5 ms |
| Simulation + visuals mean / p95 / max | 3.11 / 11.8 / 31.1 ms | 2.46 / 8.5 / 22.5 ms |
| Hi-Z CPU mean / p95 / max | 1.55 / 7.1 / 25.8 ms | 1.28 / 6.4 / 16.7 ms |
| Streaming CPU mean / p95 / max | 1.03 / 5.2 / 21.3 ms | 0.79 / 4.6 / 11.6 ms |

The newer metadata contains `diagnostic_panels_suspended=1`. Graphics-report panel maxima/percentiles include page history outside capture; those nonzero UI rows do not imply panels were rebuilding during this recording.

Remaining CPU spikes include frame 655 at wall 13.17 s (60.1 ms callback: render 45.5, simulation + visuals 13.8, no Hi-Z/streaming work) and frame 2899 at 58.31 s (44.9 ms callback: render 16.9, simulation + visuals 16.2, Hi-Z 6.1, streaming 4.8). Costs are mixed. Frame interval precedes work in the same row: attribute delayed frames using the preceding callback as well. CPU render time is submission/wall time inside render, not GPU execution time.

Next captures include body triangle-query counters and sampled BVH/narrow-phase times, plus complete soft-panel surface/ground batch timers. See `../remaster-physics-telemetry.md`. Current recordings cannot retrospectively identify BVH traversal cost.
