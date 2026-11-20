# Background traffic and pedestrian calculations

Traffic navigation/control and pedestrian walking run in dedicated module Web Workers by default. Immutable road/corridor graphs are initialized once per map. Updates carry small nearby-agent body/position snapshots; Three.js scenes, meshes, materials, Java objects and full geometry are never sent per frame.

Traffic driver decisions run at up to 30 Hz: route progress, junction selection, signal policy, following, lane changes, recovery, steering and RPM. The main thread retains the 60 Hz traffic rigid-body/suspension clock, terrain contacts and immediate interactions with the player's car. It applies completed control/navigation snapshots without awaiting the worker. A new collision invalidates an older control reply, and recycling a car gives it a fresh driver identity. The worker consumes the same signal cycle initialization and current simulation time as the rendered signals.

Pedestrian corridor movement, zone transitions, mutual avoidance and car avoidance run in another worker at up to 30 Hz. Rendering blends positions between results. Skeleton animation, streaming/model creation, vehicle contact detection and ragdolls remain on the main thread. Retired/reused actors and actors entering ragdoll reject outstanding movement replies.

Each worker allows only one in-flight update, with no backlog of queued simulation frames. Scene disposal terminates it. Worker creation/runtime/message failures fall back to existing main-thread behavior and are reported in the debug status. An unresponsive worker times out after two seconds; traffic holds its brake if no response arrives for 250 ms. Status lines show `worker · 30 Hz`, last worker CPU duration and round-trip latency. Those durations are separate from main-thread `Traffic CPU` / `Pedestrians CPU` measurements.

This change does not move panel solving, traffic rigid-body physics or ragdoll physics into workers, and does not reduce rendering draw calls. Player-autopilot control remains synchronous with the player simulation.

Validation: `tests/agent-worker.test.ts` covers structured-clone cursor round trips, shared signal timing, lead-car braking, collision recovery, pedestrian state ownership/recycling, queue bounding, timeout/disposal and 30 Hz worker decisions driving a 60 Hz physical car through a junction. After `npm run build`, `npx tsx tools/verify-agent-workers.ts` runs the production worker bundle in an actual separate thread against the installed City's road and pedestrian graphs (25 agents of each kind). This does not measure browser FPS.
