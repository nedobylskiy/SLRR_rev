# Engine world: first assembly from resources

The current priority is recreating the engine. The first slice being checked is: RPK type → native car/part CFG → part definitions → world instances → slot connections → SCX/textures → general WebGL scene. The code is in `src/formats/cfg.ts`, `src/engine/world.ts`, `src/render/viewer.ts`.

## Definitions and instances

`PartFactory` resolves RID relative to source package dependency table, reads `native car/part`, CFG and script reference. The canonical key is the normalized RPK path and local ID. The definition is cached separately from mutable instances. The Java constructor is not called yet; the class reference is saved for the next VM integration.

`EngineWorld` owns instances and slot occupancy; `EnginePart` contains the parent, child parts and local matrix. Renderer reads the world, but does not own its logic. The same world is created in Node without DOM, camera and GPU. Math currently uses Three.js. `advance` promotes fixed ticks; There are no physics processors yet.

The installation combines both mounts: `child.local = parentSlot * inverse(childSlot)`. The world matrix is calculated through the parents. Detachment saves the world matrix of the part along with the subtree. Cycles, occupied slots, alien and destroyed instances are prohibited. `dispose` clears the relationships and object table. The WebGL view separately frees geometry/material/texture when changing scenes.

CFG transforms are stored in meters, SCX vertices are converted to them with a coefficient of **0.01**. In `src/engine/model-transform.ts` the render matrix is constructed as `partWorld * scale(0.01)`: the geometry is scaled, not the mount offset. Previously, there was no coefficient, which is why a body measuring 421 units surrounded parts that were offset by only 1-2 units. On Baiern the body dimensions checked are 1.730 × 1.154 × 4.212 m, hood center z=-1.503 m and left door x=-0.745 m. Checking the actual geometry in `verify:world` now protects against repeating this error; the coincidence of slot matrices alone did not reveal this. A separate SCX view still shows the original coordinates with camera adjustments.

## CFG subset

|Team|Current use|
|---|---|
| `slot x y z yaw pitch roll id` |Mount position and number|
| `attach resource slot` |Valid connection of the current slot with a resource/slot of another part|
| `compatible resource slot` |Alternate slot identity, including chains and loops|
| `slottype` |Root/steering/wheel coordinate system|
| `stockpart resource` |Request for a separate copy; repetition means one more detail|
| `deformable`, `render`, `mesh` |External model resolution via RPK|
| `texture` |Saved; individual override is not applied yet|
| `body ... mass shape` |Pose, mass and original shape description are preserved|
| `wheel` |The original pose is maintained; the physical wheel is not created yet|
| `steering`, `maxsteer` |Steering coordinate system and steering limit|

Comments `#`, `;`, `//` are ignored. Repetition and order are preserved. Invalid numbers and duplicate slot IDs are rejected. Unknown commands remain in `unknown` along with the line number. They are **not executed**: compound, bone, wheelbones, flap, deformation, spring, collision and other native commands still require implementation.

`attach` does not create the part automatically. The factory processes `stockpart`, looks for an exact connection on at least one side, checks the namespace of the resource and the availability of a free slot. After successful installation, adds nested `stockpart`. Unresolved details are reconsidered after the appearance of the remaining parents, then issued in the diagnosis. An abstract compatibility RID may not have a specific entry in the RPK: the namespace permission is separate from object loading.

Explicit `compatible` chains are allowed; RPK superId does not replace slot identities. The order of the angles is taken as yaw(Y), pitch(X), roll(Z), YXZ. For the wheels, frames slottype 101 and further are implemented, for the steering wheel - 11; There is no universal bone/compound and suspension frames scheme yet. For the chassis, `deformable` was selected, since the `render` encountered inside the same CFG refers to the steering compound. [Proven Rules, Examples and Limitations](mounts-and-driving.md).

## Tested example

`npm run verify:world` reads Baiern `cars/racers/Baiern.rpk:0x6` and `_main_CoupeSport.cfg`. The setup we tested creates **33 objects**, including body parts, nested door mirrors/glasses, four `traffic_racer_default_wheel` and `Baiern_steering_wheel`. There are no missing stockparts. This is a CFG package, which is different from Java `addStockParts`; the engine and full-fledged physical chassis do not appear in this way.

The additional adapter `stock(..., { mechanical: true })` selects standard parts from the original Java `addStockParts`, resolves their RPK links and places them on the same CFG mounts. For CoupeSport, the result is **72 objects** without warnings; `npm run verify:components` also checks the suspension values and engine composition. This is a selection of source data, not execution of the Java VM or native constructors. See [node description](original-mechanics.md).

The fastening of the hood in slot 601, the finiteness of the matrices, detach/install and world cleaning are checked. Synthetic tests additionally check rotated fixtures, children, loops, ownership, installation order, and dependency namespaces. In the browser, the "Build Baiern" button shows this build; In the RPK native resource inspector, “Create in the world” is available. "Test Ride" includes simplified movement with updated visual matrices. The visual match to the original and the transparency/coloring are not yet complete. Report with local paths: `local/world-verification.json`.

## Next engine slice

Added the first adapter `PartHost`: four native operations bypass slots of the same EngineWorld, without a copy of the tree. The `verify:gameplay` check checks the descriptors against the original Part.class and goes through 33 real parts. The constructors and original game loop are not yet executed. [Workflow for game functionality](gameplay.md).

1. Expand the proven subset of wheel/steering wheel mounts to suspension and other bone/compound frames; the current five vehicles are already assembled without coordinate corrections.
2. Single instance for CFG object and VM Part: call original constructors and native lifecycle. Currently, a separate model `PartAssemblyRuntime` checks save/load; There is no adapter for `EngineWorld` yet.
3. Collision shapes, units and axes; then backend physics, suspension, tires and control input at a fixed step.
4. One map with collisions and spawn, running minimal game logic. After this, the serialization of this world and the network loop.
