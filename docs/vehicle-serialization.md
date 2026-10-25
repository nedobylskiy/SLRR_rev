# Vehicle status: memory, SDAT and network

The main priority of the project after clarification of the owner: to get rid of the mandatory saving of a live car to disk to transfer its state. According to the owner, a critical failure of the old implementation is due to a leak while saving the car. This cause was not replicated or localized in the current study; libffi errors found are not presented as its explanation.

New contract: **capture at the end of simulation tick → autonomous byte buffer → transport → validate/decode → resource preparation → atomic recovery**. The disk is an optional consumer of the same buffer.

## What is installed according to old Java

`sl/Scripts/game/src/Vehicle.java`: SAVEFILEID_VHC=0x88664422, SAVEFILEVERSION_VHC=5. `Vehicle.save(String)` opens `java.io.File`, writes the identifier, version, chassis name, calls `chassis.save(File)`, then writes statistics. `Vehicle.load` reads in the same order, creates chassis via `Part.createFromFile`, then `Vehicle`, restores statistics and calls `wakeUp`.

After chassis there are eight floats for track records, races_won and races_lost (int), bestNightQM and valid (float). This is confirmed by the source; the location of the start of this statistic cannot be looked up as a fixed offset because the part tree is of variable length.

`parts/scripts/src/Part.java`:

1. Resource ID of the part type and PART version.
2. Texture RID, mesh RID, wear f32, tear f32.
3. Starting with PART version 3 - two lines adjusted position and adjusted orientation.
4. Repeat slots: slotIndex int; damage String; otherSlotID int. If otherSlotID!=0, the installed part is recursively recorded.
5. `-1` completes the slots.
6. The subclass adds its own fields after `super.save`.

In the `Part.createFromFile` loader, the type and version are read, a script instance is created, then its virtual `load` is called. Without knowing the class, it is impossible to determine the length of the additional tail and safely jump to the next node. A flat generic parser of only the base Part will make errors on engines, transmissions, tires and mods.

`parts/scripts/bodypart/Src/Chassis.java` adds its own version 3: number of wheels, damage lines for each wheel (in reverse index order), brake_balance, mileage. During loading it sets `suspend_update`, after reading it calls `forceUpdate`. This is an important benchmark for transactional recovery.

[Elias working archive](elias-workspace-archive.md) contains parsing native `Chassis.getWheelDamage`/`setWheelDamage` for **another EXE**. According to him, the damage activity is stored as a separate bit in the physical record of the wheel, and the line carries ten numbers, including the pose. This is a valuable hypothesis for compatible restore and network; Our limited source runtime so far correctly keeps the string opaque and does not interpret it without checking on the target version.

Linear and angular velocities are not visible in this top-level Java save. An old garage file cannot automatically be considered the complete dynamic condition of a car for a race.

## SDAT - java.io.File container

`src/formats/sdat.ts` reads the envelope without creating native objects or calling old file code. Checked **139 SDAT**, **64 Vehicle v5 headers** and **1562 unsaved resources** records. Their decode→encode is entirely in memory and returns the original bytes byte by byte (`npm run verify:saves`). This is container validation, not decoding all detail fields.

Header 8 bytes: `SDAT`, version u16 0x0100, type u8 (1/2), flags u8. Java payloads start at +8. At the end there is a trailer, which native File opens before giving readInt/readResID to the script.

### Type 2

The last u32 is trailer size without the word itself. Start: fileLength-4-trailerLength.

1. u32 number of unsaved resources.
2. For each: ordinal u32, kind u32, payload size u32; kind=7 has bytes[size] images/textures. Other non-empty kind are not supported and are rejected.
3. u32 number of packets.
4. For each: ordinal u32, string length u32, path[length] with NUL.
5. u32 trailer length.

Type 1: a list of packages is stored before the last two u32s; the last words are remount bytes and pack count.

File numbers - little-endian i32/f32. String - u32 length **with NUL**, then bytes; length=0 means null, length=1 with NUL means an empty string. Unlike CONS, here NUL is included in the length.

The saved RID contains the file-local ordinal of the package at high16. Trailer restores the path; low16 remains the local ID. hi=0/0xffff refers to transient/unsaved resources. You cannot send only runtime RID over the network: on another client, the same integer can mean a different packet or nothing.

`serializeSdat(parseSdat(bytes))` preserves opaque payload and embedded textures without decoding details. This allows an **already received** file to be passed in as a buffer, but does not fix the leakage of the old EXE when it is initially created. There is no statement here about fixing the old EXE.

## New format SRVS v1 - implemented

Code: `src/runtime/vehicle-state.ts`. Pure functions `serializeVehicle(state)` and `deserializeVehicle(bytes, expectedContentHash?)`. Do not use fs, File.open or temporary files, do not hold a link to the original vehicle.

The snapshot includes vehicle ID, tick, content manifest hash, root part ID; transform, linearVelocity, angularVelocity, rpm, gear; list of parts with stable ID, parent ID, slot pair, resource, mesh/texture override, transform, wear/tear, version and JSON script state.

|Bias|Type|Content|
|---:|---|---|
| 0 | char[4] | SRVS |
| 4 | u32 LE |Version 1|
| 8 | u32 LE |Length UTF-8 JSON payload|
| 12 | u32 LE | CRC32 payload |
| 16 | bytes[length] | UTF-8 JSON |

JSON is chosen as the transparent starting format. This is not the final bandwidth optimization. CRC32 detects corruption, **not** authentication. Transport must ensure authorization and integrity. Maximum payload 4 MiB, up to 10,000 parts, limited script data depth; numbers, quaternions, ID uniqueness, single root, absence of cycles and lost parents are checked. A contentHash mismatch is rejected.

64-bit mod values should be represented as strings with an explicit type in their own schema: the standard JSON number does not guarantee precision beyond 2^53-1. Native pointers, runtime object handles, functions, files and GPU objects are not serialized.

`MemoryFile` implements compatible int/float/String primitives in its own buffer. This is a building block for a future implementation of java.io.File on top of memory. The native File set is not yet bound to TUFA VM. The encoding of old strings is currently Windows-1252; unsupported characters are rejected when written rather than silently replaced.

## What is required for a living car

Update: the limited source runtime already executes the original Part/Chassis/Tyre/ShockAbsorber save/load on a synthetic model with memory slots; transactional recovery. [Description and checks](part-runtime.md). This is a separate host model: the adapter to the new CFG world and SRVS is not yet available. Below are the requirements for integrating the common engine.

Capture adapter is not yet available. It should read the entire car model of the new engine at the tick border, include script-defined fields and created liveries, compose a snapshot without references to mutable objects. This codec does not read the old EXE, its heap and private native structures.

Restore adapter is also missing. We need preparation without side effects: check the schema/manifest, allow all resources, allocate nodes, restore links/slots, apply settings without forceUpdate on each field, recalculate physics once, then replace the car in the world. If there is an error, destroy only the prepared resources and leave the old car working.

Be sure to store attachments/damage/tuning/painting and dynamic values separately. The full baseline is transmitted when a machine appears, changes configuration or reconnects. Frequent motion messages should be smaller and refer to the baseline version.

## Memory checks

The test does 1000 decode→encode, checking for no accumulated serializer state and byte stability. This is **not** proof of the absence of any leaks in the future runtime. For the living world we need heap snapshots, counts of objects/bodies/textures, rollback/deletion tests and repeated connect/disconnect tests, and for the old EXE we need an allocation profiler and a reproducible save script.
