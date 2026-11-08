# Deformations and destructible fastenings are the basis of physics

Owner's Clarification: The most important part of the SLRR is deformable parts, body shape changes and parts breaking off. The suspension and ride must work together with this mechanism. One rigid car with visual damage animation does not fulfill the requirement. The current driving demo checks input and transforms; it does not specify the architecture of the future solver.

## What was found in the reverse

Checked local snapshot [EliasFD3S/slrr-reverse](https://github.com/EliasFD3S/slrr-reverse/tree/5c42f3b139aef4c7b9e0b6420c5704e22c0e6cd7), commit `5c42f3b139aef4c7b9e0b6420c5704e22c0e6cd7`. This is a 3rd party reconstruction, not original Invictus source material. It was not built here and its compliance with EXE behavior was not tested. Comments with addresses refer to the author's binary; the match with the provided EXE must be set separately.

|Plot|What's Really Visible|What doesn't this prove?|
|---|---|---|
| [Resources_part4.inc, physics_integrate](https://github.com/EliasFD3S/slrr-reverse/blob/5c42f3b139aef4c7b9e0b6420c5704e22c0e6cd7/engine/Runtime/Resources/Resources_part4.inc#L150) |Accounting for physical bodies, gravity, Euler integration, simplified contacts; lines 196 and 231 clearly indicate the absence of the original constraint solver|Availability of restored deformation/fracture solver|
| [Part.cpp, getSlotDamage/setSlotDamage](https://github.com/EliasFD3S/slrr-reverse/blob/5c42f3b139aef4c7b9e0b6420c5704e22c0e6cd7/engine/Runtime/Parts/Part.cpp#L632) |Analysis of native calls and six pose values of a damaged mount; host stores them in g_slot_dmg|Calculation of damage from impact and plastic deformation of the material|
| [Part.cpp, getTear/setTear](https://github.com/EliasFD3S/slrr-reverse/blob/5c42f3b139aef4c7b9e0b6420c5704e22c0e6cd7/engine/Runtime/Parts/Part.cpp#L127) |Scalar of the part state and information about the field of the old native object|Full deformed mesh or physical structure of the part|
| [Resources_part2.inc, PHYS](https://github.com/EliasFD3S/slrr-reverse/blob/5c42f3b139aef4c7b9e0b6420c5704e22c0e6cd7/engine/Runtime/Resources/Resources_part2.inc#L765) |Partial analysis of physical chunk structures and coordinates|The established topology of the deformable mesh and the laws of its motion|

In original Java, native API controls and state saving are available; solver was not found in these Java sources. In CFG you can see body shapes, deformable, damagedef, slotdmgmode, slotdeform, damage/intdamage. Their presence indicates the directions of research, but does not reveal the exact equations/units/flags. You cannot automatically consider CFG slotdmgmode as a break threshold, and all `_phys_*.scx` vertices as ready mass points.

The word Soft in the comments of a third-party host is not evidence of a soft-body solver: there it is also used for simplified replacements of original mechanisms. The criterion is actually implemented calculations.

## Idea of points and connections

Mass points and connections are the meaningful basis of your own deformable model. In the [official description of BeamNG](https://documentation.beamng.com/modding/vehicle/intro_jbeam/) node-beam structure includes the mass of nodes, stiffness and damping of links, thresholds for residual deformation and rupture. Elastic bonds alone are not enough to cause collapse: after the load is removed, they return to shape. It is necessary to explicitly model plasticity and fracture.

**The node-beam device has not yet been proven for the original SLRR.** Visually similar damage is possible with different models. The old algorithm should be examined separately and the suitability of the new implementation assessed separately.

The later [author's working archive](elias-workspace-archive.md) clarifies the boundary: the comments to `Physics_Step` name lists of physical bodies and a solver loop, but `physics_integrate`'s own still replaces the original functions with simplified Euler integration and contacts. Therefore, the archive provides addresses for researching the original solver, but still does not confirm a specific node-beam topology or plasticity law.

## Proposed structure of the new engine

1. The part has a physical frame with masses, velocities, shape constraints/constraints, damping, plastic states, and failure thresholds. Visual vertices are attached to the wireframe; duplicate vertices by materials and UVs do not automatically become independent masses.
2. Slots define local attachment areas. Destructible constraints are created between parts, not just parent pointers. Physical connections form a graph; The installed parts tree remains the logical model of the assembly.
3. After the connection is broken, the separated component continues to move. Position, mass and momentum are conserved; for the rigid component, the point velocity includes v + omega × r. Render, collisions, script ownership and events are updated consistently at the step boundary.
4. Collision backend can help with broad phase, contact requests and the dynamics of hard components. We need an explicit two-way exchange of forces/impulses with the deformable solver. Two independent solvers that move the same geometry do not constitute a valid coupled model.
5. The deformed shape must change contacts. Only deformation of the visible SCX with a constant collider does not satisfy the goal. Suitable collision proxies, self-collision filtering and updating of spatial structures will be required.
6. The state for conservation/network includes nodes, speeds, plastic state and broken links. The old slot-damage blob and the current Part save do not in themselves confirm the completeness of such a snapshot. Requires circuit version and independent recovery verification.

The overall architecture is still being designed. A separate [hood prototype with XPBD, ductility and detachment](hood-prototype.md) has already been implemented. Full car physics and its collision backend have not yet been selected. High link stiffness requires a robust solver and suitable step/substeps; simply increasing spring force can make the system unstable.

## Prototype and further testing

The original hood is already attached to the generated stand, taking into account the position of the slot. Under low load the frame returns to shape; with more, a dent remains; If the strength of the supports is exceeded, the part separates and falls. The nodes collide with the floor. Next, we need precise contacts of a changed shape, two-way exchange of impulses and restoration of the frame from the buffer. Then expand the model to the body, wheels and suspension.

In [assembled vehicle mode](car-crash-demo.md) added stationary obstacle nodes, moving mount targets, and a break link to EngineWorld.detach/PartHost. The separated hood continues its own integration, [collides with the body](body-contacts.md) and transfers momentum to it. The chassis bounces off obstacles, but its dynamics are still flat. Full mount reactions, 3D motion/suspension and snapshots remain future work.

The current scene [Vehicle3D](vehicle-3d.md) already removes the flat limitation: jumps/flips, CFG suspension supports and volumetric frames of other body panels are implemented. The headlights do not deform, but separate like a rigid body. The supporting structure of the chassis still remains a rigid body with a deformable shell; Full prop reactions, self-collisions and snapshots remain the next steps.

The points of the initial collision geometry can be the input for constructing the frame. The connections, mass distribution and material parameters will either have to be reconstructed from additional data/EXE or explicitly generated and calibrated as a new model. The original geometry itself does not uniquely define them.

### Mounted hood under vertical suspension loads

The driving hood retains the 0.12m effective cage depth, while stiffness and yield
strain return to 500000 and 0.012. The recovery change is temporal plasticity,
not an increased yield threshold: permanent beam rest-length creep uses 1/s rather
than the reference 120/s. At 120Hz the old model permanently absorbed all excess
strain in one tick; brief suspension shocks now remain mostly recoverable.
Mass, mount strength and XPBD iteration count are unchanged.

Attached panels wait at least 0.5s and require internal speed below 0.03m/s before
sleeping (loose debris retains its old thresholds). This prevents freezing a still
recovering elastic shape at the first low-velocity point.

Regression cases cover a 1.5m/s vertical hop, settling after the debug reset height,
and severe-impact release/landing. The WASM wrapper blends the binary's plastic
rest-length delta to the configured creep rate before its next upload; its ABI and
velocity reconstruction are unchanged. Other panels default to the original 120/s.
Visual evaluation on different stock cars is still required.

For a new map driving session, settleSpawn initializes rigid-body suspension support
before the first displayed frame. It does not run damage/XPBD ticks or advance the
vehicle recorder clock. This initialization is separate from the hood reinforcement.


The hood uses five support locations: two hinge clamps near its CFG mount, a
central latch at the opposite edge, and two compression-only stops at that edge's
corners. The stops project downward penetration along the current chassis up axis;
they permit upward separation and do not increase attachment break strength.
They have an 8cm lateral footprint and disengage when the hood is released.
This applies only to hood cages, not other body panels. TS and WASM share the
same two stop projections after each constraint iteration, without a binary ABI change.


### Driving helping

DrivingHelping stores brake, steer, clutch and acceleration strengths in [0,1].
Brake, steer and clutch helping are implemented. The Graphics/map debug slider is
labelled `Break helping`, defaults to 1.00 and persists in localStorage. Acceleration helping is reserved and has no effect. Each driving mechanics instance
shares its viewer's settings, so slider changes take effect immediately.

Brake helping is disabled at or below 20km/h and fades in from 20 to 30km/h,
using chassis speed rather than potentially locked wheel speed. Low-speed control
is handled independently by clutch helping. During heavy braking (axis 0.8–1.0), if the engine or driven shaft approaches idle,
brake helping opens the clutch proportionally to the setting. It affects both
native recovered exchange grip and fallback clutch torque. It does not clamp RPM,
restart a stalled engine or change wheel brake force. At 0 the original manual
stall behavior remains. Java controls retain the brake axis in DrivingInput;
older recordings and keyboard input fall back to their boolean brake value.


Steer helping (default 1.00) changes button steering slew rate from the original
2rad/s towards max(0.2, 2/(1+(speedMps/15)^2))rad/s. Strength interpolates the rates.
It does not cap steering angle. Centering/unwinding retains the original rate.
The limit runs at each suspension physics tick, independently of render FPS.
Java Controller bindings distinguish active keyboard steering from mouse/wheel
axes; only button input is tagged steerDigital. The setting is persisted alongside
brake helping. Settings predating the steer control migrate its previously unused
reserved value to the new default once.


Clutch helping defaults to 0.00, with full low-speed weight up to 20km/h and a
fade to zero by 30km/h (absolute chassis speed, including reverse). With little
throttle or braking, it opens the clutch near idle. While accelerating, the clutch
load is limited to available combustion torque and rotational energy above 85%
of idle, allowing a progressive launch without directly overwriting engine RPM.
Native exchange limits grip using its predicted coupled/uncoupled engine speeds;
the fallback limits transmitted torque and applies the same torque to the wheels.
Brake/clutch opening contributions combine across their complementary speed bands.
An explicit clutch pedal always opens the clutch. At 0 the original behavior is
unchanged; no helper starts a stalled engine. The persisted settings migrate the
previously reserved clutch value to the new default once (version 3), preserving
existing brake and steer settings. All three controls update a live session.
