# Original-game driving captures — 2026-11-05

Six user-recorded log snapshots, 16 sessions and **5,373 complete samples**.
All snapshots parsed with zero rejected records and zero incomplete packets.
These are observations of the original game, not tuned remaster parameters or
proof of matching physics. Use multiple cars to qualify shared equations,
coupling and unit conversions; do not fit a separate response per car model.

The protocol uses the user's standard TestTrack. The logger itself records no
map identity, coordinates or road slope. The game executable hash is pinned in
[`manifest.json`](manifest.json). Times in packets are game clock readings;
snapshot labels are local Europe/Madrid timestamps, not session start times.

## Capture catalogue

| Capture | Model | Sessions to use | Transmission | Scenario |
| --- | --- | --- | --- | --- |
| [01](01-shimutshibu-automatic/overview.md) | Shimutshibu ST9 Challenge | 1 | Automatic | Acceleration to observed maximum, then hard braking |
| [02](02-baiern-manual-auto-clutch/overview.md) | Baiern CoupeSport 2.5 | 2; 1 is setup | Manual with automatic clutch | Acceleration through gears; terminal speed not reached |
| [03](03-emer-automatic/overview.md) | Emer Nonus Street GT | 2; 1 is setup | Automatic | Acceleration and slowing/stopping |
| [04](04-einvagen-na-turbo/overview.md) | Einvagen 110 GTK | 1 without turbo; 2 with turbo | Automatic | Paired configuration comparison |
| [05](05-duhen-manual-and-third-gear/overview.md) | Duhen SunStrip 1.5 DVC | 2 baseline; 4/5 clean third-gear attempts | Manual clutch | Through-gear acceleration and third-gear launches |
| [06](06-einvagen-second-third-gear/overview.md) | Einvagen 110 GTK | 2 third-gear stall attempt; 3 turbo / 4 naturally aspirated second-gear launches; 1 setup | Manual clutch | High-gear launch comparison |

Capture 06 was copied just after local midnight on November 6, from a log last
modified on November 5, and belongs to this capture campaign. Session 2 is a
user-reported stall: recorded RPM drops below idle, but this logger has no
explicit engine-running/stalled state channel. Preserve this failed launch as
a diagnostic rather than treating it as a successful acceleration run.

For capture 05, session 1 is setup. Session 3 is the user's first, flawed
third-gear attempt: the car was already moving when third was selected. Retain
it as a diagnostic, but exclude it from a clean stationary-launch comparison.
`annotations.json` in each capture stores these labels separately from raw data.

The earlier Duhen snapshot `20261105-234903` is not duplicated: its two sessions
are identical to the first two in capture 05's `20261105-235147` snapshot.

## Files and reproducibility

Each capture contains:

- `telemetry.txt`: byte-preserving snapshot of the original `system.log`.
- `summary.json`: decoded metadata and complete field packets.
- `samples.csv`: time, RPM, speed, raw gear/control channels and temperature.
- `shifts.csv`: raw gear-parameter changes bracketed by adjacent samples.
- `curves.csv`: native dyno getter results sampled at fixed RPM.
- `runs.csv`, `overview.md`: per-session descriptive summaries.
- `annotations.json`: user protocol and data-use labels.
- `boost-estimates.csv`, where present: **derived estimates**, not measurements.

`manifest.json` records SHA-256 and size for capture files and exact recorder /
exporter snapshots in `provenance/`. No proprietary game source, assets,
compiled scripts or executables are included. The Java recorders are original
project code; the modified original Track.java is deliberately excluded.

Verify integrity and reparse every raw log without installing dependencies:

```powershell
node data/telemetry/original-game/2026-11-05/provenance/verify.mjs
```

To regenerate exports into a separate directory:

```powershell
node data/telemetry/original-game/2026-11-05/provenance/exporter/extract.mjs data/telemetry/original-game/2026-11-05/04-einvagen-na-turbo/telemetry.txt .research/reexport-einvagen
```

The archived basic recorder produced captures 01–03. The turbo-parameter
extension produced captures 04–06. Both emit short v2 field records and use
a 0.1-second time gate; actual sample spacing is retained. Long-expression
concatenation is a suspected cause of earlier crashes, not a proven VM limit.
Intermediate staged debugging probes are not part of this dataset.

## Interpretation limits

- Gear is `getAIparam_int(6)`. Control channels retain their original raw API
  identities. An observed gear change is not a measured clutch lock instant.
- Shift RPM is bracketed at about 100 ms. Sample peaks are not necessarily
  terminal speed or exact limiter RPM. Logger sequence gaps/partial packets
  must be checked before comparing trajectories.
- Native mass is explicitly unqualified. Do not silently substitute it for
  independently verified total physical mass.
- Dyno statistics and getter output are distinct: `max_hp_raw`,
  `power_native_raw` and the historically named `torque_nm` export retain the
  recorder's field identities; units and scaling need separate qualification.
- No boost-pressure getter is recorded. Boost CSVs apply a reconstructed
  RPM/dyno envelope with zero plateau assumed, from sl-remastered's older
  reference implementation. They do not measure pressure or spool lag in this
  Steam build. Old captures without turbo parameters have no such estimates.
- Paired Einvagen runs differ in initial temperature, native mass and engine
  wear. Duhen attempt wear changes from 0.885 to 0.849 to 0.807. These are not
  identical-condition repetitions; preserve those differences during fitting.
  Capture 06's second-gear runs also differ in launch RPM and pedal history:
  engine wear is 0.978 with turbo versus 0.940 without turbo.
- There is no driven-wheel angular-speed channel, so clutch slip and tyre slip
  cannot be uniquely separated from engine RPM and chassis speed alone.

Keep the inputs/conditions alongside any later model residuals. These records
are a starting reference corpus, not a completed calibration.
