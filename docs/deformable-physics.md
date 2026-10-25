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
