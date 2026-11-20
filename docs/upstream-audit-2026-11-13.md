# Upstream update audit — 2026-11-13

Scope: refresh the default branches of the existing research repositories and
inspect changes since the locally examined revisions. Source inspection only;
upstream executables, builds and gameplay tests were not run. Runtime code was
not imported. Local research checkouts retain their working-tree HEAD; fetched
`origin/main` revisions were read with `git show`.

## Revisions

| Repository | Previous local revision | Current default branch | Newly reachable commits |
| --- | --- | --- | ---: |
| [OpenSLRR](https://github.com/EliasFD3S/openslrr) | `be00046544dc558b181b94821249c0abf8756a94` (November 10) | `1462d3c4f8281f5f0df1ce2d0e8360ee5b1f7462` | 42, including merges |
| [sl-remastered](https://github.com/nicolas-found42/sl-remastered) | `1721525eb0d7c6a32b039b844b79c50b7ab10efc` | unchanged | 0 |
| [street-legal](https://github.com/nicolas-found42/street-legal) | `33eca3c735f55e5a30c8b7b6f5b00f85e3c9a799` | unchanged | 0 |
| [slrr-reverse](https://github.com/EliasFD3S/slrr-reverse) | `5c42f3b139aef4c7b9e0b6420c5704e22c0e6cd7` | `93588c4c6f72ddcb231e1c9ca46429e7db5991b6` | 1: README archive/transition notice |
| [io_invo_scx](https://github.com/nonamesex/io_invo_scx) | `7bcc34e51a3cb40369cc28db2950ab27f9587078` | unchanged | 0 |
| [slrr-tools](https://github.com/imagecode-git/slrr-tools) | `ccc254ec1a58fe951294713c999b311bc64d0130` | unchanged | 0 |
| [SLRR-Proofix](https://github.com/CookiePLMonster/SLRR-Proofix) | `ff6c0538b778cd3b61f98d3394aac96187d9393d` | unchanged (`master`) | 0 |

The published `slrr-javas` default branch remains at `7e622de774c46c57b6598f79ad8dc065975b3a0a`
(2022-11-16). Feature branches and open pull requests were not exhaustively audited.

## Highest-value findings

### Pedestrian file layout and original walker

[Commit 60b143e](https://github.com/EliasFD3S/openslrr/commit/60b143ef4fe95bdc0b9b61aee9ef93a03f06047b)
attributes its reader, spawn, tick and steering reconstruction to the original
MWM 2.2.1 executable at `0x00586580`, `0x00589550`, `0x00589cb0` and `0x00586e40`.
This attribution was inspected, not independently confirmed in disassembly here.

- Header: origin X/Z, floor slopes X/Z, floor height, record count. Our
  `PedestrianWalk.width` is the floor-height word; `origin` currently combines
  the preceding four words. Our `tag` corresponds to the record count.
- Records are sequential: kind, optional kind-23 spline nodes, four XZ endpoint
  coordinates, signed target ID. They are not nested child records. Target -1
  means a boundary/run; other IDs identify gates to another row.
- Runs use Hermite splines. Upstream reconstructs ignoring stored tangent
  lengths. Walkers retain a heading inside zones, with four strongest steering
  influences, separation from walls/runs and other walkers, and gate transitions.
- Upstream labels 1 m body radius, 1 m/s base speed, and a car threat horizon
  of five seconds as original constants. Its car avoidance still explicitly
  notes uncertainty about one cross-product operand order.
- Walk animation advances by displacement plus half the facing-angle change.
- `city.rest` is still not established as a pedestrian navigation source.
  Its three group counts match TRC groups; this remains an inference.

Local independent structural check of installed build 940 `maps/city/ai/city.walk`
using the newly described sequential record layout:

| Check | Result |
| --- | ---: |
| Rows decoded and consumed exactly | 1,799 |
| Kind 21 records | 1,692 |
| Kind 22 records | 3,534 |
| Kind 23 records | 1,692 |
| Gate IDs not resolving to a row | 0 |
| Header floor-height range | -1.197345 to 18.708235 m |

This confirms corpus structure, not the complete movement/animation semantics.
The present TypeScript parser and steering were not changed by this audit.

### Ambient sound from map placements

[Commit a5dfc46](https://github.com/EliasFD3S/openslrr/commit/a5dfc46490e6fa07ced3ec937798f7b2dc4eab9c)
adds `scene_ambience.cpp` and documents original parser/timer addresses in
[HOST_NATIVE_UTILITIES.md](https://github.com/EliasFD3S/openslrr/blob/1462d3c4f8281f5f0df1ce2d0e8360ee5b1f7462/docs/HOST_NATIVE_UTILITIES.md).

`sfx_loop` and `sfx_random` supply birds, flies, dogs, insects, city traffic and
sea sounds. One loop per object: a later definition replaces an earlier one.
Random entries share one object timer, with per-entry delay/hour settings.
Hour windows wrap midnight. The start test is `distance² - radius² <= 250²`.
Upstream currently implements distance attenuation, without stereo positioning
or Doppler. These original-behavior claims have not been independently verified
against our executable.

### Other changes worth retaining

- [Garage repair 58f3a0b](https://github.com/EliasFD3S/openslrr/commit/58f3a0b):
  local deformation/slot/wheel repair, stock Java tree traversal and repair caps,
  preservation of intentional slot adjustment. Explicitly cites our repair work.
- [Car reflections 262aa27](https://github.com/EliasFD3S/openslrr/commit/262aa270e41ba5717b3378b81d2519cd386bd920):
  showroom reflection scenes and inclusion of the garage shell in cubemap capture.
- Skeleton, SCX skin palettes, native Animation binding and pedestrian animation
  are now implemented upstream; broad new parser availability overlaps our work.
- An embedded TUFA source compiler implements explicit `System.compileAll`.
  It is not a Java SE compiler and does not hot-replace executing classes.
- Knowledge base, native inventory and modder documentation were expanded.
  [EXTERNAL_RESEARCH.md](https://github.com/EliasFD3S/openslrr/blob/1462d3c4f8281f5f0df1ce2d0e8360ee5b1f7462/docs/EXTERNAL_RESEARCH.md)
  distinguishes our observations/host choices from executable evidence.
  Its dyno section flags an unresolved endpoint/nitrous sampling disagreement
  with our port. Do not change either model without an original-binary comparison.

## Suggested next work

1. Correct the pedestrian reader's field meanings and sequential record model,
   preserving the existing debug overlays and checking identical corpus geometry.
2. Compare original-style free-agent movement with our current corridor targets;
   retain our ragdoll/streaming systems while validating slopes and gate transitions.
3. Add map ambience using placement CFG metadata, bounded audible voices and
   original time windows/timers. Avoid ticking every emitter every display frame.

No newly completed traffic/signal simulation or knockable-map-prop implementation
was found in the inspected OpenSLRR default branch. Its knowledge base still says
the TRC reader is unused and ordinary instanced placement props are outside its
collision index. These remain roadmap work, not completed features.
