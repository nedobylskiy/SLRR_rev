# Character skeletons and vehicle bones: research inventory

Audit date: November 10, 2026. Branch: `bones`. Includes research, local asset checks and the first in-engine skinning/animation preview.

## Findings

The browser now previews weighted character skinning and original pedestrian walking through native Three.js animation objects. The first seated-driver/steering IK prototype is available; exact native IK and playback/fade semantics still require validation. Vehicle suspension uses some of the same skeleton machinery, but this is not evidence that the original whole-car damage model is a character-style skeleton.

Three separate layers must remain distinct:

| Layer | Data / responsibility | Current browser engine |
|---|---|---|
| Mesh binding | SCX v4 section palettes, vertex indices and weights | Decoded and bound to native `SkinnedMesh` |
| Skeleton and pose | `.bon` / `.skl`, hierarchy, bind/inverse-bind matrices, joint limits | Decoder, native `Bone`/`Skeleton`, manual pose and skeleton overlay; limits are metadata |
| Animation and control | `.matrixdata`, clip sampling, Java Animation natives, driver IK | Original clip playback, per-RenderRef Java Animation bridge, and an opt-in seated-driver IK lab |

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
- After correcting the debug renderer to translate local junction spans by their row's XZ origin, the user identified the yellow type-21 spans as boundaries of transition corridors between the cyan movement zones. Blue spans mark their entrances/exits. This visual observation establishes a geometric constraint for transitions; it does not establish the original curve-selection algorithm.
- A nearby car makes pedestrians move away at differing, increased speeds while remaining inside their zone.
- During a transition outside a zone, they hurry toward one of its blue endpoints. The endpoint appears to be the one farther from the car, but distance-based versus direction-based selection is not yet established.
- No consistent behavior matching the `.rest` boxes was observed. Their original purpose, whether they were used at all, and any proposed free-movement/crossing semantics remain unknown.

These are observations of the original game, not a recovered native algorithm. A future controller should model movement zones, goal spans and curved transitions; exact connectivity, escape selection, speeds and thresholds still need validation. Keep `.rest` as an optional raw-data overlay, not a source of spawn or routing rules.

Original fixed spectators are now rendered and animated when Java creates them through `City.java` or `Spectator.java`; no duplicate host crowd is generated. `npm run verify:pedestrians` instantiates the installed original `Spectator.java`, checks its supplied matrix and looping jitter resource/speed, samples deformed vertices, and parses all 1799 walk records and 755 rest boxes. The city overlays were also checked in the browser. Next: validate behavioral meaning of AI fields before autonomous spawning/navigation.

## Vehicle bones

Confirmed overlap: spring/shock skinning, wheel/steering frames, named attachments and CFG bone-related definitions. These should share skeleton/matrix infrastructure where semantics agree. They should not force vehicle damage, chassis topology and character animation into one solver. Our existing spring alignment and XPBD damage are separate approximations; this audit does not establish their equivalence to native bones or original damage.

### Suspension playground

**Suspension playground** compares original `parts.rpk` spring render `0x0070` and shock render `0x01B6` against ordinary Y scaling, side by side. Model selection offers either part or both, a 45–145% bind-length slider, optional upper-bone tilt, continuous compression, bone markers and reset. This is an isolated visual experiment; it does not replace the running vehicle suspension.

The render descriptors do not declare skeletons. The playground explicitly pairs their SCX with shipped `spring.bon` / `shock_absorber.bon`, retaining both independent roots (`bone00`, `bone01`) and their 24.5 cm separation. Original palettes and weights feed native Three.js SkinnedMesh/Skeleton. Bottom bone stays fixed; top bone translates with the requested span. Tilt rotates only the top bone; the scale comparison intentionally has no corresponding independent endpoint rotation. No files are exported.

Local verification found 553 spring vertices (527 mixed-weight, 26 rigid) and 105 damper vertices (all rigid 0/1 weights). At 65% span and zero tilt, maximum vertex difference from Y scaling is 1.236 cm for the spring and 5.858 cm for the damper. These are differences between visual methods, not errors against original-game animation. With linear height weights, two-bone translation can equal axial scaling; the damper's rigid groups instead preserve component dimensions as they telescope. Skinning costs per-vertex bone transforms, while scale needs only an object transform; neither calculates suspension forces, travel stops or physical spring-coil contacts.

`npm run verify:suspension-skinning` loads the installed RPK/SCX/BON resources, checks each vertex against its authored weighted transform at several compression ratios, rigid/mixed classifications, finite tilted poses and exact bind-pose reset.

## Suggested implementation sequence

1. Preserve skin palettes/indices/weights in the existing SCX parser; add strict standalone skeleton parsing, including later parents and multiple roots.
2. Display Vin from its actual RPK render descriptor in bind pose with bone lines and labels, honoring the declared `vin.skl`. Compare its metre-space skeleton to the mesh, then rotate one named joint to validate weights and inverse bind.
3. Apply the same test to police and a pedestrian, then compare `.bon` versus `.skl` roles without silently replacing one with the other.
4. Bind a seated driver to actual chassis/steering/pedal targets, initially behind a debug switch. Validate the reconstructed IK separately from clip playback.
5. Decode and play a walking clip, resolving the final vector's semantics and time interpolation against observed motion. Implement the Java Animation/RenderRef bridge only with explicit lifecycle and per-instance pose state.

The archive and upstream code substantially reduce discovery work, but they do not remove the need for these pose and playback checks.


### Experimental walking crowd

**Walking pedestrians** in Graphics / map debug enables the streamed population near the player car (or preview camera target). The **Pedestrians** slider sets an integer cap of 0–50, initially six. **Pedestrian spawn radius (m)** ranges from 50 to 300, initially 100. **Inspect pedestrians** moves the orbit camera to an active walker. Changing maps disposes the population and invalidates pending loads. This is an opt-in host population, not the original density/registration native implementation.

The controller pairs the two type-23 boundary chains of a record, aligns their endpoints, and interpolates a position between them. Of the stock city records, 788 meet this corridor interpretation and gate validation. Type-22 endpoint IDs and the linked junction record's IDs choose connected corridors; nearby but unlinked sidewalks are not joined. At a goal span, yellow type-21 walls and blue type-22 gates are translated by the junction origin and assembled into a closed XZ contour. A quadratic arc through the junction origin is accepted only if its sampled segments stay inside that contour. Otherwise a visibility-graph path goes around the walls, with safe corners rounded inside the contour. Routes are sampled by arc length for steady speed; reversing away from a car retraces the same constrained path. Endpoint elevations are interpolated along the route. Missing/open contours or unreachable exits cause a turnaround, not an unconstrained shortcut. A dead end also reverses direction. `.rest` does not determine routes.

Walkers initially choose the nearer end of their zone, keep different lateral offsets and walking speeds, and use compatible original walking clips. Within 12 metres horizontally and four metres vertically of an active car, they accelerate to individually varied escape speeds. A threat ahead reverses the walking direction inside the zone; during a transition the curve can be reversed toward the farther endpoint. A two-second decision cooldown avoids rapid reversals. These distances, speeds, curve construction, wall-constrained routing and escape selection are host approximations, not recovered original constants. Vehicle contacts now activate ragdoll as described below. There is no mutual pedestrian avoidance or traffic-light compliance yet.

Verification includes bounded continuous movement through stock linked zones, corridor containment, turning away from a nearby car, loading all six animated actors, and resource disposal. The existing fixed Java spectators remain a separate system.


### Vehicle contact ragdolls

Walking test pedestrians switch from the current animated pose to their articulated ragdoll on contact with the player car or active traffic. A swept upright-person envelope against the vehicle OBB catches crossings between rendered frames. It rejects horizontal near misses and vehicles on another road deck; remote car teleports do not produce a long swept hit. Proximity alone still produces avoidance, not ragdoll.

Walking is frozen during activation, the mount stays fixed, and the ragdoll inherits walking velocity plus a contact-point impulse from relative closing speed and effective vehicle/person mass. Vehicle feedback is deliberately scaled to 25% of the pedestrian impulse. Subsequent ragdoll contacts use nearby kinematic vehicle boxes with compliant, low-friction contacts; their accumulated feedback is budgeted per vehicle per physics substep before being sent back to the host vehicle. This keeps a trapped or grounded limb from acting like an anchored post, without weakening anatomical joints or reducing the impulse that moves the pedestrian. This bridge is approximate: it is not one shared solver with the existing vehicle physics, and rotating/swept volumes remain simplified.

The physics module is preloaded with the crowd. Each struck actor owns its Cannon world, joint constraints and vehicle proxies. In map scenes it samples a 32-by-32-metre, two-metre-spaced terrain patch at activation, with a lower fallback floor outside that patch; this approximates ground and slopes, not detailed curbs, walls or arbitrary static obstacles. Settled pedestrians stay down until the test group is reset. Pedestrian-to-pedestrian ragdoll collision and getting up are not implemented. Scene changes and crowd reset dispose bodies and cancel pending activation. Playground ragdoll/reset controls retain their previous behavior.

Checks cover activation pose continuity in transformed frames, transferred momentum, car contact/reaction, terrain support, continuous vehicle sweeps, near misses, separate elevations and the original animated pedestrian resources entering ragdoll after an actual test-car sweep.


### Pedestrian population streaming

An immutable spatial index samples recognized walking corridors every eight metres at three lateral positions. Refills query nearby cells instead of rebuilding the graph. The population cap need not be filled when safe positions are unavailable. Spawns prefer the primary camera's blind area, stay at least 12 metres away there (35 metres if visible), avoid other pedestrians and vehicle footprints/projected motion, and stay inside the chosen radius. Visible close spawns are rejected again after asynchronous loading.

Every half second, actors beyond spawn radius + 50 metres are retired; density reductions retire distant actors first. Animated rigs, meshes and clips are kept in a bounded pool for reuse. Retirement stops/disposes ragdoll bodies and invalidates pending contact activation. At most six actors warm up on initial enable; further refills are serialized, at most one every 250 ms. Walkers have no rigid-body solver until vehicle contact. Pooled actors do not update or render; map reset disposes their resources. Proximity avoidance and constrained transitions continue across zone boundaries during streaming.

Verification covers blind spawn preference, close-spawn rejection, unavailable space, reuse after moving the player over 600 metres, lowering density to zero, and retaining over 80% of the test vehicle's speed through pedestrian contacts.


Walking centres now keep a 0.30 m margin from corridor side boundaries and finite yellow transition walls, including their endpoints. Blue gates remain open. Boundary percentage offsets are clamped by corridor width; passages narrower than 0.60 m use their centre. Transition arcs and fallback route segments are validated for wall clearance, with candidates around wall endpoints rather than extending wall lines across nearly collinear gates. A 2 cm entry/exit tolerance handles small numeric differences between stored gate coordinates and corridor endpoints. All 1272 recognized stock corridor-to-corridor transitions remain routable after the clearance change.


### Forward goals across adjoining yellow cells

A yellow transition need not be a single record: blue type-22 spans can connect one yellow cell to another before reaching the next paired cyan corridor. Treating every such span as a direct corridor entrance incorrectly produced 304 apparent dead ends. Routing now follows explicit reciprocal type-22 gate IDs through a bounded chain of yellow cells, validating each cell's arc and keeping its 30 cm wall margin. It never joins arbitrary nearby geometry.

The pedestrian approaches the current corridor's forward end through the middle of its goal span over the final four metres. Inside yellow cells, the next blue exit is selected by forward progress and the target corridor's outgoing direction; randomness is limited to near-equal forward alternatives. On re-entering a cyan corridor, the lateral offset returns gradually, avoiding a seam jump when neighboring records have opposite boundary ordering. Escape reversal still retraces the planned path. There are no stop/turn triggers on individual doubled blue seam lines.

The stock-data audit finds continuations for 260 of the formerly blocked ends; 44 ends still have no recognized supported continuation and conservatively turn back. The concrete original-data chain corridor 2 → yellow 198 → yellow 199 → corridor 200 is covered by the installed-asset verifier, including continuous positions and containment in the relevant yellow cells. This is host routing based on observed behavior, not a recovered original native controller.


### Driver IK: initial seated pose and wheel contacts

**Driver IK** in the asset sidebar opens an opt-in Baiern test with the installed `humans.rpk:0x000C` Vin render and its declared 20-bone `vin.skl`. Java driving scenes now bind the player's existing RenderRef to the same IK after the physical vehicle is assembled. No second Vin model is created: the loaded Java character is temporarily seated under the vehicle-following IK root. Binding is scoped to the driving world; removal restores the Java model and its rest pose without disposing its resources or resetting physical wheel steering. The active car's driver is hidden in its CFG interior-camera views and restored in exterior views; IK continues while hidden. Late async loads are checked against the current scene/character binding before adoption. The steering slider moves the actual installed wheel through its CFG slot frame; the driver reads that part's current transform, so the same component can follow a physically steered wheel. **Cutaway** hides exterior parts for inspection and restores their previous visibility; **Skeleton / grip targets** shows the rig and hand goals.

The chassis parser now retains `seat` pose and `pedals` position explicitly. The driver root uses the seat matrix in metres with its authored YPR; the cockpit camera point supplies a neutral torso alignment, limited to 0.45 rad at the spine. Legs receive a static seated IK pose toward the pedal reference, not pedal-operation animation. The upper-rim hand goals use angles ±1 rad and a 1.5 cm rim inset suggested by the inspected reconstructed native setup (`configureSeatedDriver` / `updateSteering`, local sl-remastered source). The actual wheel mesh bounds supply its radius and axial depth; installed slot/render transforms supply placement and rotation.

The arm chain includes clavicle, upper arm, forearm and hand. Clavicle swing is limited to 0.8 rad, then analytic two-link IK places the wrist using a stable downward/outward elbow pole and fixed bone lengths. This is a host approximation, not a port of the native iterative solver or its undecoded per-axis limits. A separate one-axis wrist pivot is now enabled: a neutral wheel-local grip frame follows the rim, while the wrist may rotate up to ±35° around the wrist-to-palm contact axis to reduce forearm strain. The palm grip centre remains pinned to the rim target. Vin's hand-local grip offset (about 8 cm from the wrist joint, calibrated from the closed-fist mesh) is rotated with the hand; a fixed-grip arm solve supplies a stable wrist orientation. Wrist freedom twists only the hand around the line through the wrist and palm contact, preserving both points without any further arm solve. All upstream bone positions and rotations remain identical when toggling wrist freedom. This prevents the fist floating beyond the rim or orbiting it when wrist freedom is enabled. **Wrist pivot** toggles this freedom for comparison; it does not slide a hand along the rim. The range and neutral frame are host approximations, not recovered native constants. The upstream reconstruction has additional hand-only `sthbone_left/right` orientation constraints, distinct from the three-ancestor position targets; this is relevant to the user's observation about movement within the grip.

`npm run verify:driver-ik` loads stock Baiern and Vin, sweeps the installed wheel from −540° through +540°, and checks both palm grip targets with wrist freedom enabled and disabled, unchanged positions and rotations of every non-hand bone across toggles, and no drift on repeated updates, unchanged bone translations and finite rotations. It repeats with a translated/rotated car and scaled parent. The browser inspection confirms the seated model and hand motion at neutral and 108° steering. Gear changes, reverse head turning, inertial sway, hand sliding/regripping and exact native joint-limit parity are outside this first step.

### Suspension road test and wheel camera

**Suspension road test** loads the complete mechanical Baiern assembly with its body hidden. A repeating height field supplies both the rendered road and tyre contact queries, with full-width and alternating left/right bumps. The existing 120 Hz suspension solver handles support, tyre contacts, spring/damper forces, vertical motion, pitch and roll. A lane/speed guide supplies longitudinal motion; this stand does not run the engine/transmission or crash-deformation solver.

Eight original spring/shock skins follow their live CFG-linked lower and upper mounts. **Follow wheel** selects FL, FR, RL or RR; the camera and orbit target translate with that wheel while preserving manual orbit and zoom. Switching wheels resets to an outside view of the selected corner. Controls provide 0–40 km/h speed, 0–15 cm bump height, pause, quarter-speed playback, body visibility, selected-corner bone markers and restart.

`npm run verify:suspension-road` runs the installed mechanical stock assembly over 30 seconds of bumps, checks travel on every wheel and finite supported motion/anchor spans, pause, flat-road settling and restoration of original assembly transforms on cleanup. `npm run verify:suspension-skinning` separately checks the original suspension meshes and bone weights against ordinary scaling.

### Vehicle suspension bone visualization

Normal assembled vehicle worlds now bind supported stock spring/shock SCX meshes to the same original two-bone BON rigs used by the road test. The skinned replacement remains inside its part proxy for picking, visibility, world removal and scene lifetime. Live CFG-linked mounts set its endpoints; proxy centimetre scaling and render offsets are cancelled before placing the metre-based skin. Unrecognized/custom meshes retain their existing renderer. Detached parts without a valid mount pair fall back to their ordinary mesh.

**Suspension bone animation** in Graphics / map debug is enabled by default. Turning it off restores ordinary meshes and skips bone-pose calculations and skinned draws; physical contacts, spring forces and damping are unchanged. Re-enabling uses the current mounts. Unchanged spans reuse their previous bone pose. The road test shares these vehicle bindings rather than loading duplicate suspension skins. The asset verifier also checks all eight mount pairs through the proxy transforms, toggle visibility, no bone updates while disabled, re-enabling and cleanup.

### Head fit for low cockpits

The driver's first CFG cockpit camera is now also a positional head-joint goal. An analytic two-link torso bend seeds a bounded 32-pass CCD solve before solving the hands; the neck/head orientations maintain level cockpit gaze, preserving the pelvis, all local bone translations and all scales. Head orientation is compensated into the cockpit's neutral gaze frame. The 1.8 rad torso swing bounds and neutral neck orientation are host approximations, not decoded native per-axis limits. This does not detect or collide with the roof mesh, and unreachable goals remain bounded. The fitted torso/head pose is cached per driver binding; steering still updates both hand contacts each frame.

**Driver IK** now offers Baiern and Yotta selection and **Fit head to cockpit** for comparison. A blue marker shows the head goal. Installed-data validation reduces head-joint error from 16.24 cm on Yotta and 4.03 cm on Baiern to numerical tolerance on both; it checks unchanged pelvis/bone lengths, grip contacts during steering and repeatable toggle restoration. Normal Java driving uses the same fit by default. Roof clearance and anatomical appearance still require visual evaluation; the camera-as-head-joint interpretation is an approximation rather than proof of the exact original head/eye constraint.

The torso bend is seeded toward chassis +Z (the seat back), rather than forward toward the steering wheel. Both two-link solutions reach the same neck/head goal, but the forward pole raised the chest into the chin on low Yotta seats. The installed-asset verifier now checks the rearward bend on both Yotta and Baiern, in addition to head/gaze and hand constraints.
