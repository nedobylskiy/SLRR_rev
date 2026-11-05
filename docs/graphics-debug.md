# Graphics debugging branch

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
