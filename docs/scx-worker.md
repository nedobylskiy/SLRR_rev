# SCX parsing worker experiment

Branch: `scx-worker-loading`, based on `physics-frequency-tests` after the rendering optimization pass. The panel-wakeup follow-up remains in the roadmap; it is not changed by this experiment.

Interactive SCX reads use `parseScxAsync`: viewer/map and streamed models, car visuals, file preview, collision geometry, Java cursor mesh and resource-size helpers. They share one lazy module worker for the application lifetime. The synchronous `parseScx` format API remains available to CLI tools/tests and as the compatibility fallback. No LOD setting, physics algorithm, render batching or profiling counter is changed.

The client creates an owned copy of the source byte view before transferring it; callers/asset caches retain their original buffers and offsets. The worker runs the existing parser, then transfers the deduplicated vertex/index/UV/color ArrayBuffers back with cloneable model/material metadata. The main thread still creates Three.js objects, prepares textures/materials and uploads GPU resources. There is no shared mutable parsed-model cache.

Malformed SCX rejects only that request. Worker absence, startup failure, message failure or transport failure switches the client to the synchronous path and settles queued requests using their retained source bytes. The client supports explicit disposal for owned instances; the shared application worker lasts until the page closes and is reused across maps. Existing generation/wanted checks discard obsolete scene results after parsing. Pending old-scene jobs are not individually preempted.

This is a functional experiment without new performance instrumentation or claims of a measured speedup. Validate real driving/loading in the browser before merging. Unit tests cover v3/v4 parity, typed-array transfer semantics, nonzero-offset source views, concurrent reply routing, malformed input, worker failure/fallback and disposal. Vite emits the parser as a separate worker asset.
