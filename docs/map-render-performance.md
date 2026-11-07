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


Budgeted stream experiment (2026-11-07, after c4225a9): Viewer sets `MapObjectStream.frameBudgetMs=2`. Residency distance scans/sorts and visibility/batch preparation now use persistent fair FIFO queues of model groups, continued by Viewer on intervening animation frames even when the normal stream interval is 100 ms. A normal update schedules new work; continuations do not restart completed groups or activate another batch of 48 placements. A deferred group always evaluates the current focus/frustum, not a stored old camera. Camera movement does not restart pending queues, so groups cannot starve. Approximately 35% of the cooperative budget is reserved for queued residency scans; remaining time goes to drawing. At least one group per nonempty queue is processed to guarantee progress. Groups awaiting a residency rescan cannot be evicted by the unused-model timeout.

Publication is atomic at model-group boundaries: matrix, color, placement IDs, instance counts and bounds are prepared synchronously, then the stream revision is consumed by Hi-Z after the stream callback. Until a group is processed its prior complete render buffers remain drawable. Queues are cleared on stream disposal and remove released types.

The budget is soft, checked between complete model groups. A single huge group, synchronous geometry preparation, disposal or asynchronous loader finalization can exceed it; compiled global-facade updates also remain indivisible. There may be extra CPU overhead from visiting the scene/Hi-Z more frequently and a few frames of visibility latency. Compare real driving recordings before treating the experiment as a win. Direct tooling/tests retain `Infinity` unless explicitly configured; the browser viewer enables 2 ms by default.

New `stream_` trace fields: `continuation_updates_count`, `scan_groups_processed_count`, `draw_groups_processed_count`, `budget_yields_count`, `scan_queue_remaining_count`, `draw_queue_remaining_count`. The last two are queue-size gauges at the end of each update, not cumulative work counts. The live stream line also reports budget and both queue lengths.


Incremental Hi-Z source collection experiment (2026-11-07): stream updates publish a deduplicated mesh change feed with contiguous from/to revisions. Matrix/count/ID publication, cached-cell visibility and global facade primary/shadow-only switching identify changed batches. Normal revision changes update only those sources and their matrices; unchanged sources keep their cached state and verdicts. Removed/hidden batches park their resources, while existing source-disposal listeners handle real unloading. Representation changes explicitly request a full collection; missed notification revisions fall back to full collection as well. Disabled/bypassed Hi-Z can consume notifications safely because revision discontinuity forces a full refresh on return.

A full scene audit remains at each actual depth submission (normally every 12 frames) to catch geometry/material/ancestor changes outside the stream feed. There is no longer a full traversal after every small stream continuation. When revision synchronization already performed a full collection, the same frame skips the redundant pre-submit audit. GPU test cadence and authoritative last visibility masks remain unchanged.

New capture counts `hiz_incremental_collects_count`, `hiz_full_collects_count`, `hiz_changed_sources_count` distinguish incremental updates from audits. Compare `hiz_collect_ms`, `hiz_collect_world_matrices_ms` and `hiz_sources_seen_count` with the previous budgeted-stream recording; the change feed itself is consumed once per viewer frame and is not serialized into the report.


Split Hi-Z pipeline experiment (2026-11-08): the first frame collects sources/packs candidate bounds and submits depth only. A pending `DepthStage` holds the captured view-projection matrix, the original candidate/source/ID/transform-revision mapping and the packed bounds texture. The next frame builds all Hi-Z levels, submits the visibility test against that snapshot and starts asynchronous PBO readback. Stream deltas may update live source/proxy state in between, but cannot overwrite the staged candidate texture or mapping. Camera motion uses the captured projection, never the later camera. The depth target is not overwritten until this generation has completed its test stage.

The last completed shader verdict remains authoritative during both stages and fence waiting; no show-all/reset occurs when starting or finishing a stage. A stage failure cancels the new generation while keeping the last applied mask. Freeze stops new depth generations but allows the already captured stage to finish. Disable/bypass/reset/context loss cancel in-flight stage state according to the existing explicit mode-reset behavior. Requested update cadence is measured between depth starts; a two-frame pipeline imposes a minimum two-frame generation interval. Readback latency stats now include the inter-stage frame delay (frame count starts at depth capture).

New work counters `hiz_depth_stages_count` and `hiz_visibility_stages_count` identify different frames; the existing CPU depth/reduction/test fields remain separately measured. `extra_draws_per_update` includes both frames' submissions. Runtime stats expose `split_across_frames=true` and `pipeline_stage` (`idle`, `depth-ready`, `readback-pending`). Full collection/depth submission can still be individually expensive; this change spreads stages rather than promising a lower total CPU/GPU cost.


Static-shadow invalidation (2026-11-08): cached static shadows now use `MapObjectStream.shadowRevision`, separately from camera-dependent streaming/Hi-Z revisions. Ordinary batches track an order-independent set of nearby placements in the existing shadow reserve; moving a caster between primary and auxiliary batches does not invalidate the bake. Cached cells track reserve membership separately from primary visibility. Hiding/restoring nearby caster categories, reserve membership/range changes, source loading/unloading and representation changes still invalidate. The existing 40 m focus / sun-direction checks and 1 s throttle are retained. This relies on the existing camera-independent nearby caster reserve; distant camera-only submissions outside that reserve do not trigger a bake. New work counter `stream_shadow_invalidations_count` counts reserve-selection changes, not all representation invalidations.

This closes the current optimization pass. The GPU depth pipeline still retains the last completed visibility mask until its staged replacement has finished, and static shadow changes do not alter dynamic shadow rendering or authored lightmap switches.
