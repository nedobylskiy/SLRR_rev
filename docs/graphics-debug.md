# Graphics debugging branch

## Experimental static batching and generated LOD

Two independent, initially disabled switches are available in **Graphics / map debug**:

- **Merge static map geometry** groups compatible opaque parts by shared material,
  attribute layout, render/shadow state and the 128 m cell containing each part's
  centre. This first implementation merges within each streamed model type, not
  across independently loaded/evicted types. Parts spanning more than 256 m in
  diagonal extent, material arrays, transparency and cutout surfaces stay separate.
  Triangles are combined without clipping or changing UVs, normals or vertex
  colours. Large spatial surfaces keep their original bounds. The report's
  `prepared parts X → Y` shows the actual reduction; no speedup is assumed.
- **Generated map LOD** builds one reduced level in a single background worker,
  using Three.js SimplifyModifier with topology and shape checks. Visible instances switch to generated geometry
  beyond 200 m and return to full detail below 160 m. Near/far instances use
  separate instanced batches, so triangle work can fall while draw count increases.
  Existing authored game LOD resources are not used by this option.

LOD generation keeps primary UVs, normals, tangents and `slrrColor`. Extra UV
channels, authored lighting UVs, morph targets, material arrays, transparency,
cutout foliage and unsupported geometry retain their original representation.
Eligible geometry has 120–6000 input vertices. The worker rejects open or
non-manifold shells (including separate facade/road panels), then attempts 35%
vertex removal after welding. Results must remain closed, reduce submitted work
by at least 20%, and pass bidirectional sampled surface-distance checks within
2% of the source diagonal. This is a conservative geometric test, not an exact
screen-space, texture-error or silhouette guarantee. Unsafe results retain full
detail. Trunks/opaque props may simplify while cutout foliage stays unchanged;
foliage needs a separate whole-tree impostor/card strategy, not this simplifier.

The source remains visible until generation completes. The queue is bounded,
late results for evicted geometry are ignored, and a worker failure retains full
detail. The report shows ready/queued counts and geometries kept original.
The generated geometry changes rendering only, not collision or suspension.
Primary-camera streaming/culling and auxiliary shadow reserves remain separate;
inspection of all residents uses full detail. Geometry distance cutoff takes
precedence over static merging and generated LOD.

Static merging prepares at most one loaded model per streamer update and caches
its representation for A/B toggling. That preparation still runs on the main
thread and may cause an initial spike for a complex model; LOD simplification
runs in the worker. Cached originals and generated representations add memory
until model eviction/scene disposal. Compare steady-state reports after the
preparation queues settle, using the same camera and effects. Try merging first,
then LOD separately, to distinguish draw-submission savings from triangle savings.

Branch: `codex/graphics-debug`.

Open **Graphics / map debug** and enable **Detailed GPU diagnostics**. The report
shows asynchronous GPU timer samples for the main color pass, dynamic shadow
pass, static-map shadow bake and reflection capture. Passes are timed separately,
without nesting WebGL timer queries or waiting for the GPU. Empty passes do not
produce misleading zero-cost samples. Old samples include their age. The timer
extension is optional; unavailable hardware reports that explicitly.
Total-frame samples alternate with the pass breakdown because WebGL timer
queries cannot nest. They are samples of different frames; individual averages
must not be summed to reconstruct the total, especially for throttled captures.

Color GPU timing also starts at the first color submission when the renderer
skips its shadow callback. **GPU query health** reports resolved-result count,
oldest pending-query age and the active query, to distinguish unavailable or
delayed GPU results from a cheap pass. No synchronous result waits are added.

The **Renderer … CPU (sampled)** rows split one main render in 17 into:

- Scene/camera world-matrix updates.
- Scene traversal, frustum culling and render-list building, including geometry
  preparation performed during traversal.
- Opaque/transparent list sorting.
- Color draw submission: material/program selection and GL submission, including
  diagnostic hooks; this can include driver waits, not only draw-call dispatch.
- Shadow rendering and remaining work such as lights, background and callbacks.

These sampled parts partition one main renderer call and are nested inside
`Render CPU`; do not add them to the existing inclusive scopes. Measurements
use the installed Three.js render-list boundaries and restore temporary matrix
hooks even when rendering throws. Fine per-draw timers run only on sampled
renders. This is instrumentation, not a claim that rendering has been optimized.

Repeated map objects, including trees, already use `InstancedMesh` batches.
Trunks and foliage remain separate geometry/material draws, while placements
share their buffers. The report now lists resident/visible instance batches and
the largest visible batches with their instance counts, separating auxiliary
casters. Visibility here is scene-hierarchy visibility before camera culling;
actual submitted work is still shown by the per-pass draw counters. Instancing
reduces submission work but does not eliminate foliage overdraw or texture cost.

The mesh breakdown counts actual submitted draws and triangles for opaque,
alpha-cutout and blended surfaces. It includes the instance count multiplied by
draws, and the ten mesh-name groups with most submitted triangles. Reflection
captures can contain six views and additional shadow work; their totals are not
the main-camera draw count. Infrequent active passes retain their latest work
counts with an age so a 500ms UI refresh does not hide reflection/bake updates.
Raw custom draws such as flares are outside the mesh breakdown.

Drawing-buffer resolution and DPR expose pixel workload. Render-target sizes,
shader-program count, material count and referenced geometry/instance buffers
help distinguish other costs. Texture storage is an estimate based on mip data
or dimensions and format, deduplicated by source/sampler. These are scene
references, including resident objects that have not necessarily uploaded yet,
not an exact measurement of allocated VRAM. Driver allocations, framebuffers,
MSAA, shadow targets and reflection targets are excluded from the memory estimate.
Fragment invocations, texture-cache misses and actual overdraw are not available
through these counters. CPU submission and GPU timings overlap; do not add them.

**Copy graphics report** also includes all available Java callback profiles,
vehicle/part counts, physics work summaries and both camera positions. With
detailed diagnostics enabled, additional evidence is collected:

- Whole render-callback CPU, uninstrumented callback CPU, RAF scheduling delay
  and the wall gap between callbacks. Renderer preparation, shadow submission
  and color submission are measured separately. CPU scopes can include driver
  waits; this is not CPU utilization.
- Parked-vehicle updates, vehicle mesh synchronization, Java scene polling and
  debug/report UI work. Async Java timings are wall spans and overlap other work.
- Last 180 samples' p95, the existing 2-second peak window, sample count and a
  persistent maximum for each timing. GPU samples remain asynchronous and cannot
  be matched to a slow CPU frame just because they appear in the same report.
- The twelve worst frame intervals in the last 120 seconds, retaining the
  previous callback's top-level sections and measured work between callbacks.
  Both actual callback-start intervals and RAF timestamp deltas are shown:
  timestamps can lag behind execution after a blocked main thread.
- Browser long tasks and long animation frames when supported, including script
  attribution, blocking duration and rendering/style-layout phase markers.
  Observer records overlap. A 100 ms timer also records visible-page scheduling
  delay. No browser API here directly measures garbage-collector pauses.
- GPU vendor/renderer, GL/GLSL versions, context attributes/limits, hardware
  concurrency, memory hints, optional JS heap readings and page visibility.
  Hardware queries are cached rather than issued per frame.
- CPU cost/counts of shader compilation/linking, buffer/texture uploads, mipmap
  generation and observed readbacks/waits. Wrappers add no GL calls, readbacks or
  synchronization. They are removed when diagnostics is disabled/disposed.
- A total across all instrumented passes, plus texture-file storage and distinct
  source/sampler-copy counts to reveal repeated uploads of the same asset.

Enable diagnostics before reproducing a hitch, then copy the report while its
history is still within 120 seconds. Instrumentation and live report formatting
have a cost (the latter is measured). Disabling detailed diagnostics stops the
browser observers, timer and GL resource hooks.

Use **Copy graphics report** to copy the current measurements. Diagnostic mesh
wrappers and resource traversal add CPU overhead while enabled; compare normal
performance with this checkbox off.

Enable **Independent inspection camera** to look from a separate observer:

- Left drag orbits; right drag pans; the wheel zooms. Arrow keys pan when focused.
- Streaming focus and primary-camera culling continue to use the game camera.
- Shadows and reflection capture retain the primary/car focus.
- The primary frustum and streaming-radius ring are drawn as helpers, excluded
  from shadow/reflection capture.
- Initially the observer sees only the batches submitted by primary culling.
- **Inspect all resident instances** expands those batches to the instances
  already held in memory, including off-screen/hysteresis residents. It never
  requests objects near the observer. This deliberately adds render work and is
  for inspection, not performance measurement of the ordinary primary view.
- **Reset inspection camera** copies the current primary pose. Turning inspection
  off restores ordinary submission without changing the primary pose.

This tool observes GPU work; it does not disable lighting effects to improve FPS.

The stock City resource `c1_phys` (`maps/city/meshes/c1_phys.SCX`, untextured
SCX3 material `_picsasag`) is a coarse collision shell that is also present in
the map's child-render list. It is retained in terrain/collision processing but
excluded from the visual stream, including all-resident inspection, shadow maps
and reflection captures. The report counts this exclusion. Identification is
scoped to this known stock resource and material signature; it is not an inferred
native resource flag or a blanket filter on untextured models.

## Map back-face experiment

**Back-face culling (map)** is on by default and can be toggled for A/B comparison. It switches
opaque static map materials to FrontSide only when every nondegenerate triangle
agrees with the authored normals. Mixed or uncertain winding, alpha cutouts and
transparent layers remain DoubleSide. Future streamed models use the selected
policy too; toggling off restores two-sided rendering. Vehicles are unaffected.
Dynamic shadows and the cached static depth bake retain DoubleSide casters.

This reduces reverse-face rasterization and fragment work, not submitted vertex
counts or necessarily draw calls. Transparent DoubleSide surfaces may still need
two passes. No FPS improvement is assumed: compare the same view and lighting
settings. For isolated measurement leave raycast occlusion off: its conservative
blocker policy currently accepts only DoubleSide surfaces, so enabling back-face
culling can reduce the set of ray occluders.

## Streamer interval experiment

**Limit streamer update rate** is enabled by default with **Streamer interval (ms)**
set to 100. With the checkbox off, streaming updates every render frame.
Zero also means every frame. The next frame applies changes to either control.
Between updates rendering reuses the existing instance lists: proximity scans,
visibility selection, queued chunk preparation and installation of loaded models
all wait for the next update. Resource requests already in flight still complete
asynchronously. Long intervals can make object appearance and camera turns lag.
There is no catch-up loop after a slow frame. The graphics report records the
selected interval; physics and rendering continue every frame.

## Far plane experiment

**Far plane** (off by default) limits the primary camera's far clipping plane
to the streaming radius, or the game camera's original far value if smaller.
It clips triangles at the view-space far plane, without splitting geometry or
adding per-fragment distance checks. It is a depth limit, not a spherical radius.
Range changes apply immediately; disabling restores the latest game camera far
value. The inspection camera retains the original far range for observation.
Shadow and reflection camera ranges are unchanged. Sky geometry beyond the plane
is clipped too. The report includes the primary camera's effective far value.

## Off-screen shadow support

Enabling baked lightmaps retains a 150 m reserve of off-screen
placements for shadow casting. This reserve uses separate auxiliary instance
batches, sharing geometry and materials with the visible batches. It is excluded
from the main color pass and raycast-occlusion candidates, while cached static
depth and reflection capture can still use it. An instance is
never duplicated between the main and auxiliary lists of the same mesh.
The report counts auxiliary mesh instances separately. The inspection camera
shows the main list unless **Inspect all resident instances** is enabled.
Large indivisible meshes whose bounds intersect the primary view can still
extend behind the camera; splitting them is a separate geometry-cutoff option.

**Dynamic shadows** accepts vehicle parts, including their additional linked
renders. Static map surfaces and Java scenery do not cast into the dynamic sun
shadow map; they still receive vehicle shadows. The cached bake uses a separate
static-caster flag, preserved through instancing, auxiliary batches and chunks.
Enabling dynamic shadows alone does not add a static-map reserve.

## Real reflections

The local 128px cubemap captures six faces at most four times per second, with
vehicle groups hidden during capture. Vehicle shaders sample it in world space
in their authored reflection stage, retaining SCX reflection strength and paint
detail masks. This contribution is independent of **Dynamic lighting** and does
not replace the PBR environment map or add a second PBR reflection contribution.
Until the first successful capture, the authored/global 2D reflection remains
active. Disabling the feature clears the local uniforms and restores that path.
The capture far plane is 5000 m so distant sky shells can enter the cubemap;
capture still uses the already streamed geometry and requests no extra objects.

## Parked vehicle polling

The 150 ms Java scene poll still discovers cars and checks their installed trees.
An unchanged displayed car skips suspension solving, native attachment pose
publication and visual synchronization. The cache compares pose revision,
steering, visibility filters, wheel bindings/values, calibration, attachment
transforms and physical configuration; assembly refresh invalidates it.
WheelRef tuning and newly available wheel states are checked even while asleep.

Chassis motion wakes transform publication and floor contact checks, but reuses
the loaded suspension pose while its inputs remain unchanged. Native part pose
publication uses the existing live-object index instead of scanning all resource
handles for every part. This is display synchronization, not a driving physics
sleep system: moving simulated vehicles still need their regular solver ticks.

## Shared vehicle texture sources

Vehicle, preview and Java-object SCX materials share decoded texture sources by
normalized file path within the same Assets collection. Diffuse, paint changes,
second layers, authored lightmaps, detail and reflection layers use this pool.
Each consumer owns a Texture clone with independent UV transforms and sampler
settings. Three.js can reuse the GPU upload when source and sampler agree;
different samplers or color spaces can still require separate GPU storage.

Disposing one part releases its clone only. The last consumer evicts the source,
so this is not an unbounded cache across scene changes. Scene clear starts a new
pool; pending old requests retain their old pool until their clones are released.
Different Assets collections never share pixels merely because paths match.
This does not merge materials or reduce draw calls. Compare texture copies and
referenced storage in reports from otherwise identical scenes.

## Route recording and standalone benchmark

Start a normal physical drive, preferably with an undamaged, stationary car.
Use **Start physics recording**, drive through the problem area, and press
**Stop & download telemetry**. The existing TXT format now also includes the
body quaternion and world linear/angular velocity. Use the separate
**Download route benchmark** button to save the replay JSON. This avoids the
browser's multiple automatic download restrictions.

The JSON records body pose and wheel state at 10 Hz, primary and optional
inspection camera poses and streaming focus at up to 20 Hz, and input changes
at fixed physics tick resolution (including single-tick gear commands). It
contains the installed assembly definitions, mount overrides, conditions,
evaluated engine curve/settings, wheel references, mass and body center. It
does not contain original meshes/textures; mount the same game assets to replay.
Recording is opt-in and limited to 30 minutes.

Open **Route benchmark** below the viewport, load the JSON, choose a mode and
press **Run benchmark**. Loading stops the Java game scene, cooperative input
poll, game boot runtime and OSD. It reconstructs the map and car directly in
the host engine. **Restart Java** returns to the game.

- **Render recorded route** interpolates position and quaternion, camera and
  streaming focus. Vehicle physics is paused, isolating map streaming, rendering
  and visual synchronization from the solver and Java gameplay scripts.
- **Physics along route (100 ms sync)** feeds recorded controls to real host
  physics ticks, restoring body/engine/wheel reference state every 100 ms before
  frame capture and shock detection. World-space cages and rigid children move
  consistently with each correction. This benchmarks local solver work along
  the same route; it does not test free-running driving-model accuracy. Reports
  include checkpoint count and RMS/maximum position corrections. The additional
  synchronization cost appears separately as `Replay checkpoint CPU`.
- **Free physics controls (stop at 2 m drift)** runs controls without checkpoints.
  Camera/streaming follow the reference route. If the car leaves it by over two
  meters, measurement stops with `aborted_reference_drift`, its elapsed time and
  drift, rather than treating an unrelated crash as a completed benchmark.

Each run has a three-second warmup excluded from frame measurements. The
profiler resets after warmup. Live FPS/CPU/GPU counters, draw calls and triangles
refresh every 500 ms using renderer counters; the full scene/resource scan and
vehicle debug timer do not run during measurement. At the end, **Download benchmark report**
saves all frame intervals, mean FPS, p50/p95/p99/max frame times, average draw
and triangle counts, physics drift, and the current CPU/GPU diagnostic snapshot.
GPU timer availability and asynchronous query age remain visible in that snapshot;
it is not a per-frame GPU trace or a whole-run aggregate of every CPU section.

Current graphics switches remain editable between runs for A/B testing. Keep
viewport size, resolution, camera route and settings the same when comparing.
Run a second time for warm-cache comparisons: three seconds cannot guarantee
that every later shader/LOD/texture along the route has already been prepared.
The recording retains a graphics-settings description for reference; it does
not automatically overwrite the current optimization switches.

New recordings also store original render frame intervals, average draw/triangle
counts and drawing-buffer dimensions. Replay shows this baseline beside current
measurements and includes it in the result JSON. Hidden-tab gaps are excluded.
Older JSON routes still load, but cannot supply this baseline without a new recording.
Replay restores the recorded expanded/windowed layout (older routes use expanded
view); controls float over the expanded view instead of shrinking its render area.
Match drawing-buffer dimensions before interpreting an FPS difference.

A render route deliberately excludes physics, Java gameplay/OSD, other vehicles
and the original expensive diagnostic refresh. It also runs with assets/shaders
potentially warmed by the preceding drive. Smooth replay therefore narrows the
investigation; it does not prove the complete original workload is now smooth.

This first format does not snapshot contact/solver warmstarts, existing panel
deformation, dynamic traffic/other parked cars, Java-created scene props or all
script-driven lighting/sky state. Physics playback is a diagnostic reproduction,
not a deterministic save state; record from rest without prior damage for the
most useful comparison. A small initial mismatch can accumulate into a different
corner or collision during free control replay. Use the checkpointed physics
mode for route performance comparisons, and free controls for model diagnostics.
Render playback reproduces the chosen car and map route.

### Physics time and render stalls

The host vehicle always uses a 1/240 s physics step. A foreground render frame
passes its complete elapsed time to the clock instead of clipping it at 100 ms.
The clock can process up to 64 ticks per render callback (about 267 ms), retaining
any remaining debt for subsequent callbacks. The former eight-tick limit could
not sustain real time below 30 FPS even when there was ample CPU time for physics.
Hidden-tab pauses and explicit pause still do not accumulate elapsed time.

Live physics diagnostics show simulated time, requested simulation time, pending
milliseconds and the tick budget. Physics benchmark results additionally contain
`physics_timing`: measured wall seconds, simulated/target seconds, current and
maximum pending time, fixed step and per-callback tick limit. Pending time includes
the fractional remainder below one physics tick. Increasing catch-up capacity
does not change the integration step or make an overloaded CPU infinitely fast;
remaining time debt is retained and reported rather than silently discarded.

`Hide trees` in Graphics / map debug removes stock tree trunks and foliage from color, shadow and reflection passes for comparisons. Models stay resident and tree collision stays active. The switch defaults off, persists across map reloads in the current session, and its state is included in graphics/route reports. Stock trees are recognized by their `faNN` / `tree` resource aliases.

For street-furniture comparisons use `Hide streetlights / poles`, `Hide trash bins`,
and `Hide other small props` independently. All default off. Stock resource aliases
classify complete objects, including separate lamp components and bin lids;
shared render resources are batched separately when their categories differ.
Other small props include signs/adverts, benches, hydrants, crates, containers,
barriers and known decorative vegetation. Unknown aliases, buildings and road
meshes remain visible; this is not an automatic size-based filter. Hidden models
stay resident and their physical collisions remain active. Main color, auxiliary
shadow casters and local reflection captures omit the hidden objects; cached
static shadows are reset when toggling. Graphics reports list each category's
state and resident instance count, and route results also contain
`render_profile.hidden_object_categories`.
Compare a baseline with all categories shown, then enable one checkbox per run
on the same route. Avoid changing categories during a timed run: the shadow
refresh triggered by the change is itself additional work.

### Precached object cells

`Precached object cells` is an opt-in experiment for categorized trees and street
furniture. `Object cell size (m)` selects 64 or 128 m (default 128). Ground,
architecture and uncategorized resources retain the ordinary streamer.

At preparation time each categorized model distributes all its placements into
a fixed XZ grid. Each cell stores exact-capacity instance matrices and palette
colors; geometry/material resources remain shared with the source model. Bounds
include the complete transformed geometry, including parts extending outside the
placement cell. Runtime camera updates test these cached bounds and attach only
visible or shadow-reserve batches to the scene. Inactive cells leave scene
traversal while retaining cached buffers. No triangles are clipped, instance
lists compacted or matrices rewritten when the camera moves. The normal streamer
interval also controls cell visibility updates.

The initial preparation loads all categorized model types, not only the current
radius. In a route benchmark it completes before timed playback begins. Enabling
it on an already running scene or changing cell size performs preparation then;
wait for the preparation message to clear before starting a comparison. Resources
stay cached for the map session while enabled, increasing residency outside the
streaming radius. GPU storage is still initialized on first use by Three.js.

Cells are per model/category; models with different materials are not collapsed
into one draw. Larger coarse visible bounds may submit more instances, and
splitting one map-wide instance batch across cells may increase draw calls.
This experiment primarily avoids per-instance selection/upload work; it does
not guarantee fewer draw calls or automatically hide objects behind buildings.
Generated LOD, per-part frustum selection and static part merging are bypassed
for cached categorized objects; ordinary map types retain their current settings.
Geometry-cutoff shader settings still apply if enabled.

Graphics reports list prepared model-cells, visible model-cells, cached batches
and instance-buffer bytes. Route results include `precached_object_cells` and
`object_cell_size_m` in `render_profile`. Compare off, 128 and 64 with identical
viewport, lighting, shadows and route mode; compare CPU/GPU times as well as FPS.
An initial prototype retained thousands of invisible meshes in Three's scene
hierarchy and regressed. The current version detaches those cached meshes;
this is covered by the immutable-buffer and mode-switch tests.

Map object loading currently uses daytime variants only. Explicit stock render
resource aliases `night_*` and `*_night` are excluded before SCX, textures,
instance batches or cached cells are prepared. This removes duplicate night
house meshes and illuminated sign variants. Other CFG render components remain
active; `flags=4` alone is not used as a universal night filter. The graphics
report includes excluded night batch and component-instance counts. Reload the
map or restart the route benchmark to apply this loading policy. Automatic
night/day switching of map render variants is not implemented by this policy.

### Unified building materials (prototype)

`Unified building materials` prepares compatible opaque SCX parts of stock
`krthazNN`, facade/shop and hotel models as a single geometry and material.
The checkbox is saved in browser localStorage (both enabled and disabled states)
and restored before the first map load after a page refresh. Enable the checkbox,
then re-enter the map, reload the page or rerun the route benchmark. The
setting is captured per map load and recorded in the benchmark render profile.
Eligible building models prepare before map loading completes and remain cached
for that map session, so array copies and geometry merging are outside timed
route playback. This trades longer initial loading and higher residency for
lower runtime preparation cost.
It defaults off.

This uses Three.js `WebGLArrayRenderTarget`, a standard WebGL2 texture array,
with a small `MeshStandardMaterial.onBeforeCompile` diffuse lookup. Identical source texture/tint sets share ref-counted array storage across render
variants; repeated textures within a model reuse a layer. Textures
are copied into array layers once on GPU; there is no pixel readback. Source
UV transforms, repeated UVs, paint alpha, per-instance palette colors and the
vertex-color/lighting switches remain active. Each array layer has independent
mipmaps. Arrays use the maximum source width/height within a group, with no
intentional downsampling. Per group limits are 16 layers, 2048 pixels per axis
and 16 million pixels; total live array storage is bounded to approximately
256 MiB. Oversized groups retain their source parts. The report shows live
prepared parts before/after and estimated array bytes (including mipmaps).

Geometry/materials are prepared per render model, not as every possible complete
CFG building plus signage combination: external advertisements remain shared
independent instanced resources. Transparent/cutout surfaces, authored-lightmap
materials, extra texture maps and incompatible render states remain original.
This does not force storefront glass to opaque or enable cubemap effects. The
common standard shading path still receives generated static shadows and fog.
Repeated instances of the prepared model share its merged geometry and material.

Measured prototype comparison on the recorded 60.3 s City route, render mode,
1280x720, all object categories shown, generated LOD/static merge/cached cells
and dynamic shadows off, dynamic lighting/vertex colors/static bake on:

| Metric (whole route) | Original materials | Unified building materials |
|---|---:|---:|
| Average main draws | 815.45 | 612.08 |
| Average Render CPU | 9.61 ms | 8.44 ms |
| Average callback CPU | 10.97 ms | 9.78 ms |
| Average FPS | 59.04 | 59.32 |
| Frame p95 | 16.9 ms | 16.8 ms |

Reports: `slrr-route-result-1794006509577.json` (original) and
`slrr-route-result-1794007023146.json` (unified), saved in the local Downloads
folder. These are individual runs, not repeated statistical trials. FPS is
near the 60 Hz ceiling; the useful signal here is approximately 25% fewer draws
and 12% lower Render CPU. Unified preparation retained 1635 source parts as 363
merged meshes across the loaded building models, using 45 shared texture arrays
(approximately 89.7 MiB). Coarser merged bounds submitted approximately 3.5% more
triangles on average. Geometry preparation was moved before timed playback after
an earlier lazy-preparation run produced additional stalls.

### Global facade batches (CPU-overhead experiment)

`Global facade batches` builds large static geometry across all prepared facade
models and their placements, grouped by shared texture-array material and render
state. It requires and automatically selects `Unified building materials`.
Both preferences persist in browser localStorage. Re-enter the map, refresh the
page or rerun the benchmark after changing them.

Preparation expands source instance transforms and palette colors into vertex
data once before map loading completes. The runtime does not select, compact
or upload individual compiled facade instances; it tests only the complete
merged batch bounds. Unused global batches detach from the scene hierarchy.
Off-screen batches whose bounds overlap the static-shadow range remain as
auxiliary casters. This intentionally draws additional off-screen/distant
triangles to reduce main-thread submission work. It is not occlusion culling.

Only supported opaque surfaces already using unified building materials are
compiled. External signage, transparent/unsupported surfaces, roofs in ground
geometry and the rest of the map retain ordinary streaming. Whole source models
remain as fallbacks when preparation limits are reached. Each output batch is
limited to 250,000 vertices; total expansion is limited to four million vertices.
There is no spatial subdivision in this first experiment. Source material and
texture ownership remains with pinned original models until map disposal;
compiled geometry is separately owned and disposed before those sources.

The report lists source parts/copies, output batches, visible batches, cached
triangles, geometry bytes and uncombined sources. Route results record
`global_facade_batches`. Compare this switch on/off with unified materials on
in both runs, equal viewport and lighting settings. A lower draw count is not
by itself a faster frame: this mode intentionally trades CPU overhead for extra
geometry processing and higher memory residency.

Initial global-facade comparison: the same recorded City render route at
1920x945, unified building materials on in both runs, all object categories
shown, cached object cells/static merging/LOD/occlusion/dynamic shadows off,
static bake/dynamic lighting/vertex colors on. Reports were downloaded locally
as `slrr-route-result-1794009136296.json` (global off) and
`slrr-route-result-1794009234825.json` (global on).

| Whole-route metric | Global off | Global on |
|---|---:|---:|
| Average draws | 633.44 | 583.80 |
| Average triangles | 248,797 | 903,146 |
| Render CPU mean | 9.55 ms | 9.34 ms |
| Render callback CPU mean | 11.01 ms | 10.77 ms |
| Average FPS | 59.82 | 59.93 |
| Frame p95 | 16.8 ms | 16.8 ms |

Preparation combined 363 source parts / 3526 placed copies into 45 batches,
721,020 cached triangles and approximately 85.5 MiB of additional geometry
buffers. No source models hit the expansion limit. The approximately 0.21 ms
CPU difference is small and needs repeated trials; this run does not establish
a substantial speedup. Draw submissions decreased about 8%, while submitted
triangles increased about 3.6 times. Keep the switch opt-in for dense-block
inspection and further comparisons. Roofs and other original ground geometry
are outside this prototype's scope.


## Experimental GPU Hi-Z visibility

`GPU Hi-Z occlusion` renders eligible opaque static map instances into a 512 × 256 depth target, reduces depth conservatively with max operations, and tests the full projected bounds of each instance in one fragment pass. RGBA8 Hi-Z levels preserve the exact IEEE-754 float32 bits, with explicit high-precision samplers. Only a small per-ID visibility bitmap returns through a WebGL2 pixel-pack buffer and a fence polled without waiting. Bounding boxes never act as occluders. Cutout/blended surfaces are candidates but cannot occlude other geometry.

The update interval is selectable (1, 2, 3, **4 by default**, 6, 8 or 12 rendered frames). Polling a pending fence each frame does not rebuild the depth pyramid. Matrices/colors are compacted only when a result changes. Full sources remain available for shadows and reflections. The experiment bypasses geometry distance cutoff, Inspect all resident instances and simultaneous CPU ray culling. The independent inspection camera displays primary-camera GPU visibility, while depth tests continue using the primary camera. It currently evaluates InstancedMesh map sources; it does not yet reuse the main pass depth target.

Temporal verdicts are heuristic: camera moves over 2 m or turns over 1.5 degrees are discarded; static-camera verdicts have no fixed wall-clock expiration, as are changed source instance buffers and projection matrices. These bounds and the 0.35 m box expansion do **not** guarantee safe temporal occlusion. The user observed visible-object flicker in the moving benchmark, so this is not a production-quality visibility implementation or a proven optimization.

Debug controls:

- `GPU occlusion debug view`: original depth, each Hi-Z level, visibility bitmap, all bounding boxes, or hidden boxes only. The depth inset uses logarithmic distance over 0–500 m; blue means empty/far depth. Boxes are red for rejected instances, green for visible and gray for untested.
- Selecting a debug view enables GPU evaluation and unchecks `Apply GPU occlusion results`: inspect classifications while all normal geometry remains visible.
- `Apply GPU occlusion results` independently enables/disables actual main-pass compaction. Measurement-only preserves GPU verdicts for inspection.
- `Freeze GPU occlusion depth` pauses further depth/Hi-Z/visibility submissions after the first capture. It does not force stale verdicts to remain applied to a moving camera.
- Debug overlays add work and should be off for timed comparisons.

Route JSON now contains `gpu_occlusion`, `average_occlusion_draws`, `average_total_draws` and `average_total_triangles`. Existing `average_draws` remains the main render submission count. `GPU occlusion CPU` includes depth rendering, reduction, flag readback and compaction; compare it **together with** `Render CPU`.

Same route `slrr-route-1793976228048.json`, 1920 × 945, optimized profile, unified building materials on, global facade batches off, dynamic shadows off, all prop categories shown:

| Run | Main draws | Total draws including occlusion | Render CPU mean | Occlusion CPU mean | Callback CPU mean | FPS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Off, `slrr-route-result-1794053354510.json` | 633.4 | 633.4 | 9.69 ms | 0.004 ms | 11.26 ms | 59.83 |
| Every 4 frames, `slrr-route-result-1794053596865.json` | 583.5 | 639.0 | 9.56 ms | 1.56 ms | 12.62 ms | 59.82 |

Thus fewer main draws did not reduce total CPU time: the separate depth pass consumed the saving. Image correctness also failed during motion, so this pair cannot establish a successful optimization. Earlier every-3-frame runs (`1794052901464`, `1794053103661`) varied substantially in timing and also did not show a reliable net gain. Typical readback latency was one frame; reported lifetime maximums can include map preparation stalls. Debug captures at route time 18 s: `slrr-route-frame-18-1794053912148.png` (depth), `slrr-route-frame-18-1794053958047.png` (boxes), in Downloads.


### Depth-source selection correction

The first prototype incorrectly required each depth occluder mesh to be at least 3 m high and 4 m wide. That admitted opaque tree trunks/branches while excluding flat roads and small wall sections, creating artificial holes in the depth image. This selection is removed. Map loading now tags render parts with `mapOcclusionRole`: terrain surfaces, uncategorized static structures, or categorized props. Only opaque terrain/structure surfaces write occluder depth; trees, poles, bins and other categorized props remain visibility candidates. The role is preserved through streaming, cached cells, static merging, LODs, chunks and global facade batches. Real alpha-cutout/blended materials remain excluded as occluders; geometric openings are not filled with invented box geometry. Diagnostic counters distinguish terrain and structure depth batches from excluded prop batches. Earlier benchmark results above predate this correction and must not be treated as validation of the new policy.


Visual verification after the correction: route time 18 s has continuous road depth without tree trunks (`Downloads/slrr-route-frame-18-1794054873533.png`), and 60.3 s has continuous road/facade coverage (`Downloads/slrr-route-frame-60.3-1794054923549.png`). At 60.3 s the diagnostic census was 143 terrain batches, 137 structure batches and 37 excluded prop batches. Actual culling remained disabled for visual verification; this does not establish that moving-camera flicker is fixed.


### Inspecting primary-camera GPU visibility

The independent inspection camera no longer disables GPU occlusion. Depth rendering, box projection, temporal validity and readback always use the primary camera; the observer only changes the displayed viewpoint. Thus moving the observer does not invalidate primary-camera verdicts. World-space diagnostic boxes are drawn with the observer view, while depth visualization uses near/far saved with the depth capture, including when frozen. The report identifies `visibility_camera: primary`, `observer_view` and `bypassed`.

To inspect missing geometry from above, enable GPU Hi-Z and Independent inspection camera, keep Inspect all resident instances off, and enable Apply GPU occlusion results. To inspect classifications without hiding objects, choose Hidden boxes only (which unchecks Apply) and inspect the red boxes. Inspect all resident instances intentionally bypasses occlusion so it can reveal the complete resident set.


Route playback now has a `Loop` checkbox. Completed laps repeat without reloading the map or recreating prepared render batches. Reports contain `lap` and `looping`; Download benchmark report returns the latest completed lap, while measurements reset for the next lap. Only the first lap has the three-second warmup. Physics modes reset vehicle state/clock and checkpoint counters; a free-physics drift abort stops rather than looping a failed run. Stop or Preview frame stops repetition. Toggling Loop off lets the current lap finish.

Manual inspection-camera selection is preserved during playback and after Preview frame/route completion. Recorded primary camera poses still drive streaming and GPU visibility. Reports mark `observer_override` when the displayed viewpoint has been manually overridden, so such measurements can be distinguished from the recorded-camera baseline.


Browser verification: original 60.3 s route repeated automatically beyond lap 2; downloaded `slrr-route-result-1794056163593.json` reports `lap: 2`, `looping: true`, `observer_override: true`, GPU `visibility_camera: primary`, `observer_view: true`, `bypassed: false`. Preview then stopped looping at 60.3 s while retaining the independent observer. Capture `Downloads/slrr-route-frame-60.3-1794056188570.png` shows the observer looking down at the car while the depth inset remains the primary street view. Build and 476 tests pass.


### Visibility continuity across GPU updates

A fixed 100 ms expiration previously reset valid masks before a new result arrived at 12-frame intervals (~200 ms at 60 FPS), causing periodic visible/hidden flicker even with a stationary camera. Static-camera masks now remain applied while the next GPU result is queued or pending. Fence completion replaces the mask; a submission, slow readback, or wall-clock age alone does not clear the current mask. Camera/projection changes, explicit bypass and genuinely changed geometry still invalidate unsuitable results.

Streamer compaction previously also discarded every verdict when buffer slots changed. Unchanged placements now retain verdicts by their exact instance matrix within the same geometry/material/world frame, including when reordered; new placements start visible. Stream revisions reconcile masks before main rendering, even while an older GPU ticket is pending. Old ticket slots are never interpreted as the new layout. The primary-camera basis advances only when a complete matching ticket is consumed.

`GPU applied visibility (last 120 main frames)` reports the minimum/maximum number of actually culled instances, including source-key guards, to expose temporary gaps that a single hidden-instance counter may miss.


Browser continuity check: fixed route preview at 60.3 s, interval 12, Apply results on. Two successive observations reported 600–600 actually hidden instances over the latest 120 main frames, with 54 whole draws culled and no WebGL errors. Capture: `Downloads/slrr-route-frame-60.3-1794057307563.png`. This checks absence of periodic mask resets, not correctness of every individual hidden verdict. Build and 478 tests pass, including pending-fence retention and streamer slot-reorder regressions.


### GPU depth precision regression

Visible foreground objects were incorrectly culled on the real GPU. A synthetic scene reproduced this without game assets: a wall 100 m from the camera hid objects at 30 m with camera near planes 0.01 and 0.1 m. Numeric GPU probes measured the wall Hi-Z value as 0.996093750 instead of 0.999902010 (`near=0.01`), which placed the wall in front of those objects for the visibility comparison. The failure was in the fractional-depth RGBA8 storage path; declaring high-precision samplers alone did not fix it.

The pyramid now stores float32 bit patterns as four RGBA8 bytes via `floatBitsToUint`, and restores them with `uintBitsToFloat`. Sampling uses explicit high precision. This preserves depth through every max-reduction level instead of losing the fractional channels on the tested GPU path.

Open `/tools/gpu-occlusion-check.html` with the Vite server running for a real WebGL regression test. It tests front objects, near-ground objects, objects behind a wall, objects outside the wall silhouette, center/partial visibility through a wall opening, and near-plane crossings, at near planes 0.01, 0.1 and 1 m and large world coordinates. The original solid-wall test failed 4/15 checks; the corrected extended test passes 42/42. It displays numerical GPU box/Hi-Z depth probes. These probes use synchronous readback only in this standalone diagnostic page; the game's visibility path remains asynchronous.


Post-fix city check at route time 60.3 s, interval 12: Apply off capture `Downloads/slrr-route-frame-60.3-1794058812920.png`, Apply on `Downloads/slrr-route-frame-60.3-1794058860066.png`. RGB comparison differs at only two pixels out of 1,814,400; visible foreground street furniture is retained. Diagnostic count is 494–494 actually hidden instances over the last 120 frames, 35 completely hidden draws, with no WebGL errors. The same old pipeline had incorrectly removed foreground street furniture. Build and 478 Node tests pass in addition to the 42-case real-GPU fixture.


### Transparent double-sided material continuity

A second intermittent-mask cause was `Material.version` in the source compatibility key. Three.js increments that version during its normal back/front render passes for transparent DoubleSide materials, even though the restored material state and geometry are unchanged. This incorrectly rejected masks and pending results between Hi-Z updates. Visibility keys now compare material identity and actual depth/geometry-related state (side, alpha/depth/clipping/displacement settings), not shader compilation versions.

The real-GPU fixture now samples every frame from 24 through 60 with interval 12, uses shared opaque and shared transparent DoubleSide materials, and fails if expected visibility changes during that window. Before this correction it passed 72/84 checks, with all 12 failures involving hidden transparent objects incorrectly remaining visible. Afterward it passes 84/84. A Node regression also simulates repeated back/front shader recompilation while verifying that actual depth/opacity/matrix changes still invalidate the key.


Live city verification for the material-version correction: primary route pose 60.3 s, independent observer on, hidden-box overlay on, Apply on, interval 12, dynamic shadows on. Two observations reported 499–499 actually hidden instances across the latest 120 main frames, with no WebGL errors. Capture: `Downloads/slrr-route-frame-60.3-1794060315324.png`. Build and 479 Node tests pass; the real-GPU per-frame fixture passes 84/84.
