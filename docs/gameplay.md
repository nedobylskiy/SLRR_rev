# From resource assembly to game functionality

The current goal is an independent SLRR engine. The closest game result: the car appears on the test site, rests on four wheels, accelerates, turns, brakes and is correctly destroyed/recreated. The installed parts must set its parameters. Career, original interface and multiplayer follow after this cut.

## What you can already rely on

RPK/CFG/SCX and TUFA are readable. CFG has mount poses, `body` with mass and shape description, `wheel`, `spring`, `enginepower`, `brakepower`, `ratios`, `rearendratio`, `maxsteer`. This is input data, not a ready-made physical model: some of the commands live in compound/bone frames, parameters are changed by scripts. SCX→CFG scale 0.01 has already been tested on Baiern body and parts.

Baiern is now assembled according to CFG `stockpart`: 33 objects, including four wheels and a steering wheel. **This package is not a car from Java `addStockParts`.** In the latter, the engine, suspension, springs, shock absorbers, brakes, wheels and tires are separately selected, with options according to Descriptor. The visible vehicle does not yet confirm the presence of a working physical chassis or power plant. Added [test drive](mounts-and-driving.md) with simplified movement, without the original drivetrain and collisions.

[Baiern stock adapter](original-mechanics.md) is now available in the 3D booth: 72 installed objects, real RPK/CFG links and numerical suspension/engine parameters. It selects limited Java branches without executing the full game script. The regular Test Drive remains simplified.

The original `Chassis.updatevariables()` receives `WheelRef` and bypasses the installed parts through `partOnSlot`, calling them `updatevariables`. Wheels and suspension have native setters for radius, width, grip, spring, damping, travel, braking and drive parameters. The scripts contain a significant part of the configuration calculation; the native layer must store the result and perform the simulation.

## Spaces and tested results

|Stage|What is required|Readiness criterion|
|---|---|---|
|1. Complete design| `compatible`, resource/slot aliases, `slottype`, compound/bone/wheel frames, render poses |The steering wheel, wheels and tires are on the correct mountings; there are no manual coordinates for a specific car|
|2. Single copies|GameRef create/destroy/parent/command, ScriptObject ↔ EnginePart, changeable settings and slots|The script sees exactly the created CFG machine; installation/removal is immediately reflected in its bypass|
|3. Launch configuration|Constructors, inheritance, fields/static init, arrays, resource literals, casts/instanceof, required collections|The real `addStockParts` and `updatevariables` are executed; a report of missing natives is generated|
|4. Collisions|Analysis of body shapes and their frames, physical body, mass/center of mass/inertia, surface|The body interacts with the platform, does not fall through and does not receive the wrong scale|
|5. Automotive physics|Four pins, suspension travel, spring/damper, longitudinal/lateral forces, brakes, engine/gears|Acceleration, braking and turning are reproducible at a fixed step; replacing parts changes parameters|
|6. Game loop|Gas/brake/steering wheel/gears, camera, spawn/reset, synchronization of visual objects|Driven machine; the same run of inputs gives a reproducible result without rendering|
|7. Game development|One original map, garage and tuning, UI/sound, world preservation|Complete local script; then network, reconnect and restore the machine|

For the first physical run, your own test site is enough. Decoding embedded POLY/PHYS original traces is a separate task; it should not block testing of the suspension and steering. The full native API also does not need to be implemented at once: priority determines the execution of the selected script, an unknown call should produce a diagnostic error.

The choice of physical backend has not yet been made. We need a portable backend suitable for the browser and Node without rendering; it should be tested on the WheelRef contract, units and repeatable scenarios. An exact match of the old behavior will require comparison with the game: Java declarations alone do not reveal the native tire/contact solver. Moving a body by pressing a key does not replace this layer.

## What is done in the next step

`src/engine/part-host.ts` links script handles to existing `EnginePart` via WeakMap. The second part tree is not created. Implemented four calls via `NativeRegistry` with the exact descriptors of the installed `Part.class`:

| Native |World data|
|---|---|
| `getSlots()I` |Number of CFG slots of an instance|
| `getSlotID(I)I` |Index → ID; index -1 → part's own input slot, 0 if there is no parent|
| `partOnSlot(I)Ljava.game.parts.Part;` |Adjacent instance: child or parent on input slot|
| `slotIDOnSlot(I)I` |Response slot of an adjacent part; 0 for free slot|

After `detach/install` the same handle immediately sees the changed connections. Alien, fake and outdated handles are rejected; arguments and descriptors are checked. Invalid index fails: compatibility of old VM behavior across array boundaries is not declared. Handle currently has a base type of Part; execution of real constructors, subclass fields and inherited dispatch is the next stage of the VM.

`npm run verify:gameplay` checks these four declarations against the local TUFA and traverses the entire actual Baiern CFG assembly **via native calls**, checking the backreferences of each connection. In the installation studied, 33 specimens are visited. These are direct host calls, not execution of a TREE traversal loop. The serialization source runtime remains separate: its host operations are not automatically considered implemented in the CFG world.

## Checking available contracts

The same tool saves `local/gameplay-contracts.json`: paths, SHA256, class names, parent classes and native method descriptors. Game code bodies are not copied.

|Installed class|Own native declarations|
|---|---:|
| `java.game.parts.Part` | 25 |
| `java.game.parts.WheelRef` | 32 |
| `java.game.parts.bodypart.Chassis` | 39 |
| `java.util.resource.GameRef` | 22 |
| `java.io.Controller` | 7 |

This is 125 declarations in the selected five classes, **not the full volume of the engine and not the percentage of readiness**. For example, two `WheelRef.setDamping` have different descriptors and require different adapters. Controller will require the browser input to be mapped to the original control scheme; events and times should also be part of the host lifecycle.

Sources for testing reasoning in your own installation: `parts/scripts/src/Part.java` (addPart/slots), `parts/scripts/src/WheelRef.java` (physical wheel parameters), `parts/scripts/bodypart/Src/Chassis.java` (updatevariables/forceUpdate), `cars/racers/Baiern_data/scripts/src/Baiern_CoupeSport.java` (bundle), `sl/Scripts/game/src/Vehicle.java` (machine wrapper). Declarations must be checked against the class: the version of Java and the installed TUFA may differ.
