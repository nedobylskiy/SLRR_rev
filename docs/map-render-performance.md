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
