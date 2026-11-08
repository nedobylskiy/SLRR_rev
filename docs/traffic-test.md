# One-car traffic graph experiment

On the `traffic` branch, **One traffic Pickup · 15 km/h** in **Graphics / map debug** enables one original `cars/traffic/Pickup.rpk:0x0006` model. The experiment is enabled by default in this branch when a loaded map declares a TRC graph. Maps without road data do not receive a guessed or borrowed graph.

- Spawn is the closest point to world `(0,0,0)` on a connected road. In the installed City this is approximately `(-0.113, 1.004, -0.613)`, road record #2182.
- Speed is capped at **15 km/h** (4.1667 m/s), independent of crossing A/B speed regimes. It uses an arc-length lookup rather than constant Hermite parameter speed.
- Road records are traversed **red → green**: reverse segment order and reverse each segment's parameter.
- On approach (15 m remaining), choose a random connected outgoing branch once. Branches are grouped by their owning path reference so a road with more lanes does not automatically gain more selection weight; then choose an available lane connection within that branch.
- Connections are restricted to road IDs explicitly linked by the same crossing record. A grey lane must meet the incoming road's green endpoint and the outgoing road's red endpoint within 3 cm. This is geometry-assisted interpretation of explicit topology, not global nearest-road snapping or a fully decoded lane-header contract.
- Traverse the selected grey Hermite curve in reverse, then enter the outgoing road at its red endpoint. If no connected exit exists, stop; do not teleport to another road.
- The model uses the original body, hood, lights mesh, rollbar and four inline CFG wheel renders. Wheel spin follows travelled distance. The navigation spline controls position and orientation; a bounded nearby terrain sample places tyre bottoms on the actual road because navigation Y is not necessarily surface Y.

**Restart traffic near (0, 0, 0)** replaces the single test instance. **Inspect traffic Pickup** focuses the independent inspection camera on its current location without changing the primary streaming camera. This is a one-time camera focus, not continuous camera follow. The inspector displays current road/crossing, chosen exit, distance, position and crossings passed.

This is a kinematic navigation experiment: no collision response, damage, yielding, traffic-light obedience, original traffic-native registration or persistence is claimed. Disabled, hidden-tab and scene-change lifecycles stop/release the test appropriately; returning from a hidden tab does not fast-forward the car. Long frames advance at most 0.25 seconds to avoid large visible jumps.

## Validation

- Unit tests: reverse road and crossing traversal; explicit-link restriction despite overlapping unlinked roads; random selection stability during approach; distinct random branches; continuous bounded-speed transitions; stopping at an unsupported exit; bounded long-frame behavior; inline wheel resource/orientation association.
- Local City route check: a 1,200 s simulated run (12,000 × 0.1 s) covered 5,000 m and 36 crossings with no unsupported exit. Maximum displacement per 0.1 s was 0.416667 m, consistent with 15 km/h. The random route can differ on reruns.
- Original Pickup assembly resolved four body parts without warnings. Visual checks use the real city and the same Viewer methods as the app, including the independent inspection camera.
