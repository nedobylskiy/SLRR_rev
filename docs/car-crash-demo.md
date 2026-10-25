# Hood on an assembled car: contact and separation

This document describes the original CarCrashDemo saved for regression checks. The current scene uses [Vehicle3D with suspension and other body parts](vehicle-3d.md); its chassis is no longer limited to a plane.

The **“Car and Obstacle”** button assembles a standard Baiern from RPK/CFG and opens a platform with a yellow fixed crossbar. The hood is the same EnginePart instance installed through the original slots. A separate "Hood Test" button still opens the original stand.

## Scene check

- “Ride 10 km/h”: reset and initial speed of the car/hood is 10 km/h. The contact leaves residual deformation, the three supports remain intact.
- “Ride 50 km/h”: the same path at a higher speed; the contact breaks the fastenings. The hood continues to move separately, the car slot is freed.
- “Reset” or R: restoration of the shape, supports, initial position and installation of the same hood instance.
- “Hood on the roof”: a separate diagnostic setup - the same part is released and falls from above onto the roof. Its collision, rebound and possible slippage are calculated by the solver. In this setting, the rupture of the fasteners is specified explicitly, in the races - only by the load.
- “Pause” stops physical time; The camera continues to operate to inspect the contact.
- W/S, A/D, spacebar: manual control, including the ability to drive around an obstacle or move away from a separated part. Input focus - click on the scene; The race buttons themselves return the focus there.
- "Hood Frame" shows nodes/connections through visible geometry. "Slowdown ×4" is enabled by default to consider the impact. It slows down the passage of time, maintaining a physical step of 1/240 sec.

The races only set the initial speed, not the impact impulse/dent/take-off flag. The actual speed when the body stops is slightly lower than the initial speed due to movement resistance; both speeds are visible in the scene. A re-run first completely restores the car.

## Implementation

`CarCrashDemo` combines the existing bicycle kinematics of the chassis and `DeformablePanel` with a common fixed step of 240 Hz. The render does not change dt. This session owns a separate FixedClock; the general world clock for future scripts has not yet been combined with the physical schedule.

The renderer receives the original vertices of the installed hood from the standard SCX loader, converts them into meters with a render pose and binds them to the frame in the local part system. The initial world pose and each subsequent target attachment come from `hood.matrix()`, that is, from the initial slot assembly. There are no separate corrections to the coordinates of the Baiern hood.

`setAnchorFrame` moves constraints targets, **does not move physical nodes**. The nodes follow the moving fixtures through the solver, maintaining their own speeds. At the beginning of the automatic drive, the hood mass receives the same forward speed as the car. When turning, the targets' movement involves rotation. As long as the supports are intact, the damping acts relative to the speed of the targets, not the ground; the free part uses the same weak damping. This eliminates parasitic loading during normal fast driving.

The fixed crossbar is set to AABB at hood height; its coordinates are the same for the renderer and the solver. At each iteration, nodes are checked against the swept segment/slab input in AABB and projected onto the surface. This prevents fast dots from flying through the entire thickness of the obstacle. Contacts and tie constraints together create deformation and reaction of the supports; The same plastic lengths/thresholds are used as in [stand](hood-prototype.md). Without contact, no impact changes in state are caused.

The contact of the chassis with the obstacle is determined by the conservative AABB of the main mesh. Instead of zeroing the speed, the normal impulse is now calculated taking into account mass, leverage and approximate moment of inertia; restitution 0.22 gives a rebound. The displaced impulse changes the angular velocity around the vertical axis. The basic movement from the gas/steering wheel still remains a bicycle model; vertical movement, tilt and suspension are not addressed. More details: [body contacts and recoil](body-contacts.md).

After the last physical support is disabled, **EngineWorld.detach(hood)** is called. Nodes, velocities and plastic state are not recreated or reset. The parent loses the occupied slot entry, ownSlot/parentSlot are cleared; existing PartHost handles immediately see the free mount. The number of world objects remains the same: the hood is not removed and is not replaced with a visual copy.

The free frame continues integration, contacts with the obstacle, the floor and the original triangles of the assembled body, regardless of its transformation. During contact, the speed of the vehicle's surface is taken into account; the return impulse is transmitted to the chassis. For EnginePart.local, the pose is estimated along the center and axes of the deformed frame relative to the original basis. This is an approximate rigid pose; the full mesh and contacts continue to use all nodes. `PanelView` displays vertices in world coordinates; regular syncWorld skips its proxy so the car movement is not applied a second time. When the session ends, the original geometry/normal and matrix buffers are restored, the wireframe line and the obstacle free up GPU resources.

## Results and limitations

`npm test`: 45 tests, including native topology during physical separation/reset, stable handle, driving past obstacles, swept contacts of triangles, panel support/rebound, chassis recoil and the same result at different rendering frequencies. The synthetic flat panel in the unit test uses its own material profile. `npm run verify:crash` additionally tests **original** Baiern SCX/CFG with regular stand profile and roof drop; the results are written to the ignored `local/crash-verification.json`.

|Checking the original assembly|Impact speed|Initial chassis bounce|Supports destroyed|Plastically modified connections|
|---|---:|---:|---:|---:|
|Parking, 6 s| 0 | 0 | 0/3 | 0 |
|Initial speed 10 km/h|8.69 km/h|1.91 km/h| 0/3 | 289 |
|Initial speed 50 km/h|48.08 km/h|10.58 km/h| 3/3 | 730 |
|50 km/h, obstacle to the side|0 (no contact)| 0 | 0/3 | 0 |

In a fast race, the last support is turned off after 0.4333 s model time from the start. The preliminary speed of the nodes together with the machine, the existence of the same object among 33 parts, a free slot through the native API and re-installation without accumulating objects were checked. Transforming the chassis does not directly move the free part; physical contact/friction can drag it along with the machine.

This is an integration prototype of new physics. The material and three physical supports are still generated. Other parts of the body remain rigid, there is no suspension/drivetrain. The free hood to body contacts use node spheres versus triangles; the entire hood visual mesh is not a solid collider. There is no self-collision and contacts of individual free parts with each other. The attached hood is not yet in contact with the body; the mounts do not provide full two-way dynamics. Contact recoil is already in effect, but is limited by the ground plane and yaw. Precise steel/break parameters, preservation of deformed frame and network snapshot are not implemented. The numbers here are not the result of checking against the old EXE.
