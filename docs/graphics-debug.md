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
