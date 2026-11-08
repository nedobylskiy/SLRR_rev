# Physical traffic bot experiment

On the `traffic` branch, **Traffic bot · cruise 15 km/h** in **Graphics / map debug** enables one original `cars/traffic/Pickup.rpk:0x0006`. It starts near world `(0,0,0)` on the closest connected road (City road #2182). Maps without declared TRC road data receive no guessed graph.

## Navigation and behavior

- Roads run **red → green**, opposite stored segment order. At an approaching crossing, choose a random outgoing branch once, then a lane within that branch.
- Connections require explicit road links in the same crossing record and matching grey-lane endpoints within 3 cm. Grey Hermite lanes are also followed in reverse. An unsupported exit stops the bot.
- The spline supplies steering targets. It never assigns the physical body's position during driving or recovery. Progress uses planar projection because navigation Y is not body or road-surface Y.
- `Bot` controls throttle, brake and steering at 60 Hz. Normal target speed is 15 km/h, reduced in turns or behind another car. This is a target, not a hard velocity clamp: slopes and impacts can exceed it.
- An impact enters physical response mode. After remaining nearly stationary for one second, the bot accelerates toward the closest connected road at a target up to 30 km/h. Once close and aligned, it resumes cruise.
- Attempting to drive without advancing for two seconds triggers **3.5 seconds of reverse with full left or right steering**, then another recovery attempt. Waiting behind another car does not count as being stuck.
- The single-car experiment follows and collides with the active player's full vehicle. Multi-bot population management and mutual traffic queries are not yet wired.

## Vehicle, damage and sound

`TrafficVehicle` uses one `RigidBody3D` and four terrain ray springs from the original inline CFG wheels. Tyre forces, wheel steering/spin and suspension movement drive the model. Cruise performs reduced map contact checks; impact/recovery/reverse use all hull corners. The same body, velocity and damage survive mode changes.

Damage uses one coarse 3×3×5 displacement field across the body, updated on impacts. It does not simulate individual panels, mounts or detachment. The collision hull remains conservative and undeformed. This shares the normal rigid-body/contact core, but is not the full assembled-car soft-body solver. `FullVehicleBotAdapter` lets the controller drive an already assembled `Vehicle3D`; original Java Bot/traffic natives and racer spawning are not connected yet.

A quiet positional engine loop uses simplified RPM and a low-pass filter. There are no tyre tracks, smoke or skid sounds. Playback requires a browser audio gesture.

Original CFG lamp resources produce depth-tested flare sprites, including front/roof lamps and rear running/brake/reverse lamps. Running lamps follow night time, brake/reverse follow bot inputs. They create no spotlights, projected beams, gobo, or shadow maps. See [lamp and signal research](traffic-signals-research.md).

Immutable model geometry/materials, decoded engine audio and road curves are cached. New instances clone the scene hierarchy; their body geometry is copied only on first damage. Each instance owns its physics and crush field. Scene changes release instances; Viewer disposal releases templates and audio. Hidden tabs pause advancement without later fast-forward; one update advances at most 0.25 seconds.

## Controls and validation

**Restart traffic near (0, 0, 0)** replaces the test instance using cached assets. **Inspect traffic Pickup** focuses the independent camera once without changing the streaming camera. **Test traffic impact** applies a test impulse. Status includes mode, speed, RPM, road, crossings, damage version and position.

No traffic-light obedience, original native registration, traffic persistence, or full traffic streaming system is claimed.

- Tests cover reverse road/crossing traversal, explicit topology, stable random branch selection, unsupported exits and bounded long frames.
- Bot tests cover stopped-time recovery without teleportation, the 3.5-second reverse maneuver, queuing, physical spring support/driving, impact deformation and independent damage with shared graph data.
- A physical City-graph run on flat test terrain traversed six crossings in 300 simulated seconds, with maximum planar route deviation about 1.5 m and straight-road speed near 15 km/h. This validates navigation/steering, not every real City obstacle.
