# Raycast occlusion experiment

Enable **Raycast occlusion culling** in **Graphics / map debug**. Leave **Geometry
distance cutoff** off for an isolated comparison. Both methods are independently
switchable; raycasting is initially off. **Ray budget (ms)** controls incremental
CPU work, default 2 ms, range 0.5–8 ms. Preparation and indexing can exceed this
soft budget briefly. This is a CPU/GPU tradeoff, not a guarantee of more FPS.

The culler uses the primary perspective camera, never the observer's position.
Centre rays select actual opaque triangle patches using triangle and instance
BVHs. A candidate patch generates a convex occlusion volume from the camera
through its boundary. The **entire world AABB** must fit behind its plane and
inside that volume, with 0.5 m depth and 1 cm edge margins. A centre hit alone
never hides an object. Bounding boxes are not themselves used as blockers.
The ray can consider a surface behind the nearest decorative triangles if that
surface still lies in front of the target and proves full coverage.

Patches include individual triangles, convex pairs and connected coplanar
facades with any number of triangles. A large patch is accepted only with one
closed convex boundary, consistent winding and matching triangle/polygon area.
Holes, multiple boundary loops and concave boundaries are not filled in. This
avoids the old restriction that all samples had to hit one triangle pair even
when a solid tessellated building filled the screen.

Boxes intersecting the primary frustum are eligible, including partially clipped
boxes if the whole box is proven covered. Camera-inside and unproven boxes stay
visible. Near-plane-clipped blockers are rejected conservatively using camera
projection and plane distance. Blockers use visual static-map geometry, not collision
shells. Blended/alpha-cutout/alpha-hashed/displaced surfaces are excluded, as are
morphed geometries and invisible/non-depth-writing blockers. To bound initial
cost, blocker geometry has at most 4096 triangles, at least 3 m height and 4 m
horizontal extent. These restrictions intentionally miss some occlusion.

Geometry BVHs are prepared incrementally. Stationary-camera results are cached.
On camera motion, existing proofs are revalidated against updated occlusion
volumes rather than throwing away every hidden decision. Invalid proofs and
removed/changed blockers restore visibility immediately. Candidate processing is
round-robin: camera movement and new BVHs never restart at the first objects.
Unprocessed cases default to visible. The report shows BVH preparation queue,
rays/tests, processed candidates, hidden instances and retained proofs.
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

The initial implementation at City view `(15, 8, 15)` looking toward
`(0, 15, -40)`, radius 500 m, hid 278 instances: 660 draws / 264495 triangles
became 596 draws / 250772 triangles. The 256px offscreen comparison had no
different color components. This measures submission and visibility, not FPS
on the user's hardware.

A near-wall regression view uses focus `(-35.3, 1.8, -9.6)`, camera
`(-27.3, 4.3, -9.6)` and target `(-35.3, 2.9, -9.6)`, radius 500 m and the
150 m off-screen shadow allowance. The updated method reduced 624 draws /
215395 triangles to 406 draws / 158736 triangles, with identical comparison
pixels. After repeated sub-millimetre camera motion it retained 896 hidden
instances with no changed pixels. Tests also cover tessellated convex facades,
partially clipped targets, silhouette protrusions and connected surfaces with holes.
