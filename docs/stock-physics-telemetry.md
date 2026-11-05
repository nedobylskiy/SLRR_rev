# Original-game physics telemetry

## Current original-game diagnostic state

The full recorder still crashes the original game without a script error after
the import/mass fixes. It is not qualified for unattended capture. The user's
experimental installation now uses
`tools/stock-telemetry/diagnostics/stage2/PhysicsTelemetry.java`: one guarded RPM
read per track visit, with log markers before/after the getter. The complete
recorder remains separate. Stage 0 (empty hooks) was confirmed by the user to
run without crashing and correctly produced no telemetry output. The user also
found the stage1 literal marker, confirming that the Track hook and System.log
can run. The unusual filename observed from an earlier run is not proof of memory
corruption; the actual logging route remains a separate investigation.

Enable each next step only after an original-game run confirms the previous one:

1. **Stage 0:** empty hooks; test entry, driving and exit from standard TestTrack.
2. **Stage 1:** the provided stage1 variant logs one literal line per track visit,
   without inspecting the Vehicle argument.
3. **Stage 2:** null-check car/chassis and read getRPM once, with before/after
   markers. Then add clock/throttle, speed, gear and control reads individually.
4. Leave metadata, mass, ratios and engine/dyno traversal disabled until basic
   samples work. Split those sections into individual marked probes too.

When switching variants, preserve the installed source and generated
`sl/Scripts/game/PhysicsTelemetry.class`, then invalidate that generated class
so the game recompiles the new source on a full restart. Never change the
Steam installation as part of these experiments. Stage 2 is enabled; an
original-game rerun is pending. Expected final marker:
`SLRR_TELEMETRY_PROBE stage=2 after=getRPM rpm=...`.

## Full recorder (not yet qualified in the original runtime)

`tools/stock-telemetry/PhysicsTelemetry.java` is a passive recorder for the
installed Steam/build-940 script API. It does not change throttle, gears, tuning,
dyno calculation or assembly state. Hooks call it from `Track.animate()` and
stop the session from `Track.exit()`. Default sampling interval is 0.1 seconds;
actual timestamps are logged and there is no catch-up loop.

## Prepare the scripts

From this repository, stage a new mod directory outside the game:

```powershell
node tools/stock-telemetry.mjs stage --game-root "C:/Program Files (x86)/Steam/steamapps/common/Street Legal Racing Redline" --output .research/stock-telemetry-mod-v3
```

The output must be a new folder with an existing parent. It contains:

- `sl/Scripts/game/src/PhysicsTelemetry.java`.
- A copy of the installed `Track.java` with exactly two inserted calls.
- `telemetry-manifest.json` with source and patched hashes.

The command reads the installation and writes only the staging directory.
The staged files for the inspected installation have also been generated locally
at `.research/stock-telemetry-mod-v3/`. To try them in an isolated game copy, back up
both `Track.java` and its generated `Track.class`, copy the staged source files
into the corresponding script source folder, then let that copy of the game
compile them. Remove the added source/generated class and restore the original
Track source/class to uninstall. Do not mix precompiled classes from another
game version. Original-game compilation and a live run remain to be verified;
only source-interpreter fixture execution has been tested here.

The first original-game attempt reported `parse error (2)` in `sample()` at
the `Config.player_transmission` assignment. Version 2 adds the missing
`java.util.*` import: the stock Config belongs to `java.util`, not `java.game`.
The fixture now uses that actual namespace. The corrected script and removal
of its stale generated class have been applied to the user's explicitly named
experimental copy; a successful original-game rerun is still pending.

The next run reached `describe()` but failed because `getMassPatch()` is only
mentioned by an outdated Chassis comment, not implemented. Version 3 calls the
existing native `getMass()` and labels the result `mass_native_raw` with source
`Chassis.getMass_unqualified`. Do not treat this as verified total vehicle mass.
The script's `getTotalMass()` alternative creates a temporary chassis, so it is
not used by the passive recorder. The fixture no longer invents getMassPatch.

The game writes `SLRR_PHYSICS|v=1|...` records through `System.log` (normally its
system log under `system/`). The actual log destination is controlled by that
game installation. Retain the complete log, including the initial metadata.
Car/transmission-mode changes, track exit and a backward clock reset delimit sessions. For a
new configuration on the same car, leave/re-enter the track to refresh metadata.

## Recorded information

- Vehicle/chassis identity, names, unqualified native mass, transmission configuration, gear ratios,
  final drive, idle/redline RPM, engine inertia/mass and clutch parameter.
- Engine block identity, wear/tear, dyno statistics and peak RPM values.
- The existing dyno torque/power table sampled every 500 RPM, bounded at 20,000
  RPM. `getHP` is the native watt-table getter in the examined implementation;
  original statistic fields named `maxHP`, `Displacement` etc. remain explicitly
  labelled raw until qualified. These are not measured wheel horsepower.
- Samples: time, RPM, speed in m/s, raw gear parameter 6, shifting flag, raw
  throttle/brake/clutch/steering parameters and temperature.
- Shift events: previous/current gear parameter, time, RPM and speed on both
  sides. A shift is bracketed by two samples, not timed to an exact frame.

Names are encoded with stock `String.getASCII()` so separators and line breaks
cannot corrupt records; the extractor decodes them. Character encoding for
non-ASCII mod names still depends on the original runtime.

**First-run qualification:** compare `gear_param6` against the original HUD at
neutral, reverse and first/second gear, and check pedal readings at rest/full
input. The API declares these AI parameters, but that alone does not prove they
represent the final engaged gear/player control values. Preserve raw records if
they differ; do not infer a shift formula from an unqualified field. No fallback
gear inferred from speed/RPM is silently substituted.

## Extract and compare

```powershell
node tools/stock-telemetry.mjs extract "C:/captures/original.log" --output .research/original-drive
node tools/stock-telemetry.mjs extract "C:/captures/original.log" --output .research/drive-comparison --compare "C:/captures/candidate.log"
```

Outputs: `summary.json`, `samples.csv`, `shifts.csv`, `curves.csv`, and, when
requested, `comparison.json`. Comparison reports sampled pre-shift mean RPM and
torque-table deltas only for matching observed configurations. Repeated run IDs
from appended game launches remain separate sessions. Truncated/invalid rows
are counted and skipped. A log lacking metadata cannot be used as a complete run.

The candidate must use the same telemetry schema. A live remaster exporter and
automatic parameter fitting are a next stage after qualifying original getters;
the current tool must not be presented as having fitted the driving model.

## Capture protocol for subsequent parameter sweeps

Use the same saved car, installed parts/condition, tuning, transmission mode,
flat route and direction, weather and assists. Record game build/EXE hash and
the intended test externally with the log. Avoid collisions and nitrous in the
baseline. Perform at least three repetitions of:

1. Neutral idle and steady throttle (dyno/RPM identity check).
2. Full-throttle launch through successive gears.
3. Fixed-gear acceleration, then throttle release/coasting and braking.
4. Manual shifts and automatic shifts in separate sessions; automatic clutch
   and automatic gear selection are separate configuration dimensions.

Align runs by launch/gear events, retain the measured sampling interval, and
compare torque curves before changing clutch/inertia/drag. Change one parameter
family per sweep. Differences in slope, pedal input, wheel slip or conditions
are not evidence of a gap in the engine torque formula.
