# Physical traffic bot experiment

On the `traffic` branch, **Traffic bot · cruise 15 km/h** in **Graphics / map debug** enables the original `cars/traffic/Pickup.rpk:0x0006`. It starts near world `(0,0,0)` on the closest connected road (City road #2182). **Second Pickup · cruise 30 km/h**, enabled by default, adds a second instance 25 metres upstream along the graph. Disable it to return to the single-car experiment; changing it restarts the experiment. Maps without declared TRC road data receive no guessed graph.

## Navigation and behavior

- Roads run **red → green**, opposite stored segment order. At an approaching crossing, choose a random outgoing branch once, then a lane within that branch.
- Connections require explicit road links in the same crossing record and matching grey-lane endpoints within 3 cm. Grey Hermite lanes are also followed in reverse. An unsupported exit stops the bot.
- The spline supplies steering targets. It never assigns the physical body's position during driving or recovery. Progress uses planar projection because navigation Y is not body or road-surface Y.
- `Bot` controls throttle, brake and steering at 60 Hz. Initial target speed is 15 km/h for A and 30 km/h for B. After leaving each crossing, a fresh target is sampled uniformly: 60–100 km/h for gold/pool A, 15–35 km/h for pink/pool B, reduced in turns or behind another car. These are targets, not hard velocity clamps: slopes and impacts can exceed them.
- An impact enters physical response mode. After remaining nearly stationary for one second, the bot accelerates toward the closest connected road at a target up to 30 km/h. Once close and aligned, it resumes cruise.
- Attempting to drive without advancing for two seconds triggers **3.5 seconds of reverse with full left or right steering**, then another recovery attempt. Waiting behind another car does not count as being stuck.
- After a stopped queue or intersection wait clears, each bot samples a fresh **500–1500 ms reaction delay** once. It holds the brake and brake lamps throughout, cancels the countdown if blocked again, and does not delay a car already moving. The delay uses simulation ticks so hidden-tab pauses do not consume it. At STOP/YIELD this is additional to the five-second stop.
- Both Pickups see one another and the active player's full vehicle. Following uses a 3-metre standstill gap plus 1.2 seconds of current speed, the leader's forward speed and a braking-distance constraint. Oriented hull extents define the lane corridor. The faster car slows behind the first and accelerates again when its path clears.
- Each car owns its route cursor and independently chooses crossing exits; B does not copy A's route. Spawn placement walks upstream through explicit lane connections, including crossing curves, instead of projecting an offset onto an arbitrary nearby lane. Unsupported upstream placement reports an error rather than overlapping the cars.
- Cars advance on one shared 60 Hz schedule, with car-to-car contact response each tick. Full population streaming/management remains future work.

## Vehicle, damage and sound

`TrafficVehicle` uses one `RigidBody3D` and four terrain ray springs from the original inline CFG wheels. Tyre forces, wheel steering/spin and suspension movement drive the model. Cruise performs reduced map contact checks; impact/recovery/reverse use all hull corners. The same body, velocity and damage survive mode changes.

Damage uses one coarse 3×3×5 displacement field across the body, updated on impacts. It does not simulate individual panels, mounts or detachment. The collision hull remains conservative and undeformed. This shares the normal rigid-body/contact core, but is not the full assembled-car soft-body solver. `FullVehicleBotAdapter` lets the controller drive an already assembled `Vehicle3D`; original Java Bot/traffic natives and racer spawning are not connected yet.

A quiet positional engine loop uses simplified RPM and a low-pass filter. There are no tyre tracks, smoke or skid sounds. Playback requires a browser audio gesture.

Original CFG lamp resources produce depth-tested flare sprites, including front/roof lamps and rear running/brake/reverse lamps. Running lamps follow night time, brake/reverse follow bot inputs. They create no spotlights, projected beams, gobo, or shadow maps. See [lamp and signal research](traffic-signals-research.md).

Immutable model geometry/materials, decoded engine audio and road curves are cached. New instances clone the scene hierarchy; their body geometry is copied only on first damage. Each instance owns its physics and crush field. Scene changes release instances; Viewer disposal releases templates and audio. Hidden tabs pause advancement without later fast-forward; one update advances at most 0.25 seconds.

## Controls and validation

**Restart traffic near (0, 0, 0)** replaces the test instances using cached assets. **Inspect traffic Pickup** focuses the independent camera once between the cars without changing the streaming camera. **Test traffic impact** applies a test impulse to A. Each car's status includes cruise target, mode, actual speed, RPM, road, selected exit, crossings, damage version and position.

Traffic signals use a shared 10-second green / 3-second yellow cycle, with all other approaches red. Each incoming branch governs all its lanes, and a car already past the entry line continues. A moving driver approaching within 15 metres (or three seconds at current speed) chooses once per yellow phase: 50% brake, 50% a 20% target-speed boost (capped at cruise + 10 km/h). Stopped cars remain stopped on yellow. Following another car still overrides acceleration; red blocks cars that have not entered. Missing-lamp approaches at a regulated crossing use a five-second STOP fallback. Explicit STOP/YIELD fixtures also wait five stopped seconds, without crossing-traffic checks. Stock road-marking identification remains pending; see [signal research and policy](traffic-signals-research.md).

Original native registration, traffic persistence, and a full traffic streaming system are not yet implemented.

- Tests cover reverse road/crossing traversal, explicit topology, stable random branch selection, unsupported exits and bounded long frames.
- Bot tests cover stopped-time recovery without teleportation, the 3.5-second reverse maneuver, queuing, physical spring support/driving, impact deformation and independent damage with shared graph data.
- A physical two-car test checks that the 30 km/h car catches the 15 km/h car without contact, maintains more than 2 m bumper clearance and accelerates above 25 km/h after the lane clears. Navigation tests cover upstream placement across a crossing and independent branch selection.
- A physical City-graph run on flat test terrain traversed six crossings in 300 simulated seconds, with maximum planar route deviation about 1.5 m and straight-road speed near 15 km/h. This validates navigation/steering, not every real City obstacle.

Traffic wheel yaw beyond ±5° activates that side’s original CFG indicator channel (16 left / 32 right), blinking at 1 Hz with 50% duty while physically moving forward. Indicators also work in daylight and do not activate when stopped or reversing. A new indication starts lit, with 0.8 seconds of retention after the wheel angle drops below the threshold. Stock Pickup has only front indicators in its CFG; missing rear indicators reuse rear reverse/running-lamp anchors as amber sprites without changing those channels.

Every 20 simulated seconds, a cruising, forward-moving car rolls a 10% lane-change chance. It selects only the immediately adjacent parallel lane in the same road branch and direction, with sufficient room before the crossing. Nearby cars in the destination corridor prevent the maneuver. The steering target blends smoothly over at least 25 metres (or 3.5 seconds at current speed); no physical body teleport occurs. Turns and lane changes retain normal obstacle following and signal braking.

## Player traffic control

The **Traffic controls my car** checkbox is off by default. Enable it while driving on a map with a road graph. It binds the current full Vehicle3D to the nearest lane without resetting damage, pose or velocity. Bot supplies controls once per existing physics tick; the vehicle’s normal solver, suspension, drivetrain, audio and damage continue. The driver operates gears/clutch/start as needed, obeys the shared signal controller and follows nearby test traffic. Initial target is 25 km/h, then crossing speed regimes apply. Disable the checkbox to return immediately to player input; leaving driving also removes the driver. Original gearbox automatic/manual mode is restored on release.

Crossing speed changes are ramped from the actual forward speed at the exit: the cruise setpoint increases at up to 0.8 m/s² or decreases at up to 1.2 m/s², without overshooting the selected target. Signal/queue/obstacle braking is applied after this cruise ramp and can immediately reduce the desired speed. This policy is shared by traffic vehicles and player-car traffic control.
