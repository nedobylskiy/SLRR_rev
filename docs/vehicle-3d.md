# Car in 3D, suspension and damage to body parts

**Car and Obstacle** mode now uses `Vehicle3D`. The chassis has three translational and three rotational degrees of freedom, gravity, mass, inertia tensor and contact impulses. Height, pitch and roll are no longer held by the flat model. The old `CarCrashDemo` remains a separate regression implementation; the usual “Test Ride” still uses the same simplified kinematics.

**Stock Build Update:** The current Baiern in the browser scene contains 72 objects, including the suspension and engine. Stiffness and damping are taken from selected original Java scripts and modified by the state of the parts; details and accuracy limits are in [description of standard units](original-mechanics.md). Below is a description of the original 33-part prototype on which the `verify:3d` regression scripts are based.

When the engine state is zero, it is separated with all its attached parts as one solid body. The zero strut remains on the body and frees the wheel. There are two diagnostic buttons in the scene to check this without hitting it.

## What to watch in the scene

|Control|Result|
|---|---|
|Drive 10/50 km/h|Initial speed towards the obstacle; further contact dynamics, deformations and ruptures|
|Body collapse ×0.50–×1.50|Adjustment of the crushing force of the load-bearing body for comparison of repeated impacts; ×1.25 - selected base profile|
|Kick butt|Driving astern at a speed of 50 km/h into the same obstacle moved behind the car|
|Springboard|Drop and drive onto an inclined platform at a speed of 14 m/s; loss of support and landing|
|Side impact|External impulse at a height of 1 m relative to the center of mass; rotation and flip are calculated by physics|
|Roof hood|Diagnostic release of the hood and fall onto the body|
|Part frames|All deformable frames including doors, fenders, bumpers and chassis shell|
|Internal nodes|Hides the body to view the installed suspension and engine|
|Pause/slow down ×4|Inspection; physical step remains 1/240 s|
|W/S, A/D, space; R|Gas/reverse, steering wheel, brake; restoring a complete assembly|

Side Kick does not set a quaternion or flip animation. It applies an impulse `(5m, 2m, 0)` N s with a displacement `(0, 1, 0)` m, creating linear and angular momentum. "Springboard" changes the surface of the road; springs and contact forces give the machine vertical speed. These are reproducible diagnostic statements, not standard driver actions.

The scene runs in real time. Slowdown ×4 is enabled separately. The HUD shows the frame rate and number of panels with deformation calculations active.

The Body Crush slider applies to subsequent collisions and does not recalculate a dent already received. After the change, click "Ride 50 km/h" to compare the result with the same starting speed. It only changes the impulse that is transmitted to the frame of the supporting body; panels, their fastenings and original CFGs remain with the same settings. The selected value is retained when the machine is reset in an open scene.

## Original suspension data

In `cars/racers/Baiern_data/scripts/_main_coupesport.cfg`, `type 10.000 sphere 0.315` and `spring 0.290 0.100 0.050` are written before each wheel. The parser stores the three spring values in the corresponding CfgWheel, regardless of the next type. Positions, radii, steering frames and slottype are used via regular CFG matrices. The original `setSlotPos` struts update the wheel and brake matrices; `bonepos/linked` and the SCX geometry range define the visible axis of the shock absorber. There are no amendments to the provisions under Baiern.

|Wheel|CFG position, m|Radius, m| spring |
|---|---|---:|---|
|Front left| −0.709, −0.590, −1.480 | 0.315 | 0.290 / 0.100 / 0.050 |
|Front right| +0.709, −0.590, −1.480 | 0.315 | 0.290 / 0.100 / 0.050 |
|Rear left| −0.727, −0.590, +1.256 | 0.315 | 0.290 / 0.100 / 0.050 |
|Rear right| +0.727, −0.590, +1.256 | 0.315 | 0.290 / 0.100 / 0.050 |

**The exact semantics of spring in the old solver have not yet been confirmed.** The new model interprets the numbers as nominal length, compression stroke and rebound stroke. The top point of the beam is obtained by raising the wheel position to the nominal length. This is an explicit interpretation of the prototype, and not a proven decoding of the native command. If spring is missing, the explicitly specified model defaults 0.29 / 0.10 / 0.05 m are used.

Four beams are directed along the local bottom of the chassis. For each, the length, compression, point velocity, and spring/damper force are calculated. When turned over, the beams do not create a fictitious support under the roof. Forces are applied with your shoulders, so acceleration, braking, unevenness and impact give pitch/roll.

In the initial 33-part prototype, stiffness was `k = M g / (4 × sag)`, where `sag = min(0.4 × compressionTravel, 0.04 m)`, and damping was `2 × 0.75 × sqrt(k M / 4)`. Installed mechanical parts now use their original `force` and `damping`, scaled by condition. The previous calibration remains for assemblies without those parts. Travel limits and simplified tire friction cap the lateral force at 1.05 times the normal force. This does not reproduce the original Java/native tire, engine, or gearbox modules or independent unsprung-mass dynamics.

Wheel meshes move along the actual suspension travel, spinning and turning through the original slot frames. The installed strut, spring, shock absorber and brake of each wheel follow its travel and rotation as a rigid group, but do not rotate with the tire. The stabilizer is fixed to the body. This visual scheme preserves the deformed mounts, but does not yet model the change in spring length and independent kinematics of the levers. The steering wheel is animated using the CFG steering frame.

## Chassis and collisions

`RigidBody3D` stores the world position of the center of mass, quaternion, linear velocity and angular momentum. The center of mass is estimated by the CFG body positions of the installed parts, inertia is estimated by the size of the main mesh as a box. The contact impulse acts through the complete inverse inertia tensor in the world system. The vertical component is no longer discarded. Angular momentum is integrated into the world system, orientation is normalized.

For the chassis, it uses OBB against obstacles with 15-axis SAT, and for the road, it uses box contact points. Therefore, the car also collides with the floor and the roof. This is a rough collider of the main chassis, not the exact original PHYS structure. The test springboard is a height field with a rise of 0.28 m per meter, in the area x ±1.8 m and z from −4 to −8 m. The reaction of the obstacle and the floor includes normal impulse and friction. The motor does not detect the direction of body speed and does not automatically return it upward.

## Deformable and rigid parts

The standard Baiern assembly includes **13 deformable shells**: a hood, a chassis, four quarterpanels, two bumpers, a trunk, two sills and two front doors. **10 hard detachable objects** include headlights/taillights and windows. Seats, wheels and steering wheel do not automatically become deformable panels. Classification now selects a profile by CFG name; This is a replacement policy of the new engine, not a restored damagedef.

The hood retains the same frame. For the remaining metal parts, a volumetric lattice has been introduced: two Y-layers cover the full height of the original mesh. The vertices are accurately reconstructed from the eight nodes of the cell at rest; the vertical door does not turn into a horizontal flat mesh. The resolution of the hood is 7×9×2, the chassis is 5×7×2, other panels are 4×5×2. Plastic rest lengths retain dents. The chassis has indestructible supports; the rest of the details use destructible constraints and the same EngineWorld.detach. Material/tear thresholds generated: for other panels `max(12000, partMass × 2000)` H per support; the hood in the car scene uses 60 kN. These are not exact measurements of the original steel or bolts. When one support is overloaded, all supports of the part are released simultaneously: the 1/3 or 2/3 condition no longer occurs. The separate hood stand retains its own material profile.

The chassis shell is a damage layer around the rigid body: its gravity is disabled to avoid counting the weight of the chassis twice. The shock impulse is transferred to its frame with a demonstration coefficient. It is not a full-fledged load-bearing node-beam chassis, but now its deformation shifts the installation points of child parts and the upper points of the wheel supports. Chassis shell profile: stiffness 0.9 MN/m, yield strain 0.003; the structural fraction of the shock impulse is transmitted within a radius of 0.65 m, so that the crushing covers the visible edge of the body, and not just one corner node. The four frame supports are located in the central area, so the front and rear can be crushed under a suitable impact. This is a general body tuning, without coordinate corrections for Baiern or specific mods.

The headlight gets a **RigidBody3D** rather than a DeformablePanel. During contact, the fastening load from force and moment relative to the CFG slot is assessed. The model size of the bracket depends on the size of the part; equivalent load threshold 1800 N. Once exceeded, the real fastening is cleared, linear and angular velocities are preserved. The geometry of the headlight does not change: it can rotate and fly out, but not bend. The glass in this prototype also separates entirely, without splinters.

During lift-off, mass is removed from the chassis and its orientation and rotational speed are preserved. The position of the components does not change when the fasteners break: the previous push of the entire panel from the rough chassis box could instantly raise the hood by almost a meter. The translational speed accumulated by the fastening restrictions at the moment of rupture is replaced by the speed of the body at the point of the part. No more than 1.2 m/s is added to it in the direction of the movement lost by the machine (`−` contact impulse); the internal velocities of the nodes are limited, preserving deformation and rotation. A small opposite impulse is transmitted to the body. The loose panels and rigid parts continue to integrate, interacting with the floor/obstacle and the surface of the remaining body. For a separated panel, the rough chassis box is not used: it can overlap with the dimensions of the panel, although its real components are located outside; contact is checked on the original triangular surface of the body. If, upon separation, the assembly is already inside the simplified volume of the body, checking the intersection with the triangles alone will not hold it. Therefore, the position of each unit relative to the outside of the body is remembered at the moment of separation: a temporary restriction does not allow it to go deeper, but does not push out the entire part and is removed after it is removed from the body. It also operates after the part has entered the solid state. The side is determined by the general panel type (hood/trunk, bumper, quarter panel) with geometric choices for other names; This is the approach of a new engine, the original mounts have not been restored. The BVH of the contacts is rebuilt after separation, so the original part location is not retained as an invisible obstacle. Near free panels, the changing shape is updated to 60 Hz, in other cases - to 10 Hz, with a refit of the tree boundaries. One tree serves the hood and other separated parts. There are no contacts of free parts with each other and no self-collision yet.

## Mounts, condition and damaged handling

`DeformedFrame` binds four probes of each CFG attachment to cells of the parent scaffold. Based on their current positions, the position and orthonormal orientation of the fastening are restored. The original slottype/slot/own-slot matrices are preserved; points outside the frame have a correction to their original position, so they are not pulled towards its boundary. The mechanism works for nested installed panels and rigid headlights/glasses. After tearing off, the part matrix becomes independent of the parent.

Wheel hardpoints are also tied to the chassis shell. The residual displacement changes the spring travel, load distribution and support geometry. With the base ×1.25 tested on the original Baiern after a 50 km/h impact, the maximum residual displacement of the frame assembly is about 0.45 m at the front and 0.29 m at the rear. Inspection of the rendered vertices in the outermost 20% of the body shows that their 90th percentile offset is 0.32 m at the front and 0.23 m at the rear; at low speed the frame retains its shape. The test with the same control signals confirms the different trajectories of the whole machine and the machine with asymmetrically damaged supports.

Each EnginePart stores `condition` 0..1, in the interface - 0..100%. Installed panels and hard headlights/glasses separate at zero. The destruction of all supports of the panel transfers its state to zero; the state is also reduced by contact energy and accumulated plastic deformation. For rigid objects it depends on the equivalent load of the fastening. The non-zero state of the headlight is not used to gradually darken its material. Real headlight lighting has not yet been implemented.

**User observation of the original game:** Individual suspension parts visibly misalign the wheels below 10% condition and detach at zero. **Current prototype:** Because control arms, struts, the engine, and internal components are not yet installed as separate simulated parts, each suspension ray has a temporary body-point condition of `max(0, 1 - peakDisplacement / 0.3 m)`. The exact original relationship has not been recovered. Below 10%, misalignment of the wheel axis measured from the deformed frame affects tire-force direction and grip. At zero, that support no longer produces force. Any geometric damage at a body point moves it; this is not a simulation of a missing control arm or strut.

The condition calibration is new. Energy reduces panel condition by `E × share / (mass × 600 J/kg)` and chassis-shell condition by `0.35 E / (mass × 150 J/kg)`. An additional plastic-deformation estimate reaches zero condition at an average link-length change of 40% for hinged panels or 30% for the chassis. The fraction of impact impulse transferred to deformable frames increases from 2.5 kJ of contact energy and reaches its full value at 17.5 kJ; smaller impacts can still affect chassis condition. In the test, a 15 km/h impact leaves the hood attached and slightly damages the chassis, while a 50 km/h impact detaches the hood. The headlight uses the remaining load up to an equivalent 1800 N threshold. These are not original SLRR coefficients. Reset restores condition, mounts, and suspension points. The source-runtime serializer does not yet handle this new condition and frame state.

## Hood contacts and rear impact

For free part contacts, the loader uses the original SCXs specified in CFG `body` with their own poses and centimeter to meter conversions. `nocollision` excludes water/service shell. If a part does not have physical meshes, fallback to its visible geometry remains. This adds real frame and engine bay surfaces that were missing in the previous render-only collider; running the old EXE is not required. The main external collider of the chassis remains OBB for now.

Fixed swept triangle contact: the node stops at the first intersection point of the end triangle. Previously, the end of a long diagonal move was projected onto an infinite plane and could end up beyond the edge of the face. The free panel in solid mode checks all the nodes of its wrinkled shape, and not just the eight corners of the box. Accurate continuous collision of the entire rendered mesh and edge collisions have not yet been implemented.

The contact impulse of the chassis is transmitted to the panels close to the impact site before the correction of the common box absorbs their collision. The distribution weight is determined by the geometric distance to the obstacle, without selecting front/rear part names. Therefore, a rear impact damages the rear, and not only stops the car. A strong rear impact can also tear off the hood due to the inertia of its fastenings.

## Hard part between blows

`PanelActivity` disables the internal link solution until it is needed. The installed panel begins as a solid form, carried by the mounting matrix. After damage, the already dented form is transferred: the positions of the nodes and the plastic lengths of the links are not reset. Each panel's clock continues to tick at the same 1/240 sec increments.

The XPBD solver wakes on an external impulse, a swept-panel-boundary intersection with an obstacle or floor, or a sudden chassis load. Current thresholds are acceleration above 25 m/s², angular acceleration above 10 rad/s², or an estimated centrifugal acceleration `3 × |ω|² > 25 m/s²`. These were not extracted from the original EXE. Gravity and normal suspension operation do not require constant solving of every constraint.

The reverse transition is allowed after a minimum of 0.25 s of active calculation and another 0.2 s with an internal node speed <0.12 m/s, without loading the entire fasteners above half the rupture threshold. The best rigid motion, including rotation, is subtracted from the velocities: a flying or completely rotating part can turn off the deformation without stopping in the world.

The free rested panel receives a RigidBody3D whose bounds enclose the current rumpled shape. Linear speed and rotation are restored at all nodes. Gravity, rotation and contacts continue to work. Contact faster than 2.5 m/s awakens the XPBD before applying a rough rigid box impulse so that a strong repeated impact can deform the panel again. Weak contacts are resolved by a hard proxy: this prevents re-excitation of nodes and spontaneous jumps after landing. For contact with multiple points, the impulses are counted for each, but the correction of the position of the rigid body is applied once according to the deepest penetration: otherwise one panel could receive the sum of identical shifts and “teleport” upward. This is an approximation: the collider between the bounces is a box, not the exact shell of a dent.

Rendering in solid mode preserves the wrinkled geometry on the GPU and only changes the matrix. Vertex/normal recalculation resumes on wakeup or reset. 240 Hz and 12 iterations of connections are maintained; expensive surface contacts are made at iterations 0/4/8/11 and when the supports are released. BVH queries use a conservative cache of candidates in the body system: when the frame moves, new query boundaries are checked, when refit the cache is invalidated. The fasteners are re-interpolated only when the shape changes, and the movement of the separated part does not cause a refit of the remaining body.

A single call to Vehicle3D.advance performs a maximum of eight steps, saving an outstanding time debt. This limits the interface from freezing on a heavy hit without throwing away model steps. If the calculation lags, the HUD shows the delay in milliseconds. The pause does not process the accumulated debt until the pause is lifted. Frame rate alone does not prove that the model is keeping up with real time.

Historical optimization measurement before enabling deformable mounts on the original Baiern: **four model seconds**, only synchronous physics calculation, without loading resources and rendering:

|Scenario|Before, ms|After, ms|
|---|---:|---:|
|Parking| 5065 | 147 |
|Impact 50 km/h| 10371 | 1864 |
|Bounce| 5281 | 439 |
|Coup| 12358 | 2028 |

These are observed measurements on the current computer, not a guarantee of FPS. `verify:3d` stores wallMs, realTimeFactor, p95 and maximum cost per step in a local report; performance is not used as an unstable test assert.

After turning on the deformable mounts, the current measurement of four model seconds: parking 352 ms, frontal impact 2776 ms, rear impact 3023 ms, hood to roof 1181 ms, jump 1017 ms, rollover 2892 ms. In the browser test, a massive rear impact liftoff briefly reduced the frame rate to about 24 fps with a long duration of up to 0.42 s; then the debt was paid off and the frequency returned to 58–60. This heavy mode still requires optimization.

## Verified verification

`npm test`: **67 tests**, including three-dimensional moment, quaternion, SAT, CFG spring, volumetric snapping of a vertical part, static suspension balance, jump, flip, headlight stiffness after separation, tree restoration and independence of the result from the rendering frequency. Sleep/wakeup, refit, diagonal swept contact, original physical CFG meshes, deformable mounts, trajectory change, 10% threshold, function of damaged mechanical components, angular render ID brakes, original `setSlotPos`, `bonepos/linked`, suspension movement with the wheel when the stabilizer is stationary, solid engine separation and wheel release are checked.

The physics session still owns a separate 240Hz FixedClock; the global clock and the future TUFA VM are not yet integrated with this schedule.

`npm run verify:3d` reads the original local installation and checks six scenarios of four model seconds: idle/crash/rear/roof/jump/roll. You can specify one script: `npm run verify:3d -- rear`. Report - ignored `local/vehicle-3d-verification.json`; It also contains the condition of the parts and the displacement of the wheel supports.

|Scenario|Result|
|---|---|
|Parking|4 supports; the height of the chassis origin is about 0.864 m; no dents or separated parts|
|Drive 50 km/h|The front part and chassis are damaged, the hood and headlights are separated; suspension points remain displaced|
|Rear impact 50 km/h|The rear bumper, trunk and chassis are damaged; the positions of the supports change|
|Roof hood|The free hood interacts with the original body physics meshes|
|Springboard, 14 m/s|The maximum height of the chassis origin is 2.444 m; 162 steps without support (0.675 s); subsequent landing|
|Lateral impulse|The vertical axis of the body reaches dot(up, worldUp) ≈ −0.999; the hood separates, the roof shell is deformed|

Reset returns the original poses, shapes, and attachments of existing objects; the number of world details remains 33. The initial resources and installation do not change. These checks do not prove a match with the physics of the old EXE. Saving full 3D state and new wireframes for the network is not yet connected to Part.save/load.
