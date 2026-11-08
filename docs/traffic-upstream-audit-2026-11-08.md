# Traffic and road upstream audit — 2026-11-08

Scope: refresh the previously examined third-party repositories, inspect default branches for traffic, city paths, signal control and `GroundRef.getNearestCross`, and validate the candidate road layout against the local original installation. This is research only; no runtime behavior or native status was changed. No upstream executable, test suite or original EXE oracle was run in this audit.

## Revisions

| Repository | Previous audit (2026-11-05) | Refreshed default branch | Finding |
| --- | --- | --- | --- |
| [openslrr](https://github.com/EliasFD3S/openslrr) | `ee36b85a9d1b8100c68c4fb03437199f1f892b1a` | `4c458f9252fb22bebcc9f1440bbd7844f2f6c888` | 31 newly reachable commits; rendering, vehicle dynamics, OSD, resources, threading, audio. City/traffic still listed as unfinished; no road-graph query or signal controller found in inspected src/include. |
| [sl-remastered](https://github.com/nicolas-found42/sl-remastered) | `1721525eb0d7c6a32b039b844b79c50b7ab10efc` | unchanged | Strongest inspected road layout / bounded query evidence. Useful work predates this audit. |
| [street-legal](https://github.com/nicolas-found42/street-legal) | `33eca3c735f55e5a30c8b7b6f5b00f85e3c9a799` | unchanged | Structural TRC parser with opaque sections and explicitly unproven field names; less complete than sl-remastered. |
| [slrr-reverse](https://github.com/EliasFD3S/slrr-reverse) | `5c42f3b139aef4c7b9e0b6420c5704e22c0e6cd7` | unchanged; archived | Many original function addresses and soft host substitutes. Do not mistake soft traffic scaffolding for complete original behavior. |

Fetched remote refs without replacing research working trees. Comparisons use `origin/main`, not the older checked-out HEADs.

## Original road data

[sl-remastered road_network.hpp](https://github.com/nicolas-found42/sl-remastered/blob/1721525eb0d7c6a32b039b844b79c50b7ab10efc/src/road_network.hpp) and [reader](https://github.com/nicolas-found42/sl-remastered/blob/1721525eb0d7c6a32b039b844b79c50b7ab10efc/src/road_network.cpp) describe four sequential groups with one-based references (0 means null): two crossing/node pools, path records, and a fourth group of linked road records. Node records contain links, lane records and position words. Segment records occupy 57 bytes. The road alignment header identifies cubic Hermite endpoint positions/tangents and segment length, rather than straight lines inferred from visual street meshes.

[Road-record comparison procedure](https://github.com/nicolas-found42/sl-remastered/blob/1721525eb0d7c6a32b039b844b79c50b7ab10efc/tools/parity/road-record/README.md) documents bounded comparisons against original record-reader functions on real city data. It explicitly excludes a complete live traffic simulation and invalid-input parity.

Independent local structural check of `maps/city/ai/city.trc`:

- 843,301 bytes; all bytes consumed, no trailing data.
- Version 1; group counts: 53, 218, 484, 1572.
- 271 crossing/node records in the first two groups.
- 3,854 lane entries within crossing records; 6,911 segments within path/fourth-group records. These are record counts, not traffic-car counts or unique physical street counts.
- 14,028 references checked against the global record range.
- Crossing coordinate bounds: X −1353.77…1324.59; Y −1.32…18.85; Z −1768.51…1493.22.

Scratch verification: `.codex-attachments/inspect-city-road.mjs`. It verifies framing/reference ranges and reports coordinates. It does not validate every link's semantic target type, original x87 arithmetic, routing correctness, or signal behavior.

[street-legal TRC source](https://github.com/nicolas-found42/street-legal/blob/33eca3c735f55e5a30c8b7b6f5b00f85e3c9a799/crates/slr-fmt-traffic/src/lib.rs) contains conflicting high-level/header descriptions and leaves a large block opaque. Its speculative field labels should not override the original-reader-backed four-group layout.

## Nearest crossing: the important contract

[Selection implementation](https://github.com/nicolas-found42/sl-remastered/blob/1721525eb0d7c6a32b039b844b79c50b7ab10efc/src/road_network.cpp) minimizes:

`abs(length(node.position - query.position) - requestedDistance)`

- `distance = 0`: nearest crossing by 3D distance.
- Positive distance: crossing closest to the requested radius. It is NOT a maximum search distance; a result may lie beyond the requested radius.
- Searches both node pools; ties retain the earlier candidate.
- The helper supports an optional strict vertical filter `abs(dy) < 5`. The inspected GroundRef native calls it with that filter disabled.
- Original native address `0x00483d00`; lookup helper `0x00581a00`.
- [Native wrapper](https://github.com/nicolas-found42/sl-remastered/blob/1721525eb0d7c6a32b039b844b79c50b7ab10efc/src/natives/registry.cpp) returns the selected node's position as a newly allocated Vector3.
- [Nearest comparison procedure](https://github.com/nicolas-found42/sl-remastered/blob/1721525eb0d7c6a32b039b844b79c50b7ab10efc/tools/parity/road-nearest/README.md) covers real city queries, ties, height boundaries and large finite inputs; the implementation accounts for original x87 intermediate precision. These upstream checks were inspected, not rerun here.

Local illustrative double-precision query: nearest to origin is second-pool index 206 at (−26.50847, 1.000036, 2.269919). With requested distance 100, the candidate is second-pool index 117 at (−54.03222, 7.294118, −131.04832), approximately 141.94 units from origin. This is an example of radius matching, not an original-executable parity claim.

Our current mock copies the input only for distance 0, and returns null for nonzero distance. Both differ from a real graph lookup. The nonzero case should not be implemented as a bounded/radius cutoff.

## Other useful road operations

Subsequent broad user checks of the original game's right-hand traffic established that the debug road-record gradients run against actual driving direction: stored start → end is green → red, while traffic moves red → green. Record this as an established gameplay observation for the inspected road records. The responsible runtime flag/link semantics, grey crossing-lane directions and cyan path directions are not established by that check. See [direction evidence and implementation implications](road-graph-debug.md#observed-traffic-direction--2026-11-08).

[road_alignment.hpp](https://github.com/nicolas-found42/sl-remastered/blob/1721525eb0d7c6a32b039b844b79c50b7ab10efc/src/road_alignment.hpp): `alignToRoad` projects onto road splines in XZ, supplies a tangent, and models the original half-path tangent flip.

[road_route.hpp](https://github.com/nicolas-found42/sl-remastered/blob/1721525eb0d7c6a32b039b844b79c50b7ab10efc/src/road_route.hpp): bounded start-direction and crossing-to-crossing route halt-mask work. Original route code and the soft host also expose cached route length, sampling position and normalized progress. This is useful evidence, but not proof that full traffic navigation is implemented end to end.

## Signals: what remains unknown

Later local executable work identified the `trlight` instance-to-crossing/link binding and the visual state getter. See [original traffic signal binding](traffic-signals-research.md) for the exact executable hash, addresses, evidence and remaining limits. The findings below describe the earlier upstream-only audit.

`roadSecondCrossingInitialState` retains initialization time and groups flagged links by related road records. Both crossing pools have lane/group initialization. This is useful intersection state evidence, but by itself does NOT establish red/yellow/green phases, phase durations, yielding rules, stop-line locations or mapping to visible signal instances.

No verified complete signal controller or visual traffic-light binding was found in the inspected default-branch implementation and road/parity files. Do not label the two pools definitively as signalized/unsignalized until verified.

Subsequent user gameplay observation associates gold/A crossings with stretches where traffic accelerates to approximately 100 km/h, and pink/B with the remaining city crossings. A regime change on crossing traversal is a working hypothesis, not a verified native contract. See [the recorded observation and follow-up check](road-graph-debug.md#observed-traffic-speed-regimes--2026-11-08). This does not decode the raw speed-like fields or establish signal control behavior.

[Archived GroundRef traffic source](https://github.com/EliasFD3S/slrr-reverse/blob/5c42f3b139aef4c7b9e0b6420c5704e22c0e6cd7/engine/Runtime/Resources/GroundRef_traffic.cpp) documents `haltTrafficCross` native `0x00484b90`, cross halt helper `0x0057c170`, eviction `0x0057bfa0`, and nearby-cross spawning `0x00581e00`. A temporary forced traffic halt is distinct from ordinary signal phase cycling. Comments explicitly mark soft path cursors and other missing behavior.

Similarly, [sl-remastered placeGroundTraffic](https://github.com/nicolas-found42/sl-remastered/blob/1721525eb0d7c6a32b039b844b79c50b7ab10efc/src/ground_runtime.cpp) currently appends requested template/count parameters to records. Its successful traffic unit test does not demonstrate moving cars following lanes or respecting lights.

## Suggested implementation order

1. Independently implement a validated TRC reader and expose this extension through the local asset reader (current dev allowlist does not include `.trc`). Cache per map.
2. Draw crossings, road splines and connectivity in the inspection camera; compare them to the visible city before using them for traffic.
3. Replace `getNearestCross` mock with actual two-pool selection, preserving requested-distance semantics; add meaningful real-data and boundary tests.
4. Add `alignToRoad` / route queries as supported, then lane-following traffic with car spacing.
5. Separately investigate the original intersection update and visible signal resource binding. Only add claimed original phase behavior once its contract is established.

No upstream source implementation was copied into the engine. This audit records observations and immutable source links; integration requires a separate implementation and validation pass.
