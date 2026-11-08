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

DrivingHelping stores brake, steer, clutch, acceleration and ABS strengths in [0,1].
All five controls are implemented. The Graphics/map debug slider is
labelled `Break helping`, defaults to 1.00 and persists in localStorage. Acceleration helping currently emulates launch control without requiring an installed controller. Each driving mechanics instance
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
existing brake and steer settings. All controls update a live session.


Acceleration helping defaults to 0. It temporarily emulates launch control because
stock vehicles do not yet expose an installed launch controller. A fast accelerator
command (>=0.6) in first gear below 2km/h arms it. Driven-wheel slip above 0.15
reduces actual combustion demand, with fast cut and slower recovery. Wheel radius,
drive shares and grounded wheels determine slip. It disarms above 30km/h, outside
first gear, on braking/clutch input or accelerator release. It does not act as
continuous traction control while cruising. No repeated material/GPU work is involved.

ABS defaults to 1, with 0 retaining unassisted braking. It limits only service-brake
angular deceleration above 3m/s, per wheel, targeting a wheel speed of at least 85%
of rolling speed when braking would otherwise cross that point. A wheel already
below that speed gets pressure relief, not artificial angular momentum. Fractional
settings interpolate the intervention. Native and fallback tire paths both apply it;
airborne wheels and the final low-speed stop bypass it. Handbrake demand is separate
from the service brake and is never limited by ABS. Java controls export both axes;
older input recordings retain their boolean/combined-brake fallback.


Control sources keep the service brake and handbrake separate all the way through
DrivingInput, including the boolean `brake` (service brake only). Original Java
ControlSet maps Space to axis 48 and Down to axis 29. Playground keyboard controls
map Space to handbrake and B to service brake; W/S retain directional throttle.
Space does not request service braking, brake helping or brake lights. Rear
handbrake torque bypasses ABS; front wheels remain free. Launch control also
suspends intervention while the handbrake is held.


Handbrake demand remains a 0–1 analogue axis, but actuator effort is capped at
30 percent: effort=clamp(axis,0,1)*0.3. The same scaling applies before the native,
fallback and airborne wheel-brake paths. The simplified driving prototype uses
the same effort cap. Service-brake demand is unchanged. Full handbrake input no
longer implies that a driven wheel must lock against engine/tire torque.


### Persistent vehicle damage

Driving sessions now publish damage to the owning Java chassis before teardown and before `File.open(WRITE)`. This happens at persistence boundaries, not on every display poll or render frame. The snapshot uses attachment-slot paths and resource keys rather than runtime native IDs. It includes part health, attachment transforms and connectivity, local cage node positions/reference targets and relative velocities, plastic beam rest lengths, broken/overloaded mounts, and wheel hardpoint/alignment damage. Lost attachments are removed from the native installed table and Java chassis inventory before its original serializer walks the tree.

The versioned `SLRR_DAMAGE_1:` envelope is carried in an existing non-parent chassis slot's opaque native damage string. The original `Part.save/load` writes and restores it through SDAT; any pre-existing opaque string is preserved inside the envelope. Legacy saves without the envelope continue to load. This is an engine extension, not a promise that the original native game can interpret the new cage payload. SRVS snapshots also accept and validate the same optional `damage` state.

Garage display skins the saved local cage without starting XPBD. Reference SCX positions are retained separately; entering physics restores reference meshes, generates the usual bindings, then restores node/plastic/mount state at the new vehicle pose. Repeated scene changes therefore do not apply dents twice. Replacing a part's mesh through Java repair clears that part's stored deformation. Snapshot arrays are copied, and malformed/version-incompatible cage data is rejected before restoration.

A returning car may have no installed hood or wheels. The full vehicle solver now accepts those assemblies: an absent hood is not a bootstrap requirement, and configured wheel query slots without an installed wheel never generate tire contact or render a replacement. Missing wheel records are not added to the assembly/world or its mass.

Inventory removal transfers the damaged subtree from chassis-relative slot paths to the actual loose part instance. Installing that instance rebases its damage onto the new parent slot; a fresh replacement in the old slot does not inherit dents. Inventory preview selection carries this state through the same assembly projection, and preview geometry applies the saved cage before switching to unlit materials. A loose installed part's own slot is no longer the excluded parent slot, so its existing native damage string can serialize the cage with ordinary inventory `Part.save/load` as well.

Java `Part.repair()` ultimately sends the native `repair` command (the mesh-replacement patch in the installed Java source is commented out). This command now clears saved cage/attachment state and opaque slot/wheel damage for the repaired installed subtree. Reconciliation explicitly clears old `EnginePart.savedDamage` when no damage payload remains, refreshes CFG attachment frames, and restores reference geometry in existing views. Full-car repair excludes detached parts in the inventory; health/tear limits and repair costs remain controlled by the original Java methods.

Permanent deformation now limits part condition using RMS plastic beam strain instead of the old mean-strain/40% linear threshold. The response is calibrated to 50% condition at 2% RMS permanent strain and 20% at 4%; a local crushed region therefore contributes substantially even when the rest of the part is intact. Elastic node motion does not count. This mapping remains above zero by itself, leaving mount failure/detachment to the existing physical criteria. Restored panels reconcile condition immediately even if XPBD remains asleep; normal active solves retain the existing 10 Hz damage sampling cadence.

Vehicle body-panel mount failure loads use a 1.10 multiplier: the hood threshold is 66 kN and other panels retain their mass-dependent thresholds scaled by 10%. This changes attachment strength only; panel stiffness, plasticity, release delay, chassis anchors, and wheel mounts retain their existing values.

Rigid detached panels also resist twisting on the ground. The support patch is approximated from cage points within the existing ground-clearance shell; its RMS radius bounds a torsional friction impulse by the accumulated ground normal impulse and friction coefficient. The impulse cannot reverse the normal component of spin. This prevents a dented hood spinning indefinitely about one support point without adding angular drag in flight. Patch spread is measured relative to a local point to retain accuracy far from the world origin.
