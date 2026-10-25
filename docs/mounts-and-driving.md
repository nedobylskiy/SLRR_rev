# Mount compatibility and test ride

## Allow mounts

`attach resource slot` requires a connection to a specific resource and slot number. `compatible resource slot` declares **another identity for the current slot** rather than creating a connection. The factory deploys compatible chains, taking into account RPK paths, dependency slots and both slot IDs. Repeated references and cycles are avoided with visited set; expansion is limited to 256 identities. Abstract identity is acceptable without concrete native CFG. RPK superId by itself does not transform one slot into another.

Example from installation: chassis Baiern references `parts.rpk:0x200, slot 1`. `traffic_racer_default_wheel` has a different RID and slot 1 is declared compatible with this type. The steering wheel similarly uses `parts.rpk:0x999, slot 999`. The old resolver only compared direct RIDs and left all five parts unset.

Native `slottype` selects the parent coordinate system **regardless of the slot number**:

|Supported type|Basic pose|
|---|---|
|missing / 0|Root system detail|
| 11 |String `steering` of the current CFG|
| 101, 102, … |Corresponding string `wheel`, index type−101|

Mounting matrix: `frame * slotPose`. Installation: `parentSlotMatrix * inverse(childSlotMatrix)`. Therefore, the local zero slot of the wheel is placed at the specified wheel position, and not at the center of the chassis. The right wheels retain the rotation recorded in slot. The pose in line `render RID x y z yaw pitch roll` is applied separately, after the instance matrix and before the SCX conversion of centimeters to meters. The standard traffic wheel has an additional yaw 3.142 recorded in it; it is also taken into account.

No mesh names, FL/FR comments, 101/999 slot numbers are used as magic positions, brand names or coordinate tables under Baiern. In internal testing, slot ID is specifically distinguished from slottype. CFG also accepts RIDs with the suffix `r` and leading zeros beyond eight hex characters if the numeric value fits in u32: both options are found in the installation.

This is a proven subset of native frames. Types 2xx/3xx for suspension elements, other bone/compound frames and deformation are not yet implemented; An attempt to install a part on an unsupported system fails. `wheelbones` is not considered a complete decoded skeleton. The yaw(Y), pitch(X), roll(Z) axes, YXZ order and translation SCX→meters 0.01 are preserved.

## Checking on original resources

`npm run verify:mounts` creates the first native car record of each selected package, collects stockpart, checks four wheel mounts and steering wheel, geometric centers and radii, then performs acceleration and turning with the same DrivingDemo without a browser.

|Plastic bag|Collected parts|Wheels + steering wheel|Missed stockpart|
|---|---:|---:|---:|
| Baiern | 33 | 5 | 0 |
| Einvagen | 32 | 5 | 0 |
| Duhen | 31 | 5 | 0 |
| Ninja | 29 | 5 | 0 |
| Zed | 26 | 5 | 0 |

The result applies to the selected CFG versions in this installation, not to all mods and vehicle variants. Report: `local/mounts-verification.json`. Synthetic tests check aliases chains, loops, packet/slot ID differences, rotated frame offsets and lack of connection from one compatible.

## Management in an empty world

The **Test Drive** button starts the currently assembled car. If there is no machine, a Baiern example is created. Through "Create in the world" in the RPK inspector, you can select another car. Clicking on a scene returns input focus to it.

- W / ↑ — forward acceleration; S / ↓ - braking to a stop, then reverse.
- A/D or ←/→ — turn; space - brake.
- R — return the car to the starting position and reduce the speed/steering wheel/wheel rotation.
- The mouse rotates the camera; "End Trip" returns the assembly view.

`DrivingDemo` - flat kinematic bicycle model. The wheelbase is calculated from the wheel poses, the radius is calculated from the previous `type ... sphere radius`, the steering limit is calculated from `maxsteer`, and the steering factors are calculated from the wheel parameters. The height and pitch of the chassis are derived from the wheel poses and radii to be placed on the plane. Turning and rotating the wheels, as well as turning the steering wheel, change the instances of the world; The renderer updates the proxy matrices every frame.

Acceleration 5 m/s², braking 9 m/s², speed limits 28/8 m/s and steering animation ratio 14 - **general parameters of the new demo**, not reconstructed drivetrain. Motion resistance is also simplified. This is not native SLRR physics: no collisions, gravity, suspension, tire forces, engine, gearbox and original updatevariables/Controller. The same demo behavior of different trim levels is not considered compatibility of their dynamics.

The calculation is carried out in fixed steps of 60 Hz, regardless of the rendering; headless tests compare different timing frequencies, braking, reverse, reset and remaining tick debt. During a long pause, the UI explicitly pauses the local run, limiting elapsed to 0.1 s; After hiding the tab, time starts again. Blur/visibilitychange clears pressed keys. Exiting the trip and changing the resource removes the handlers, restores the poses, and releases the view.

The next step towards game physics is native lifecycle/constructors and variable WheelRef configuration, then a physical backend with collisions and suspension. The current prototype already allows you to test assembly, transformations, input, and scene updates together.
