# Contacts between the hood and the body and the reaction of the car

Basic flat contact integration is described here. In the current scene, it is expanded to [3D dynamics and suspension](vehicle-3d.md), and the contact surface is updated to take into account the damage and separation of the remaining panels.

In the "Car and Obstacle" mode, the free hood interacts with the original body geometry. The machine receives a contact impulse from the obstacle, and does not simply reset the speed. This is a new native physics layer, not restored by the SLRR solver.

## Geometry

`TriangleSurface` receives original SCX triangles of all visible installed panels, including roof, windows, doors and trunk. Matrices for installing parts, render pose and converting centimeters to meters are applied in the standard way. The tested Baiern yields **5716 triangles**. The hood, wheels and steering wheel are excluded from this surface. Render geometry is used; the original `_phys_*.scx` is not declared to be a restored physical structure here.

The triangles are stored in the chassis system and organized into BVHs with leaves of up to eight edges. The hood assembly is considered as a sphere with a radius of 35 mm. Its previous and current positions are translated accordingly by the previous and current inverse chassis matrices: the moving body also participates in the swept check. A two-way sweep works on faces, and the closest point of the contact shell works on faces/edges. When re-contacting, the entry side is maintained so that a small error within the shell does not push the point through the sheet to the opposite side.

The surface becomes active when the last support is released. An additional check uses the history of the liftoff step itself, before its loss. The shape of the roof and windows has not been replaced by one box that fills the entire cabin. Openings and missing models retain the meaning of the openings.

This is a discretization of the frame: there is no complete sweep of all triangles of the hood itself and a continuous volume of an arbitrary mesh. Individual visual vertices between nodes may locally intersect the surface; thin holes smaller than the frame pitch are not guaranteed. The rotation of the chassis within one substep is approximated by translating the ends of the sweep into two coordinate systems.

## Speeds and impulses

After positional constraints, the node speed is calculated. Restitution of the free hood to the body is 0.18; the rebound is turned off at a closing speed of less than 0.5 m/s for stable rest. Friction is limited by the normal change in speed, coefficient 0.55. For the hood restitution crossbar 0.12. These are prototype parameters, not extracted coefficients of the original steel.

Surface velocity includes translational motion and `omega × r`. The contact pulse of the node is transmitted to the chassis with the opposite sign. The connection is performed sequentially after the frame step, not by a general monolithic solver: it cannot be considered an exact solution of the entire system with a guarantee of energy conservation.

For the car, the mass from the sums of CFG body of installed parts without a separately modeled hood and the approximate yaw-inertia `m × (width² + length²) / 12` are used. When colliding with a crossbar, a conservative AABB check of the main landing gear mesh remains. Normal impulse:

```text
j = -(1 + restitution) × relativeNormalSpeed / (1/m + leverArm²/Iyaw)
```

Chassis Restitution 0.22, at low speeds 0. Displaced impact changes yaw speed. External lateral speed and yaw speed are damped with simplified tire resistance. Gas, brake and steering still use the existing bicycle model; It is a hybrid flat motion with dynamic contacts. The height/tilt of the car is maintained by the reference model: there is no vertical toss, pitch/roll, suspension, flips and full wheel dynamics. The vertical reaction of the contacts is taken by the conditional road. The reactions of the fixed hood supports are not yet fully transmitted to the chassis.

## Observation and verification

“Hood to roof” - diagnostic setup: dropping the car, clearly releasing the same hood and placing it 0.6 m above the roof with an initial downward speed of 1 m/s. The point is selected along the upper horizontal edges. This is not an imitation of separation upon impact: regular runs still tear the fastenings with a calculated load. “Pause” allows you to stop movement and rotate the camera; "Slowdown ×4" maintains a fixed physical step.

In the original assembly, the average speed of the hood after the first impact on the roof reaches **+0.568 m/s** up. After a second, the center of the frame is at a height of **1.522 m**, the top of the roof is **1.482 m**. The hood may then slide down the slope toward the glass and fall to the ground. It is not required to remain on the convex roof indefinitely. On the synthetic flat roof, the rebound and long-term support of all components are separately tested.

`npm test`: 45 tests; The new checks cover two-way sweep, re-contact inside the shell, no contact beyond the edge of the edge, moving body, bounce/support, reverse horizontal impulse to the car, yaw moment and chassis bounce without increasing speed. `npm run verify:crash` uses the original files and saves the scripts and roofDrop in `local/crash-verification.json`. The bodyContacts counter refers to successful node projections in iterations, not the number of individual hits.

Testing the car gives an impact speed of 8.69/48.08 km/h and an initial rebound of 1.91/10.58 km/h respectively. Parking and quickly driving past obstacles does not damage the hood. After a quick hit, the freed instance remains in EngineWorld, PartHost sees an empty slot; physical friction can move the part along with the body, but its matrix does not directly move it.
