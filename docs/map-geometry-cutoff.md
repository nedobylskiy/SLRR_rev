# Geometry distance cutoff

In **Graphics / map debug**, enable **Geometry distance cutoff**. It is initially
off so the original and experimental submission paths can be compared. It uses
the existing streaming radius and primary/car focus, including when observing
through the independent camera. **Inspect all resident instances** temporarily
bypasses both chunk selection and exact pixel cutoff to show what is loaded.

Large static render surfaces (more than 128 m in X or Z) are clipped to a 64 m
XZ grid. Crossing triangles are actually split at cell boundaries. All vertex
attributes, including diffuse UVs, baked UVs, normals and normalized vertex paint
colors, are interpolated. Small surfaces stay intact. Each resulting cell has
its own bounds and instance selection; far cells are not submitted to WebGL.
Distance/frustum selection also applies separately to the original small sections
of a large model instead of relying only on the model's combined bounding sphere.
Near off-screen shadow casters retain the existing shadow-range exception.

Boundary cells use an early fragment discard at the exact horizontal radius.
This hides the part of a boundary triangle outside the circle. Unlike a discard
alone, chunk selection removes whole distant vertex/index buffers from the draw.
The boundary cells still process vertices. Sky and cars are outside this static
map path. Depth/shadow materials retain the selected cell geometry rather than
using a camera-dependent pixel cut, so near off-screen casters continue to work.

The first preparation processes one loaded model per frame. The graphics report
shows its queue and number of chunk batches. Cells are cached while their model
is resident. Switching off restores original geometry and releases inactive
GPU geometry/instance buffers; CPU geometry stays available for switching back.
Eviction releases both representations and their shared materials/textures.
Physics/terrain inputs and original SCX assets are not rewritten.

Geometries with groups or morph targets, and pathological triangles spanning more
than 4096 grid cells, retain their original geometry. The exact pixel cutoff and
per-section selection still apply. More spatial sections can increase draw calls
and CPU/memory cost; this is not a guarantee of higher FPS at every radius.

Validation on the original City at `(-291, 10, 1034)`, radius 200 m, submitted
78151 triangles / 203 draws with cutoff off, and 38474 triangles / 201 draws
with cutoff on. Switching back restored the original counts. A browser render
also checked dynamic shadows and the static shadow bake with the feature enabled.
This measures submitted work; it is not a hardware FPS result. Tests cover area
conservation, negative grid coordinates, all interpolated attributes, unchanged
source arrays, instance palette/matrix compaction, resident inspection, toggling
and shared-texture lifetime.
