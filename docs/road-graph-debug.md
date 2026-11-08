# City road graph debug view

Enable **Road graph**, **Road crossings** and optionally **Road metadata labels** in **Graphics / map debug**. These controls also work with **Independent inspection camera**: labels project through the camera actually being displayed, while normal streaming and occlusion retain their original camera.

- Cyan: path-record splines.
- Green → red: stored start → end of each fourth-group road-record spline (formerly blue). The gradient runs continuously over all segments of that record, weighted by stored segment length. Original traffic travels in the opposite direction, **red → green**, as established by the user's checks at most crossing locations (see below).
- Grey-green: lane splines inside crossings.
- Gold/pink markers: the two crossing pools in the TRC file. Their colors do not assert signalized versus unsignalized intersections.
- Labels show one-based global record IDs, stored spline lengths, segment counts, crossing link/lane counts, and unclassified raw tail values. Hover a label for reference IDs and raw words.

The original `maps/city/ai/city.trc` is read in map metres and cached per asset source/path. It has 271 crossing records, 484 path records and 1572 fourth-group road records. The selected ground's explicit TRC path takes priority. A direct package preview can use a unique AI/TRC file in its own map directory; another map's city graph is never substituted.

Road data and geometry are loaded only when a road debug option is enabled. Three batched line meshes and two point meshes represent the graph. At most 28 nearby, non-overlapping labels are shown, refreshed at most once every 120 ms. Hiding metadata removes that label-update work. All graph resources and labels are released on scene changes. Debug geometry stays outside streamed scenery, the occlusion inputs and the reflection/static-shadow update passes.

## Metadata confidence

### Observed traffic direction — 2026-11-08

**Established gameplay observation:** the user checked the gradient at most crossing locations against the original game's right-hand traffic. Actual driving direction is **red → green**, opposite to the displayed road record's stored start → end order (green → red). Treat this relationship as a fact from those gameplay checks, not merely a proposed interpretation.

For the road records inspected this means traversing the spline from its stored end toward its stored start, reversing both the segment sequence and the parameter within each segment. Do not use increasing spline parameter as the default traffic direction. The current visualization deliberately keeps the file-order colors unchanged so that file order and observed driving direction remain distinguishable.

Evidence scope: the user's broad in-game inspection, not an original-native trace or an exhaustive per-record automated check. This establishes the observed direction relationship; which runtime flag or connection enforces it remains undecoded. It does not establish the direction of every grey crossing-lane spline or cyan path record.

### Observed traffic speed regimes — 2026-11-08

User observation from checking the original game's traffic behavior against the debug crossing groups:

- **Gold / pool A (53 records):** crossings on stretches where the original game normally accelerates traffic to roughly 100 km/h; associated with the faster, out-of-town regime.
- **Pink / pool B (218 records):** the remaining crossings, associated with the ordinary city regime. No exact speed is established for this group by this observation.

**Working hypothesis:** the traffic speed regime changes when a car passes a crossing of the corresponding type. Verify the transition event and its direction, rather than assuming a speed limit stored on every spline. Trace the crossing update and outgoing-road selection in the original runtime; compare a car's target speed before and after crossing an A/B boundary.

Confidence: user-observed gameplay correlation, not yet confirmed by original native code or a captured runtime trace. Approximately 100 km/h is observed behavior, not a decoded numeric limit. This finding does not establish the meaning of `raw tail[0]`, nor does it identify either pool as signalized/unsignalized. Keep the parser's neutral A/B names until the transition semantics are established.

Coordinates, record framing/references, cubic Hermite geometry and stored segment lengths are supported by the upstream road-reader/alignment research linked in [the audit](traffic-upstream-audit-2026-11-08.md). No engine code was copied from those implementations.

The first observed raw tail value is 13.888889 (numerically 50 / 3.6), followed by 0.9 and an unset/NaN word. The debug view does **not** label these as a speed limit or road friction: their gameplay semantics and units are unverified. These fields remain exact Uint32 words in the parsed data; display rounding does not modify them. Confirmed stop-line positions, bus-stop markers and traffic-light phase timing have not been identified. `.rest` alone is not sufficient evidence of vehicle stops.

This visualization does not simulate traffic, classify priority or change the `getNearestCross` native. Its purpose is to verify the actual road data against city geometry before integrating behavior.

## Validation

`tests/trc.test.ts` covers nontrivial Hermite curvature, group IDs/references, unknown-field preservation, malformed/truncated data, explicit map selection, caching and read-error retry. A local original-file verification consumed all 843,301 bytes and confirmed the record counts. The graph was visually checked over the original City map, including independent layer toggles and the displayed camera.
