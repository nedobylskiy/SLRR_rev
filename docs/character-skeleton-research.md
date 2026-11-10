# Character skeletons and vehicle bones: research inventory

Audit date: November 10, 2026. Branch: `bones`. Includes research, local asset checks and the first in-engine skinning/animation preview.

## Findings

The browser now previews weighted character skinning and original pedestrian walking through native Three.js animation objects. Driver IK and exact native playback/fade semantics still require validation. Vehicle suspension uses some of the same skeleton machinery, but this is not evidence that the original whole-car damage model is a character-style skeleton.

Three separate layers must remain distinct:

| Layer | Data / responsibility | Current browser engine |
|---|---|---|
| Mesh binding | SCX v4 section palettes, vertex indices and weights | Decoded and bound to native `SkinnedMesh` |
| Skeleton and pose | `.bon` / `.skl`, hierarchy, bind/inverse-bind matrices, joint limits | Decoder, native `Bone`/`Skeleton`, manual pose and skeleton overlay; limits are metadata |
| Animation and control | `.matrixdata`, clip sampling, Java Animation natives, driver IK | Original clip playback and per-RenderRef Java Animation bridge; driver IK remains unimplemented |

## In-engine preview

- **Character playground** discovers 17 skeleton-bearing render resources and 13 animation resources in the installed `humans.rpk`. Model and animation selectors replace the dedicated Vin/pedestrian buttons. The render's declared SKL, palettes and weights are retained. Manual bone controls and a synthetic bend clip remain under **Manual bone pose**.
- The default Gambler render `humans.rpk:0x000A` uses animation `humans.rpk:0x001C`: `humans/pedestrians/gambler_walk.matrixdata`, 25 named bones, 10 keys per bone, 0.9 seconds. Own animations are grouped by source character and default to the matching SKL stem. Playback has play/pause, looping, restart and a time slider. Manual posing stops playback. **Hide game UI** hides OSD independently of preview mode.
- **Other models' animations** exposes other RPK clips. Entries with different bone names/counts or named parents are disabled with a reason. Compatible foreign clips use target-model bone lengths, while retaining the source local quaternion keys. This is a limited shared-skeleton transfer, not general retargeting: orientation/rest-pose offsets are not corrected. Even `hooley_walk` and `hooley_jitter` differ in the parent of `Bip01 R Thigh`, so equal counts alone are insufficient. Browser verification used Gambler walking on Kilos.
- **Ragdoll** freezes the current pose and drives the skeleton with a separate, lazily loaded `cannon-es` world. Up to 15 compound capsule bodies cover pelvis/chest/head and the arms/legs, with cone/twist joints, self-contact (excluding connected bodies), a fixed 120 Hz step, gravity and a floor. Capsule radii are fitted once to the posed skin's dominant weights, capped for stability. A small initial torso velocity (0.15 m/s) makes a perfectly balanced paused pose topple. These are approximate anatomical joint limits, not the undecoded native SKL joint frames. No map/vehicle contacts or driver IK are connected to this playground experiment.
- **Back to animation** removes the physics world and resumes the selected clip at the activation time. On an unanimated model such as Vin, **Restore pose** restores the captured pose. Model changes/disposal cancel pending physics loads and remove the previous world. Viewer fitting remains a presentation transform; ragdoll gravity and dimensions stay in source metre space and the visible floor is placed under the character. The camera follows the falling body's bounds while retaining orbit/zoom, then recentres after reset.
- Everything is converted in memory into `QuaternionKeyframeTrack` / `VectorKeyframeTrack`, `AnimationClip` and `AnimationMixer`. No files are exported or game assets bundled.
- Quaternions are interpreted as absolute local rotations in XYZW order. The final key vector is multiplied by the paired BON bone's local translation length, converted from centimetres to metres. This translation interpretation is inferred from asset comparisons and visually plausible walking, not a verified reconstruction of every native animation operation. The render's declared SKL remains the skin binding; BON supplies lengths only.
- `vin.matrixdata`, `opponent.matrixdata` and `police.matrixdata` contain identical transforms at every key in this installation. They cannot demonstrate time-varying motion. Driver IK is separate work.

Validation: `npm run verify:skeleton` checks all 17 local matrixdata files (9,337 bone/key records), matches their names to paired BON files, and loads all 17 RPK models. It samples 23 own-model and 100 compatible foreign-model combinations, checking finite metre-space skin positions. This does not establish visual correctness of every transfer. Sampling Gambler at 0.00 and 0.45 seconds changes all 962 vertices, with a maximum displacement of about 0.595 metres. Reset restores the bind mesh. Unit tests cover named mapping/hierarchy, interpolation, translation scale, pause, seek, looping, reset and corrupt input. Browser checks cover model/clip switching, hierarchy rejection, phase scrubbing and a compatible transfer.

`npm run verify:ragdoll` activates physics on all 17 render models, simulates eight seconds, checks finite skin positions/floor contact and exact restoration of local bone poses plus animation time, and tests cancellation during lazy loading. Unit tests additionally cover scaled/translated inspection parents, joint-anchor separation and body disposal. Browser checks cover falling from a live walking frame, returning to playback, and restoring Vin's bind pose.

## Supplied archive

The supplied `core.zip` contains 135 entries: a `core/` directory and 134 TypeScript files from a car-building tool. Its SHA-256 is `3449338bd02955aaa1c81d52888473e3c993e10adbe53cc8ddfb88ec2d93c02f`. The archive remains a local reference; its code and game assets are not copied into this repository.

The relevant files are:

- `driverBones.ts`: reads bone names, parents and local transforms from text `.skl` / `.bon` files.
- `driverScx.ts`: decodes section palettes, packed vertex bone indices and blend weights; builds Three.js Bone objects.
- `driverIk.ts`: poses head, arms and legs against camera, steering and pedal targets. Its comments explicitly describe a preview approximation.
- `driver.ts`: driver catalogue and chassis `seat`, `camera`, `pedals` and steering placement helpers.
- `scxRead.ts`, `cfgEmit.ts`, `suspension*.ts`: broader geometry/export and vehicle mounting research.

This is useful example code, not a complete drop-in character runtime. The supplied files contain no `.matrixdata` decoder and no complete SkinnedMesh/Skeleton binding call site. Important limitations include discarded joint limits, stride-based human detection, fallback of invalid palette indices to another bone, and clamping/renormalization of residual weights. Those shortcuts can conceal corrupt data or differ from original skinning. The bone builder returns one root; vehicle skeletons with multiple independent roots need a forest or an artificial common parent. Its UV flip and matrix/unit conventions must be reconciled with our renderer rather than copied unchanged.

## Public source comparison

The upstream refs were fetched on the audit date; existing reference working trees were not switched or modified.

| Repository / pinned revision | Useful evidence | Scope / limitation |
|---|---|---|
| [street-legal `33eca3c`](https://github.com/nicolas-found42/street-legal/tree/33eca3c735f55e5a30c8b7b6f5b00f85e3c9a799/crates/slr-fmt-skeleton) | Text skeleton and binary animation readers; hierarchy traversal; corpus tests and EXE-reader comparison harness | Reader/layout evidence is stronger than assumptions about final animation transforms. Targets build 606; our installation is build 940 |
| [sl-remastered `1721525`](https://github.com/nicolas-found42/sl-remastered/blob/1721525eb0d7c6a32b039b844b79c50b7ab10efc/src/skeleton.cpp) | Skeleton instances, inverse bind, named frames, joint-constrained IK, seated-driver setup | Reconstructed behavior, not the original source. Presence of code and synthetic tests does not establish full visual parity |
| [sl-remastered skinning](https://github.com/nicolas-found42/sl-remastered/blob/1721525eb0d7c6a32b039b844b79c50b7ab10efc/src/scene_raster3d.cpp) and [tests](https://github.com/nicolas-found42/sl-remastered/blob/1721525eb0d7c6a32b039b844b79c50b7ab10efc/tests/scene_skinning_test.cpp) | Indexed palettes, residual weights, normal transforms, two-matrix unindexed path | CPU implementation; a useful reference for our GPU implementation. No `.matrixdata` playback implementation found in the inspected source |
| OpenSLRR `66d033b910452ad8bd8211a06f9d2c4dfcb616d4` | Current host/resource reconstruction | No dedicated skeletal decoder, pose or skinning implementation found by this source inventory |
| slrr-reverse `5c42f3b139aef4c7b9e0b6420c5704e22c0e6cd7` | General native/resource research | No additional character skeleton implementation located |
| [io_invo_scx `7bcc34e`](https://github.com/nonamesex/io_invo_scx/blob/7bcc34e51a3cb40369cc28db2950ab27f9587078/src/scx_v4.py) | Additional SCX layout/axis reference | The inspected importer skips the bone influence payload rather than reconstructing a complete skin |

Some upstream prose still describes skinning as unimplemented while newer source has a skinning path. Inspect implementation and tests together instead of treating old status paragraphs as authoritative.

## What the files contain

### Skeleton tables

The [text skeleton reader research](https://github.com/nicolas-found42/street-legal/blob/33eca3c735f55e5a30c8b7b6f5b00f85e3c9a799/crates/slr-fmt-skeleton/src/skeleton.rs) describes a repeating nine-line record: name, parent index, three rotation rows, translation, then three angular limit pairs. Parents refer to file-order indices and may occur later in the file. Wrapped limits with minimum numerically above maximum are legitimate angular intervals.

`.bon` and `.skl` share that layout, but are not interchangeable poses. Locally, Vin differs in two parent references and five transforms between its pair; police differs in two parents and four transforms. Opponent has matching transforms/parents but different limits. Preserve each file and decide its role explicitly.

The referenced native reader scales translation by 0.1; sl-remastered's SCX skinning compensates with a factor of 10. Our renderer already uses 0.01 for SCX-to-metre conversion. Establish one consistent metre-space bind/pose convention; do not apply all three factors independently.

### SCX skin binding

Palette references are local to a section, not direct global skeleton IDs. The effective transform is the weighted combination of current bone world matrices times their inverse-bind matrices.

In the inspected upstream decoder, chunk 3 stores a counted palette after a reserved word. Chunk 2 provides a two-bone palette without that count. Human vertices use packed four-byte indices and zero to three explicit floats: the remaining influence weight is implicit. The two-bone suspension path can omit per-vertex indices. Do not drop palettes on material changes or overwrite preceding vertex/index groups.

The original audit found that `ScxMesh` skipped skin indices, weights and palette chunks. The parser now retains these fields and the preview builds a native Three.js rig; the source material/UV handling remains shared with the ordinary SCX path.

### Animation keys

The [animation reader](https://github.com/nicolas-found42/street-legal/blob/33eca3c735f55e5a30c8b7b6f5b00f85e3c9a799/crates/slr-fmt-skeleton/src/animation.rs) describes per-bone blocks containing timed quaternion-plus-vector records and trailing names. The purpose of the final vector is explicitly less certain than its binary layout: it must not simply be assumed to be an absolute metre translation. Exact reconstruction of its application, interpolation, looping and fade behavior remains work for a playback experiment.

The accompanying oracle tests compare readers to original EXE functions through Unicorn, but their external vectors are not bundled with this checkout. They were inspected, not rerun here. This audit independently checked our local file structure and invariants; it did not reproduce native execution.

## Local installation checks

A separate read-only audit parsed all local `.bon` / `.skl` and `.matrixdata` records and inspected SCX section/vertex headers. No game files were changed.

| Data | Observed |
|---|---|
| `.bon` | 19 files, 433 bone records; 17 human skeleton files and two suspension skeleton files |
| `.skl` | 17 human files, 429 bone records |
| `.matrixdata` | 17 files, 9,337 bone/key records |
| Human SCX v4 inspected | 16 files; all active packed local bone indices inside their section palettes |
| Vin | 20 bones; four mesh sections, 1,691 vertices; 5 keys/bone over 0.4 seconds |
| Police | 20 bones; three mesh sections, 888 vertices; 20 keys/bone over 1.9 seconds |
| Opponent files | 25 bones; 5 keys/bone over 0.4 seconds; not the skeleton selected by the installed opponent render resources |
| Suspension | `spring.bon` and `shock_absorber.bon`, two independent root bones each; corresponding meshes use vertex flags `0x245` |

All 17 animation name lists matched their paired `.bon` files; declared per-bone key counts agreed, times increased, and quaternion lengths were near one. Driver human vertex variants included `0x263`, `0x265`, `0x269` and `0x271`. These are data validations, not evidence of correct playback.

Parsing `humans.rpk` also resolved the actual driver bindings:

| Render ID in `humans.rpk` | Role | Mesh | Declared skeleton |
|---|---|---|---|
| `0x000C` | driver | mesh `0x000B`, `vin.SCX` | `vin.skl`, 20 bones |
| `0x0007` / `0x0008` | opponent1 / opponent2 | the same mesh `0x000B`, different textures | `vin.skl`, 20 bones |
| `0x0018` | policeman | mesh `0x0019`, `police.scx` | `police.skl`, 20 bones |

Thus the presence of the 25-bone `opponent.bon` does not justify assigning it to the opponent renders. Resolve the RPK descriptor first; in these driver resources it explicitly selects `.skl`, not `.bon`. Preserve `.bon` separately for animation/bind comparisons rather than overriding the declared skeleton by filename convention.

The 17 local `.smb` files are PNG images under motion-blur shaders. Their extension does not make them skeleton files. Likewise, `.vax` / `.vaz` must not be classified as character animation merely by filename.

## Driver and pedestrian behavior

The archived driver IK is a useful prototype, but sl-remastered supplies a more specific reconstructed model: seat-local constraints for head/neck, feet and hands, with additional steering contact/orientation targets. Chassis seat, pedals and steering definitions matter; camera-to-head aiming alone is not evidence of the original solver. Its iterative solver and limit handling still need local visual validation before we claim original behavior.

Original Java already separates a RenderRef from an Animation resource. Local `Spectator.java`, `City.java` and `ROCTrack.java` create Animation objects and use speed/loop controls. `RenderRef` exposes named bone lookup and bone-relative matrix attachment. The browser now implements the Animation constructor, speed, looping, play/pause, seek/getPos and finalization on the actual RenderRef. Each actor owns its skeleton and mixer; the renderer loads its declared animation resource and preserves the Java position/orientation. Textures share cached source images. `getBoneId` remains missing. Playback position uses seconds and fade is approximated as a fade-in duration; exact native semantics remain unverified.

### Pedestrian spawning and movement: November 10 follow-up

Confirmed in the installed build 940 Java/resources:

- `sl/Scripts/game/src/Valocity.java:192–200` calls `map.setPedestrianDensity(0.0005)` and registers six `humans` types (`0x0057`, `0x0058`, `0x0059`, `0x005A`, `0x005B`, `0x0022`). The Java `GroundRef.setPedestrianDensity` wrapper multiplies the value by `Config.pedestrianDensity` before calling the native. The source does not provide the actual native spawn cadence, pedestrian speed or a density-to-count formula.
- Each registered type resolves to a `native ped humans/scripts/*.cfg` descriptor. For example `gambler.cfg` declares a box body, walking render `0x000A` with offset `(0,-2,0)`, and walking animation `0x001C` with parameter `1.0`. This confirms which walking assets the native pedestrian system receives, not the meaning of every native parameter.
- Night-race crowds are separate: `City.java:301–315` pairs the six jitter renders `0x002F–0x0034` with their jitter animation resources. Around lines 351–385 it creates `RenderRef`/`Animation` objects, assigns positions/orientations alongside parked cars, and loops the animation at speed `0.5 + random()`. `Spectator.java` similarly applies a supplied fixed matrix and starts looping animation. Jitter therefore does not itself imply navigation or a spawn area.

The installed city has separate pedestrian AI files:

| File | Locally verified structure | Still unproven |
|---|---|---|
| `maps/city/ai/city.walk` | 1,799 lines with unique dense IDs 1–1,799; each has a bounding box and A–P encoded binary payload with a matching byte-length header. Typed records include waypoint position/direction runs and index runs. A structural scan matched 1,692 sidewalk-shaped records / 7,336 waypoint entries; these are record occurrences, not unique spawn points. | Complete routing semantics, direction rules at transitions, which areas permit spawning, crossing behavior and exact native reader integration |
| `maps/city/ai/city.rest` | 755 bounding-box records; area IDs 1/2/3 contain 484/53/218 records, with `1,index` payloads. | Whether these are waiting/resting zones, exclusion regions, spatial partitions, or spawn controls; the filename alone does not establish this |

The [street-legal pedestrian reader](https://github.com/nicolas-found42/street-legal/blob/33eca3c735f55e5a30c8b7b6f5b00f85e3c9a799/crates/slr-fmt-pedestrian/src/lib.rs) describes type-21 crossing-shaped, type-22 span/link and type-23 sidewalk records. Its corpus tests parse the complete stock files and check leaf references against walk-line IDs. The author explicitly marks geometry roles as structural inference and has not isolated the original EXE file reader. Our local counts match that corpus, but do not independently prove its behavioral interpretation.

The inspected [sl-remastered ground runtime](https://github.com/nicolas-found42/sl-remastered/blob/1721525eb0d7c6a32b039b844b79c50b7ab10efc/src/ground_runtime.cpp) implements density/type registration (up to 32 unique template IDs), not a complete moving pedestrian controller. Our browser host still mocks those registration/density natives: autonomous pedestrian spawning and walking are not implemented. The debug viewer now loads these AI files independently of scenery streaming.

Implemented overlays in **Graphics / map debug**: **Pedestrian graph** displays type-23 point chains in cyan, type-21 spans in yellow and type-22 spans in blue; **Pedestrian rest areas** displays original boxes colored by area group (purple/orange/green). The parser retains IDs, raw links and stored direction vectors and validates references. These vectors are not proof of walking direction. Links are not invented as straight navigable edges. Rest boxes are not treated as spawn instructions.

### Original-game observations: pedestrian zones and transitions

The user compared the overlay with behavior in the original game on November 10, 2026:

- Adjacent cyan boundaries delimit a pedestrian movement zone, usually followed lengthwise; they are not individual directed walking paths.
- Blue spans act as goals or transition boundaries. Within a cyan zone, pedestrians head toward the nearest blue span. After crossing it, they follow a curved transition toward the next zone.
- A nearby car makes pedestrians move away at differing, increased speeds while remaining inside their zone.
- During a transition outside a zone, they hurry toward one of its blue endpoints. The endpoint appears to be the one farther from the car, but distance-based versus direction-based selection is not yet established.
- No consistent behavior matching the `.rest` boxes was observed. Their original purpose, whether they were used at all, and any proposed free-movement/crossing semantics remain unknown.

These are observations of the original game, not a recovered native algorithm. A future controller should model movement zones, goal spans and curved transitions; exact connectivity, escape selection, speeds and thresholds still need validation. Keep `.rest` as an optional raw-data overlay, not a source of spawn or routing rules.

Original fixed spectators are now rendered and animated when Java creates them through `City.java` or `Spectator.java`; no duplicate host crowd is generated. `npm run verify:pedestrians` instantiates the installed original `Spectator.java`, checks its supplied matrix and looping jitter resource/speed, samples deformed vertices, and parses all 1799 walk records and 755 rest boxes. The city overlays were also checked in the browser. Next: validate behavioral meaning of AI fields before autonomous spawning/navigation.

## Vehicle bones

Confirmed overlap: spring/shock skinning, wheel/steering frames, named attachments and CFG bone-related definitions. These should share skeleton/matrix infrastructure where semantics agree. They should not force vehicle damage, chassis topology and character animation into one solver. Our existing spring alignment and XPBD damage are separate approximations; this audit does not establish their equivalence to native bones or original damage.

## Suggested implementation sequence

1. Preserve skin palettes/indices/weights in the existing SCX parser; add strict standalone skeleton parsing, including later parents and multiple roots.
2. Display Vin from its actual RPK render descriptor in bind pose with bone lines and labels, honoring the declared `vin.skl`. Compare its metre-space skeleton to the mesh, then rotate one named joint to validate weights and inverse bind.
3. Apply the same test to police and a pedestrian, then compare `.bon` versus `.skl` roles without silently replacing one with the other.
4. Bind a seated driver to actual chassis/steering/pedal targets, initially behind a debug switch. Validate the reconstructed IK separately from clip playback.
5. Decode and play a walking clip, resolving the final vector's semantics and time interpolation against observed motion. Implement the Java Animation/RenderRef bridge only with explicit lifecycle and per-instance pose state.

The archive and upstream code substantially reduce discovery work, but they do not remove the need for these pose and playback checks.
