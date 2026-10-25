# Elias working archive: what does it give to an independent engine

Retrieved October 24, 2026. Source - archive [SLRR-REVERSE-WIP.zip](https://drive.google.com/file/d/1jBThp7EfOokCvFS4ku7k6HihiGmYl7XP/view?usp=drivesdk) transferred to the project owner, SHA-256 `6bce17950474f4c1244b28efae0b1dbb99c35151094626e1eacd8c04730e5d8a`, size 344,157,522 bytes. This is a snapshot of the researcher's working folder, **not Invictus sources**. The files from the archive are not added to Git: there are game resources, EXE, IDA base, build result and intermediate logs. All paths below refer to the archive root.

In the correspondence, the author says that he started the reverse with version **2.2.1** and wanted to make an x64/DX11 host. The verified archive so far contains x86/D3D9 host; the exact version number of its EXE is not determined from one correspondence and file name.

There are 12,601 entries in the archive: `game/` (9873), `sources/` (1593), `native/` (1101) and `docs/` (22). `native/engine/` contains a C++ host with its own TUFA/TREE, RPAK, native bridge, D3D9 and approximate physics; `native/docs/` stores inventory, addresses and interim reports; `game/StreetLegal_Redline.exe.i64` - IDA analysis database (~56 MB). The latest records verified are dated October 9, 2026. Public [EliasFD3S/slrr-reverse](https://github.com/EliasFD3S/slrr-reverse) publishes the host code under MIT, but not the game assets or the contents of this working folder.

## Binary address compatibility

|Binary| SHA-256 |
|---|---|
|`game/StreetLegal_Redline.exe` from the archive| `16b25cace5313208e5b6f8e149edea5261634f20dc7e45157f8dac0199bfcf24` |
|local Steam `StreetLegal_Redline.exe`| `f44fb88a4335c657e20701cdb84afb8d1d85f7c3aceb93d30113e6e6e44fefc2` |
|sent by `Downloads/StreetLegal_Redline.exe`| `4052c78d499a765f3b063080f836db4ecfbae67d798bf1229b6357a2711afdb8` |

All three are different. Addresses like `0x0044B000` refer **only to the EXE from the archive**. Semantics and structures can be used as hypotheses for our engine, and addresses and offsets can be applied to other versions only after matching functions and layouts.

## Archived reference information

|Region|Evidence in the archive|Meaning for TypeScript host|
|---|---|---|
| JVM/native ABI |`native/docs/abi_bridge.md`: author documents `JVM_RegisterNative` at `0x00416B00`, native call via `CallInfo*` and `JVM_UnboxArg`, four registration locations; `native/docs/native_registry.json` contains 360 entries.|Compare our native contracts by `class + name + signature`; Don't consider ABI to be regular JNI. The number of registered entries is not equal to the number of fully implemented functions.|
|Loading scripts|`native/docs/abi_bridge.md`: `compileSource` searches for `{dir}/src/{name}.java` and `{dir}/{name}.class`, checks magic TUFA; `native/engine/core/Jvm/` contains an implementation of its TREE host.|Useful for load order and opcode coverage of our runtime. This is a third party implementation, not a proof of compatibility of an arbitrary JVM.|
|Wheels and suspension|`native/docs/evidence/wheel_phys_host.json`, `native/engine/runtime/Parts/WheelRef.cpp`: the author restored the wheel table with step `0x2B4`, links to arm/hub/opposite wheel; the source branch allocates the child physical bodies hub and a-arm.|Check our fastenings and kinematics against the original data. The author himself marks the selection of these physical bodies and the full wheel table in his host as OOS: the law of motion is not restored by this sidemap.|
|Wheel damage|`sources/parts/scripts/bodypart/SRC/Chassis.java` calls `getWheelDamage` on save and `setWheelDamage` on load. `native/engine/runtime/Parts/Body/Chassis_part2.inc` provides an overview of the `0x0043D080` / `0x0043D280` functions: active flag, ten number format, position/orientation and additional fields.|For compatible save and network, wheel damage should be considered separately from `Part.condition`. Our source runtime currently wraps this string as an opaque value; a rigorous reconstruction of its semantics remains a task.|
|Physics step|`native/engine/runtime/Resources/Resources_part4.inc` describes the initial `Physics_Step` (`0x004A5190`), the time accumulator, lists of bodies and the solver loop with up to 20 iterations.|Gives entry points for further reversal, but not equations for constraints and plastic deformation.|

**Limit of reliability.** These are the researcher’s statements, supported by the addresses and comments of his reverse; in this work, the original EXE from the archive was not independently disassembled. `native/engine/runtime/Resources/Resources_part4.inc` directly calls its own integration `Soft`: Euler + simplified collisions, without the original `sub_4A3900`, `sub_4A2D10`, `sub_4A2540` and constraint solver. The indicator `96.6%` in `native/docs/progress_global.json` is the author's weighted metric of tasks as of October 9, not a measurement of engine or physics equivalence. In the archive documents there are intermediate numbers 360 and 372 for different native inventories; The specific registry and calculation method should be verified before use.

## Next exact checks

1. Map the functions from `native/docs/` to each local version of the EXE by signatures and calls, then confirm the wheel table offsets and the main branches of `Chassis.forceUpdate` on the desired binary.
2. Check the ten-field wheel damage line on the control save: round-trip, field order, zero flag and influence on the wheel pose. In the existing runtime, do not replace the opaque path until confirmed.
3. Explore the original `Physics_Step` and called constraint functions in the IDA database, separating the original algorithm from the `Soft` replacements C++ host. Only after this we decide which parameters can be transferred to our body and suspension physics.
4. Use native registry and smoke logs as a gap map for the TypeScript host. The architectural goal remains the browser's WebGL engine; C++ host is useful as an independent research benchmark rather than a required dependency.
