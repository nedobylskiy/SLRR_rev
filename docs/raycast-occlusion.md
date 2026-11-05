# Raycast occlusion experiment

Enable **Raycast occlusion culling** in **Graphics / map debug**. Leave **Geometry
distance cutoff** off for an isolated comparison. Both methods are independently
switchable; raycasting is initially off. **Ray budget (ms)** controls incremental
CPU work, default 2 ms, range 0.5–8 ms. Preparation and indexing can exceed this
soft budget briefly. This is a CPU/GPU tradeoff, not a guarantee of more FPS.

The culler uses the primary perspective camera, never the observer's position.
It samples all eight vertices and the centre of each candidate's world AABB.
Each ray must hit before the target with a 0.5 m safety margin. Hiding additionally
requires every ray to hit the **same convex opaque patch**: either one triangle
or a coplanar pair whose shared edge forms a convex quadrilateral. Nine random
hits across unrelated walls do not prove full coverage and keep the object
visible. Geometry is tested with triangle BVHs and an instance-bounds BVH;
bounding boxes are not themselves used as occluders.

Only fully in-frustum target boxes are eligible. Camera-inside boxes, clipped
objects and unproven cases remain visible. Near-plane-clipped intersections are
not accepted. Blockers use the actual visual static-map geometry, not collision
shells. Blended/alpha-cutout/alpha-hashed/displaced surfaces are excluded, as are
morphed geometries and invisible/non-depth-writing blockers. To bound initial
cost, blocker geometry has at most 4096 triangles, at least 3 m height and 4 m
horizontal extent. These restrictions intentionally miss some occlusion.

Geometry BVHs are prepared incrementally. Stationary-camera results are cached.
Camera/projection or streaming changes invalidate hidden decisions immediately;
unprocessed instances default to visible. The report shows BVH preparation queue,
rays and tests in the last frame, processed candidates and hidden instances.
Partial progress while moving is expected. Use **Occlusion CPU**, main-color GPU
time, draws and triangles to evaluate the result after preparation settles.

Only the main color pass uses compacted visible-instance proxies. They share
source geometry/material and retain original instance transforms and palette.
Unchanged results reuse uploaded instance buffers. Original meshes and matrices
remain intact for dynamic shadows, static shadow captures and reflection views.
The proxies never cast shadows and are skipped in auxiliary passes. Fully hidden
source batches skip color submission. Streamer residency counters therefore do
not decrease; the actual color-pass counters and hidden-instance count do.

The independent observer shows primary-camera occlusion decisions. **Inspect all
resident instances** bypasses color occlusion so hidden source objects can be
inspected. Disabling the method removes proxies and returns original submission.
Eviction and map changes release proxies/BVH listeners without disposing shared
source material or geometry through the proxy.

Validation includes solid walls, misses, mixed blockers, alpha-cutout blockers,
near clipping, camera changes, blocker removal, palette/matrix compaction and
separate color/shadow/capture paths. A WebGL scene with dynamic shadows matched
pixels exactly with the method off/on, including after moving around the wall,
while submitting fewer color triangles. Real City comparisons also check pixel
identity rather than assuming that fewer draws imply correct visibility.

At the fixed City view `(15, 8, 15)` looking toward `(0, 15, -40)`, radius
500 m, the completed cache hid 278 instances: 660 draws / 264495 triangles
became 596 draws / 250772 triangles. The 256px offscreen comparison had no
different color components. This measures submission and visibility, not FPS
on the user's hardware.
