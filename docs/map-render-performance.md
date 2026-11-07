# Map render cost

Triangle count alone does not predict frame time. Each submitted material section
is a draw; instancing repeats that section across placements but does not combine
different sections or model types. Alpha cutouts also shade pixels that will be
discarded, and overlapping foliage can shade the same screen area repeatedly.
The current map materials use MeshStandardMaterial, including its lighting work
when the dynamic-lighting uniform later selects the unlit result.

FrameProfiler's Render CPU is elapsed submission time, including possible driver
backpressure. Its GPU timer is asynchronous. These measurements overlap and must
not be added as two serial stages. At 60 Hz the whole frame budget is 16.7 ms.

The static map loader previously created a separate texture Source for every
material section, even when hundreds of sections bound the same DDS file. It now
loads each active texture source once and returns separate Texture clones. Three
shares the WebGL texture for clones with the same Source and sampler parameters;
UV transforms remain independent. Different color spaces/samplers still receive
separate GPU allocations as required. Evicting a map model disposes its clones;
the source leaves the cache when its last user disposes. Scene changes create a
separate pool so outstanding loads cannot populate the next scene's cache.

This reduces duplicate decoding/uploads and GPU texture allocation. It does not
reduce geometry, draw calls, fragment overdraw or shading cost. Consolidating
compatible material sections and reducing distant foliage work are separate
optimizations. Do not infer a specific FPS improvement from resource counts or
from headless software rendering.

Equal opaque map surfaces also share a material, across model types. Previously
every SCX section had a distinct material ID, so Three's opaque sort and material
refresh path treated equal shader/texture state as different. The pool compares
shader variants, primitive material settings, colors, texture Sources, sampling
state and UV transforms. Transparent surfaces and materials holding separate
baked textures remain independent. A streamed model holds one reference per
distinct shared material; only its last owner disposes textures/material.
Lighting and both shadow paths keep their existing independent switches.
Paint-masked surfaces (including city facades) are excluded as well: their
custom paint shader state is not fully represented by standard material fields.
This conservatively restores their original independent material ownership
after a report of missing facades. Shared texture Sources remain enabled.

A fixed original city scene at focus `(-291, 10, 1034)` and range 850 m was
fully loaded before rendering, with shadows and baked lighting disabled. Both
versions submitted 1577 draws / 530711 triangles / 1437 GPU geometries. The
uncached version allocated 1430 GPU textures; shared Sources allocated 136.
The captured viewport pixels were identical. This validates resource sharing,
not the user's hardware frame rate. Unit tests also cover concurrent acquisition,
independent UV transforms, repeated disposal, last-user eviction and load retries.

In the same scene material pooling reduced resident materials from 3049 to 575,
with the same 1577 draws and triangle count. Instrumenting the second, warmed
render counted `uniform3f` calls decreasing from 178 to 16 and `uniformMatrix3fv`
from 96 to 65. These are individual API counters, not total render-time savings.
Viewport comparison differed at 73 of 370540 pixels in one small ground patch;
material sorting changes the order of coplanar surfaces. No geometry was removed.


## Planned Hi-Z caching and profiling

Status: planned, not implemented. A real-driving screenshot showed GPU occlusion CPU at 2.5 ms with a 14.2 ms peak. This timing includes several stages and does not establish that bounding boxes caused the peak.

- [ ] Split CPU measurements into source collection/cache validation, box preparation/upload, depth/Hi-Z/test submission, fence/readback processing and visible-instance compaction. Capture the stages in individual long frames, rather than combining unrelated peak values.
- [ ] Cache the local box per geometry and the expanded world-space box per static placement. Preserve those boxes through streamer slot reordering and temporary removal/re-entry; invalidate only when the relevant geometry or placement changes.
- [ ] Keep a persistent typed-array/GPU texture of placement boxes. Upload new or changed ranges where supported, and send an active-index list when the candidate set changes. Camera motion should update the view-projection matrix, without re-uploading unchanged boxes.
- [ ] Replace placement identities built by serializing matrix values into strings with stable placement IDs supplied by the map/streamer. Preserve identity across compaction and asynchronous GPU tickets.
- [ ] Avoid rebuilding unchanged candidate lists and recreating unchanged depth proxies; reuse buffers and allocations where the stage measurements justify it.

Acceptance: completed shader verdicts remain authoritative until replaced, including interval 12, camera motion, frozen captures, slot reorder and removal/re-entry. Preserve visible geometry, shadows and material behavior. Verify that unchanged candidate sets do not cause box uploads and that camera-only changes do not recalculate world boxes. Compare before/after CPU stage timings and long-frame frequency on the same laptop, route and settings, using equally warmed runs; report streamed/cold runs separately. Do not promise an FPS improvement before measurement.


Hi-Z cache update (2026-11-07): world-space placement AABBs are reused by placement identity across streamer reordering/removal/re-entry, with surface/world-transform invalidation. The candidate list and packed GPU bounds texture are rebuilt/uploaded only when collected sources change, rather than on every depth pass. Pending readbacks retain their own source/slot list. Readback compatibility checks run once per captured source instead of once per instance. Last completed visibility verdicts remain authoritative between passes. Matrix-string placement identities and full candidate uploads on a source change remain possible future costs; this is not yet a stable-ID/partial-upload implementation.


Stable map placement IDs (2026-11-07): every `MapObjectStream.add()` entry now receives a process-local safe-integer ID, even if two entries share coordinates or the exact same input object reference. All parts/LOD/chunks of that entry publish the same ID in their immutable slot mapping; the source mesh provides the part namespace for Hi-Z caches. Cached-cell rebuilds and model reloads reuse the type's placement IDs. Compiled global facade batches receive their own IDs. IDs are session-local and are not serialized into route files.

Hi-Z uses numeric IDs for these sources; matrix-string identities remain only as a compatibility fallback for external meshes lacking a slot-ID mapping. The collected source snapshots its ID mapping and per-placement transform revision for asynchronous tickets. Changed matrices invalidate that placement's world box and verdict; tickets for previous transform revisions cannot overwrite the new state. A material/geometry-source or parent-world-transform change still invalidates the source cache. This change does not yet reuse depth/visible proxies when a source is rebuilt.

Recording counters `hiz_numeric_identity_instances_count`, `hiz_fallback_matrix_identity_instances_count` and `hiz_placement_transform_changes_count` indicate which identity path was used and how many new/changed numeric transforms were cached. The last counter includes first-time placements. These count identity preparation on source changes, not all resident objects per frame. Compare `hiz_collect_keys_identities_ms` alongside `hiz_collect_bounds_ms`; numeric transform validation deliberately occurs in the latter.


Hi-Z proxy lifetime update (2026-11-07): compatible source changes now reuse depth mesh/material/buffers and the visible-instance proxy. Depth matrices and aggregate bounds update only when matrix version/count changes; palette-only changes do not upload the depth buffer. Visible proxies retain their allocation across all-visible/all-hidden masks and are refilled when partial visibility resumes. Sources temporarily absent from collection are parked outside the active depth/candidate scenes and resumed without recreation. The source mesh's `dispose` event and Hi-Z reset release both active and parked GPU resources and remove listeners. Thus resources follow streamed mesh residency, rather than each visibility update. Real surface incompatibility or insufficient capacity still reallocates resources.

Lightweight `Source` records remain immutable snapshots so pending GPU tickets keep their captured ID/transform mapping; the expensive Three.js/GPU objects are reused between snapshots. Depth-only changes no longer invalidate/repack the candidate bounds texture. New capture counts: `hiz_source_resources_created_count`, `hiz_source_resources_reused_count`, `hiz_depth_proxies_created_count`, `hiz_depth_proxies_reused_count`, `hiz_depth_buffers_updated_count`, `hiz_visible_proxies_created_count`, `hiz_sources_parked_count`, `hiz_sources_resumed_count`. Existing `sources_rebuilt_count` still counts refreshed lightweight source snapshots, not GPU object allocation.
