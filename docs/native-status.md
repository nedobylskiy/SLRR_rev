# Java native method inventory

Snapshot: 2026-11-08. Generated from the installed game and current browser host.

1. [Implemented (335)](#1-implemented)
2. [Mocked (32)](#2-mocked)
3. [Not implemented (121)](#3-not-implemented)

Scanned **3047 TUFA files**, **3118 classes**; **0 read errors**. Each overload is a separate row.

| Status | Total overloads | Game native declarations | Host additions |
|---|---:|---:|---:|
| Implemented | 335 | 274 | 61 |
| Mocked | 32 | 23 | 9 |
| Not implemented | 121 | 121 | 0 |

**Status definitions**

- **Implemented**: a host handler provides working behavior. This does not imply full parity with the original EXE. Notes identify partial implementations and browser adaptations.
- **Mocked**: the call is accepted, but its main operation is absent, data is discarded, or a temporary result is returned.
- **Not implemented**: no matching handler exists in the current browser Java host.

**Scope and limitations**

Matching uses class, method and parameter types, including arrays. Short type names are normalized to match host registrations; ancestor handlers are considered. A game declaration is a TUFA method with native flag `0x40`. Host-only overloads are marked separately. Methods interpreted from Java source without that flag are outside this inventory.

This snapshot does not certify algorithm accuracy or cover every game version. Registrations outside the standard boot path and the separate legacy PartHost are excluded. Registration capture runs a synthetic Init rather than a game session. Optional audio/video/render bridges are supplied separately by the application; their absence during capture does not make an implemented handler a mock.

Only names, signatures and relative paths are published; original game files are not copied into the repository.

**Regenerate**

```powershell
npm run report:natives
# Set SLRR_GAME_ROOT to use a different installation.
```

Machine-readable output: [native-status.json](reports/native-status.json). Classification overrides and limitations: [report-native-status.ts](../tools/report-native-status.ts). Update the annotations and regenerate both reports when replacing a mock.

## 1. Implemented

**335 overloads.**

| Method | Implementation | Notes |
|---|---|---|
| `java.game.GameLogic.kismajomCheck(String[]) → int` | [src/runtime/input-native.ts:64](../src/runtime/input-native.ts#L64) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.bodypart.Chassis.forceUpdate() → void` | [src/runtime/chassis-native.ts:175](../src/runtime/chassis-native.ts#L175) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.bodypart.Chassis.getCM() → Vector3` | [src/runtime/part-native.ts:126](../src/runtime/part-native.ts#L126) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.bodypart.Chassis.getMass() → float` | [src/runtime/part-native.ts:124](../src/runtime/part-native.ts#L124) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.bodypart.Chassis.getMax() → Vector3` | [src/runtime/chassis-native.ts:68](../src/runtime/chassis-native.ts#L68) | Uses actual CFG-transformed chassis mesh bounds; original scene-bound/parent-walk padding is not reproduced. |
| `java.game.parts.bodypart.Chassis.getMaxSteer() → float` | [src/runtime/chassis-native.ts:154](../src/runtime/chassis-native.ts#L154) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.bodypart.Chassis.getMileage() → float` | [src/runtime/chassis-native.ts:80](../src/runtime/chassis-native.ts#L80) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.bodypart.Chassis.getMin() → Vector3` | [src/runtime/chassis-native.ts:68](../src/runtime/chassis-native.ts#L68) | Uses actual CFG-transformed chassis mesh bounds; original scene-bound/parent-walk padding is not reproduced. |
| `java.game.parts.bodypart.Chassis.getNitro() → float` | [src/runtime/chassis-native.ts:53](../src/runtime/chassis-native.ts#L53) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.bodypart.Chassis.getSfxTable(int) → SfxTable` | [src/runtime/chassis-native.ts:89](../src/runtime/chassis-native.ts#L89) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.bodypart.Chassis.getTorque(float, float) → float` | [src/runtime/dyno-native.ts:12](../src/runtime/dyno-native.ts#L12) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.bodypart.Chassis.getWheel(int) → WheelRef` | [src/runtime/chassis-native.ts:132](../src/runtime/chassis-native.ts#L132) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.bodypart.Chassis.getWheelDamage(int) → String` | [src/runtime/chassis-native.ts:55](../src/runtime/chassis-native.ts#L55) | Preserves opaque original damage strings; does not decode their original semantics into suspension damage. Host damage snapshots are a separate implementation. |
| `java.game.parts.bodypart.Chassis.getWheels() → int` | [src/runtime/chassis-native.ts:131](../src/runtime/chassis-native.ts#L131) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.bodypart.Chassis.setAckermann(float) → void` | [src/runtime/chassis-native.ts:162](../src/runtime/chassis-native.ts#L162) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.bodypart.Chassis.setCooling(float, float, float) → void` | [src/runtime/chassis-native.ts:47](../src/runtime/chassis-native.ts#L47) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.bodypart.Chassis.setMaxSteer(float) → void` | [src/runtime/chassis-native.ts:156](../src/runtime/chassis-native.ts#L156) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.bodypart.Chassis.setMileage(float) → void` | [src/runtime/chassis-native.ts:82](../src/runtime/chassis-native.ts#L82) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.bodypart.Chassis.setSfxExhaustMinVol(float) → void` | [src/runtime/chassis-native.ts:104](../src/runtime/chassis-native.ts#L104) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.bodypart.Chassis.setSteerWheel(float, float) → void` | [src/runtime/chassis-native.ts:168](../src/runtime/chassis-native.ts#L168) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.bodypart.Chassis.setWheelDamage(int, String) → void` | [src/runtime/chassis-native.ts:57](../src/runtime/chassis-native.ts#L57) | Preserves opaque original damage strings; does not decode their original semantics into suspension damage. Host damage snapshots are a separate implementation. |
| `java.game.parts.DynoData.calcDyno(float) → float` | [src/runtime/dyno-native.ts:29](../src/runtime/dyno-native.ts#L29) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.DynoData.calcDyno(int)` | [src/runtime/dyno-native.ts:29](../src/runtime/dyno-native.ts#L29) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.game.parts.DynoData.deleteNative() → void` | [src/runtime/dyno-native.ts:24](../src/runtime/dyno-native.ts#L24) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.DynoData.getHP(float, float) → float` | [src/runtime/dyno-native.ts:46](../src/runtime/dyno-native.ts#L46) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.DynoData.getHP(float, int)` | [src/runtime/dyno-native.ts:46](../src/runtime/dyno-native.ts#L46) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.game.parts.DynoData.getHP(int, float)` | [src/runtime/dyno-native.ts:46](../src/runtime/dyno-native.ts#L46) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.game.parts.DynoData.getHP(int, int)` | [src/runtime/dyno-native.ts:46](../src/runtime/dyno-native.ts#L46) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.game.parts.DynoData.getTorque(float, float) → float` | [src/runtime/dyno-native.ts:43](../src/runtime/dyno-native.ts#L43) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.DynoData.getTorque(float, int)` | [src/runtime/dyno-native.ts:43](../src/runtime/dyno-native.ts#L43) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.game.parts.DynoData.getTorque(int, float)` | [src/runtime/dyno-native.ts:43](../src/runtime/dyno-native.ts#L43) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.game.parts.DynoData.getTorque(int, int)` | [src/runtime/dyno-native.ts:43](../src/runtime/dyno-native.ts#L43) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.game.parts.DynoData.newNative() → void` | [src/runtime/dyno-native.ts:20](../src/runtime/dyno-native.ts#L20) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.Part.disableSlot(int, int) → void` | [src/runtime/part-native.ts:140](../src/runtime/part-native.ts#L140) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.Part.getCar() → int` | [src/runtime/part-native.ts:255](../src/runtime/part-native.ts#L255) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.Part.getCarRef() → Part` | [src/runtime/part-native.ts:120](../src/runtime/part-native.ts#L120) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.Part.getMass() → float` | [src/runtime/part-native.ts:122](../src/runtime/part-native.ts#L122) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.Part.getMesh() → int` | [src/runtime/part-native.ts:200](../src/runtime/part-native.ts#L200) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.Part.getSlotDamage(int) → String` | [src/runtime/part-native.ts:210](../src/runtime/part-native.ts#L210) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.Part.getSlotID(int) → int` | [src/runtime/part-native.ts:100](../src/runtime/part-native.ts#L100) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.Part.getSlots() → int` | [src/runtime/part-native.ts:98](../src/runtime/part-native.ts#L98) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.Part.getTear() → float` | [src/runtime/part-native.ts:180](../src/runtime/part-native.ts#L180) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.Part.getTexture() → int` | [src/runtime/part-native.ts:196](../src/runtime/part-native.ts#L196) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.Part.getWear() → float` | [src/runtime/part-native.ts:171](../src/runtime/part-native.ts#L171) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.Part.getWheelID() → int` | [src/runtime/part-native.ts:132](../src/runtime/part-native.ts#L132) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.Part.install_OK(GameRef, int, GameRef, int, Vector3) → int[]` | [src/runtime/part-native.ts:73](../src/runtime/part-native.ts#L73) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.Part.partOnSlot(int) → Part` | [src/runtime/part-native.ts:105](../src/runtime/part-native.ts#L105) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.Part.setMaxWear(float) → void` | [src/runtime/part-native.ts:190](../src/runtime/part-native.ts#L190) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.Part.setMesh(int) → int` | [src/runtime/part-native.ts:202](../src/runtime/part-native.ts#L202) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.Part.setRenderType(int) → int` | [src/runtime/part-native.ts:248](../src/runtime/part-native.ts#L248) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.Part.setSlotDamage(int, String) → void` | [src/runtime/part-native.ts:221](../src/runtime/part-native.ts#L221) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.Part.setSlotPos(int, Vector3, Ypr) → void` | [src/runtime/part-native.ts:147](../src/runtime/part-native.ts#L147) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.Part.setTear(float) → float` | [src/runtime/part-native.ts:182](../src/runtime/part-native.ts#L182) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.Part.setTexture(int) → int` | [src/runtime/part-native.ts:240](../src/runtime/part-native.ts#L240) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.Part.setWear(float) → float` | [src/runtime/part-native.ts:173](../src/runtime/part-native.ts#L173) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.Part.slotIDOnSlot(int) → int` | [src/runtime/part-native.ts:114](../src/runtime/part-native.ts#L114) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.SfxTable.addItem(ResourceRef, float, float, float, float, float) → void` | [src/runtime/chassis-native.ts:115](../src/runtime/chassis-native.ts#L115) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.SfxTable.clear() → void` | [src/runtime/chassis-native.ts:111](../src/runtime/chassis-native.ts#L111) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.SfxTable.getItems() → int` | [src/runtime/chassis-native.ts:109](../src/runtime/chassis-native.ts#L109) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.getBrake()` | [src/runtime/wheel-ref-native.ts:74](../src/runtime/wheel-ref-native.ts#L74) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.game.parts.WheelRef.getDrive() → float` | [src/runtime/wheel-ref-native.ts:76](../src/runtime/wheel-ref-native.ts#L76) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.getHBrake()` | [src/runtime/wheel-ref-native.ts:75](../src/runtime/wheel-ref-native.ts#L75) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.game.parts.WheelRef.getPos() → Vector3` | [src/runtime/wheel-ref-native.ts:94](../src/runtime/wheel-ref-native.ts#L94) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.getRadius() → float` | [src/runtime/wheel-ref-native.ts:78](../src/runtime/wheel-ref-native.ts#L78) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.getSteer() → float` | [src/runtime/wheel-ref-native.ts:77](../src/runtime/wheel-ref-native.ts#L77) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.getYpr() → Ypr` | [src/runtime/wheel-ref-native.ts:95](../src/runtime/wheel-ref-native.ts#L95) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.setArm(float, float, float, float, float, float, float) → void` | [src/runtime/wheel-ref-native.ts:67](../src/runtime/wheel-ref-native.ts#L67) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.setBearing(float) → void` | [src/runtime/wheel-ref-native.ts:47](../src/runtime/wheel-ref-native.ts#L47) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.setBrake(float) → void` | [src/runtime/wheel-ref-native.ts:47](../src/runtime/wheel-ref-native.ts#L47) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.setCPatch(float, float, float) → void` | [src/runtime/wheel-ref-native.ts:126](../src/runtime/wheel-ref-native.ts#L126) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.setDamping(float, float) → void` | [src/runtime/wheel-ref-native.ts:62](../src/runtime/wheel-ref-native.ts#L62) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.setDamping(float) → void` | [src/runtime/wheel-ref-native.ts:47](../src/runtime/wheel-ref-native.ts#L47) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.setDrive(float) → void` | [src/runtime/wheel-ref-native.ts:47](../src/runtime/wheel-ref-native.ts#L47) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.setForce(float) → void` | [src/runtime/wheel-ref-native.ts:47](../src/runtime/wheel-ref-native.ts#L47) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.setFriction(float) → void` | [src/runtime/wheel-ref-native.ts:47](../src/runtime/wheel-ref-native.ts#L47) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.setFrictn_x(float) → void` | [src/runtime/wheel-ref-native.ts:47](../src/runtime/wheel-ref-native.ts#L47) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.setHBrake(float) → void` | [src/runtime/wheel-ref-native.ts:47](../src/runtime/wheel-ref-native.ts#L47) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.setHub(float, float, float, float, float, float, float, float, float, float) → void` | [src/runtime/wheel-ref-native.ts:67](../src/runtime/wheel-ref-native.ts#L67) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.setInstantCenter(float, float, float, float, float, float) → void` | [src/runtime/wheel-ref-native.ts:96](../src/runtime/wheel-ref-native.ts#L96) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.setLoadSmooth(float) → void` | [src/runtime/wheel-ref-native.ts:47](../src/runtime/wheel-ref-native.ts#L47) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.setMaxLen(float) → void` | [src/runtime/wheel-ref-native.ts:47](../src/runtime/wheel-ref-native.ts#L47) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.setMaxLoad(float) → void` | [src/runtime/wheel-ref-native.ts:47](../src/runtime/wheel-ref-native.ts#L47) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.setMinLen(float) → void` | [src/runtime/wheel-ref-native.ts:47](../src/runtime/wheel-ref-native.ts#L47) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.setOppWheel(int)` | [src/runtime/wheel-ref-native.ts:73](../src/runtime/wheel-ref-native.ts#L73) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.game.parts.WheelRef.setPacejka(int, float) → void` | [src/runtime/wheel-ref-native.ts:112](../src/runtime/wheel-ref-native.ts#L112) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.setPos(Vector3) → void` | [src/runtime/wheel-ref-native.ts:88](../src/runtime/wheel-ref-native.ts#L88) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.setRadius(float) → void` | [src/runtime/wheel-ref-native.ts:47](../src/runtime/wheel-ref-native.ts#L47) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.setRestLen(float) → void` | [src/runtime/wheel-ref-native.ts:47](../src/runtime/wheel-ref-native.ts#L47) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.setRollRes(float) → void` | [src/runtime/wheel-ref-native.ts:47](../src/runtime/wheel-ref-native.ts#L47) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.setSliction(float) → void` | [src/runtime/wheel-ref-native.ts:47](../src/runtime/wheel-ref-native.ts#L47) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.setSteer(float) → void` | [src/runtime/wheel-ref-native.ts:47](../src/runtime/wheel-ref-native.ts#L47) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.setStiffness(float) → void` | [src/runtime/wheel-ref-native.ts:47](../src/runtime/wheel-ref-native.ts#L47) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.setWidth(float) → void` | [src/runtime/wheel-ref-native.ts:47](../src/runtime/wheel-ref-native.ts#L47) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.parts.WheelRef.setYpr(Ypr) → void` | [src/runtime/wheel-ref-native.ts:91](../src/runtime/wheel-ref-native.ts#L91) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.game.Vehicle.getSpeedSquare() → float` | [src/runtime/game-boot.ts:424](../src/runtime/game-boot.ts#L424) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.io.Controller.user_Add(int, int, int, float, float, float, float) → int` | [src/runtime/controller-native.ts:45](../src/runtime/controller-native.ts#L45) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.io.Controller.user_Del(int, int, int) → int` | [src/runtime/controller-native.ts:56](../src/runtime/controller-native.ts#L56) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.io.Controller.user_GetAxisVal(int) → float` | [src/runtime/controller-native.ts:81](../src/runtime/controller-native.ts#L81) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.io.Controller.user_Reset() → void` | [src/runtime/controller-native.ts:39](../src/runtime/controller-native.ts#L39) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.io.Controller.user_SetAxisForce(int, float, float) → void` | [src/runtime/controller-native.ts:75](../src/runtime/controller-native.ts#L75) | Stores forceCenter/force; nonzero force overrides the read axis value. No physical wheel force feedback. |
| `java.io.Controller.user_SetAxisSmooth(int, float, float, float, float, float) → int` | [src/runtime/controller-native.ts:64](../src/runtime/controller-native.ts#L64) | Stores parameters; ControllerNative.read does not apply the stored smoothing/slew-rate parameters. |
| `java.io.Controller.user_SetAxisSpeed(int, float) → void` | [src/runtime/controller-native.ts:71](../src/runtime/controller-native.ts#L71) | Stores parameters; ControllerNative.read does not apply the stored smoothing/slew-rate parameters. |
| `java.io.File.close() → void` | [src/runtime/file-native.ts:38](../src/runtime/file-native.ts#L38) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.io.File.copy(String, String) → int` | [src/runtime/file-native.ts:98](../src/runtime/file-native.ts#L98) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.io.File.delete(String) → int` | [src/runtime/file-native.ts:96](../src/runtime/file-native.ts#L96) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.io.File.exists(String) → int` | [src/runtime/file-native.ts:94](../src/runtime/file-native.ts#L94) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.io.File.move(String, String) → int` | [src/runtime/file-native.ts:100](../src/runtime/file-native.ts#L100) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.io.File.open(int) → int` | [src/runtime/file-native.ts:17](../src/runtime/file-native.ts#L17) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.io.File.readFloat() → float` | [src/runtime/file-native.ts:77](../src/runtime/file-native.ts#L77) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.io.File.readInt() → int` | [src/runtime/file-native.ts:75](../src/runtime/file-native.ts#L75) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.io.File.readResID() → int` | [src/runtime/file-native.ts:79](../src/runtime/file-native.ts#L79) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.io.File.readString() → String` | [src/runtime/file-native.ts:92](../src/runtime/file-native.ts#L92) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.io.File.write(float) → int` | [src/runtime/file-native.ts:43](../src/runtime/file-native.ts#L43) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.io.File.write(int) → int` | [src/runtime/file-native.ts:41](../src/runtime/file-native.ts#L41) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.io.File.write(ResourceRef) → int` | [src/runtime/file-native.ts:52](../src/runtime/file-native.ts#L52) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.io.File.write(String) → int` | [src/runtime/file-native.ts:45](../src/runtime/file-native.ts#L45) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.io.FindFile.close() → void` | [src/runtime/find-file-native.ts:45](../src/runtime/find-file-native.ts#L45) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.io.FindFile.first(String, int) → String` | [src/runtime/find-file-native.ts:30](../src/runtime/find-file-native.ts#L30) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.io.FindFile.next() → String` | [src/runtime/find-file-native.ts:39](../src/runtime/find-file-native.ts#L39) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.io.Input.checkHotkeys(GameRef, Osd) → void` | [src/runtime/input-native.ts:98](../src/runtime/input-native.ts#L98) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.io.Input.createHotkey(int, int, Hotkey, GameRef, Osd, int) → void` | [src/runtime/input-native.ts:84](../src/runtime/input-native.ts#L84) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.io.Input.deleteHotkey(Hotkey) → void` | [src/runtime/input-native.ts:89](../src/runtime/input-native.ts#L89) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.io.Input.flushHotkeys() → void` | [src/runtime/input-native.ts:94](../src/runtime/input-native.ts#L94) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.io.Input.getAxis(int, int) → float` | [src/runtime/input-native.ts:51](../src/runtime/input-native.ts#L51) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.io.Input.getDeviceName(int) → String` | [src/runtime/game-boot.ts:519](../src/runtime/game-boot.ts#L519) | Browser adapter exposes SysKeyboard/SysMouse; other device indices return null. |
| `java.io.Input.initControllers(Init, String)` | [src/runtime/game-boot.ts:195](../src/runtime/game-boot.ts#L195) | Partial browser adapter: stores Controller.controlFile; does not initialize original OS device drivers. **Host addition.** |
| `java.io.Input.lastKey() → int` | [src/runtime/input-native.ts:53](../src/runtime/input-native.ts#L53) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.io.MouseCursor.getPos() → Vector3` | [src/runtime/game-type-native.ts:488](../src/runtime/game-type-native.ts#L488) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.io.MouseCursor.getPos(Vector3) → Vector3` | [src/runtime/game-type-native.ts:491](../src/runtime/game-type-native.ts#L491) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.Debug.errorEX(String) → void` | [src/runtime/system-native.ts:81](../src/runtime/system-native.ts#L81) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.Debug.giveWarning(String) → void` | [src/runtime/system-native.ts:77](../src/runtime/system-native.ts#L77) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.Debug.writeFile(String, String) → void` | [src/runtime/system-native.ts:73](../src/runtime/system-native.ts#L73) | Writes a host log event, not an original filesystem debug file. |
| `java.lang.Float.toString(float, String) → String` | [src/runtime/string-native.ts:28](../src/runtime/string-native.ts#L28) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.GameType.<init>()` | [src/runtime/game-type-native.ts:276](../src/runtime/game-type-native.ts#L276) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.GameType.addNotification(GameRef, int, int, String, String) → void` | [src/runtime/game-type-native.ts:306](../src/runtime/game-type-native.ts#L306) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.GameType.addNotification(GameRef, int, int, String) → void` | [src/runtime/game-type-native.ts:304](../src/runtime/game-type-native.ts#L304) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.GameType.addTimer(float, int) → void` | [src/runtime/game-type-native.ts:334](../src/runtime/game-type-native.ts#L334) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.GameType.clearEventMask(int) → void` | [src/runtime/game-type-native.ts:284](../src/runtime/game-type-native.ts#L284) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.GameType.createNativeInstance()` | [src/runtime/game-type-native.ts:277](../src/runtime/game-type-native.ts#L277) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.GameType.createNativeInstance(GameRef, int, String, String) → void` | [src/runtime/game-type-native.ts:279](../src/runtime/game-type-native.ts#L279) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.GameType.createNativeInstance(GameRef)` | [src/runtime/game-type-native.ts:278](../src/runtime/game-type-native.ts#L278) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.GameType.registerCallback(int) → void` | [src/runtime/game-type-native.ts:319](../src/runtime/game-type-native.ts#L319) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.GameType.remNotification(GameRef, int) → void` | [src/runtime/game-type-native.ts:308](../src/runtime/game-type-native.ts#L308) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.GameType.removeAllTimers() → void` | [src/runtime/game-type-native.ts:353](../src/runtime/game-type-native.ts#L353) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.GameType.setEventMask(int) → void` | [src/runtime/game-type-native.ts:281](../src/runtime/game-type-native.ts#L281) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.GameType.unregisterCallback(int) → void` | [src/runtime/game-type-native.ts:324](../src/runtime/game-type-native.ts#L324) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.GameType.unregisterCallbacks() → void` | [src/runtime/game-type-native.ts:330](../src/runtime/game-type-native.ts#L330) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.Integer.toHexString(int) → String` | [src/runtime/string-native.ts:24](../src/runtime/string-native.ts#L24) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.Integer.toString(int) → String` | [src/runtime/string-native.ts:26](../src/runtime/string-native.ts#L26) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.Math.abs(float)` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.abs(int)` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.avg(float[])` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.avg(int[])` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.chaos()` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.cos(float)` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.cos(int)` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.deg2rad(float)` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.deg2rad(int)` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.pow(float, float) → float` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.Math.pow(float, int)` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.pow(int, float)` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.pow(int, int)` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.rad2deg(float)` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.rad2deg(int)` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.random() → float` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.Math.randomize() → void` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.Math.remDiv(int, int)` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.round(float)` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.round(int)` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.section(float, float, float)` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.section(float, float, int)` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.section(float, int, float)` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.section(float, int, int)` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.section(int, float, float)` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.section(int, float, int)` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.section(int, int, float)` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.section(int, int, int)` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.setrandseed(int) → void` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.Math.sin(float)` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.sin(int)` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.siRandom()` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.sqr(float)` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.sqr(int)` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.sqrt(float) → float` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.Math.sqrt(int)` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.total(float[])` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Math.total(int[])` | [src/runtime/math-native.ts:57](../src/runtime/math-native.ts#L57) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Object.notify() → void` | [src/runtime/thread-native.ts:87](../src/runtime/thread-native.ts#L87) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.Object.notifyAll() → void` | [src/runtime/thread-native.ts:87](../src/runtime/thread-native.ts#L87) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.Object.toString() → String` | [src/runtime/game-boot.ts:204](../src/runtime/game-boot.ts#L204) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.Object.wait() → void` | [src/runtime/thread-native.ts:80](../src/runtime/thread-native.ts#L80) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.String.append(int) → String` | [src/runtime/string-native.ts:42](../src/runtime/string-native.ts#L42) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.String.finalize() → void` | [src/runtime/string-native.ts:60](../src/runtime/string-native.ts#L60) | Browser lifetime adapter: returns void; JavaScript owns memory. |
| `java.lang.String.floatValue() → float` | [src/runtime/string-native.ts:54](../src/runtime/string-native.ts#L54) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.String.getASCII() → int[]` | [src/runtime/string-native.ts:56](../src/runtime/string-native.ts#L56) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.String.intValue() → int` | [src/runtime/string-native.ts:52](../src/runtime/string-native.ts#L52) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.String.length() → int` | [src/runtime/string-native.ts:41](../src/runtime/string-native.ts#L41) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.String.token(int, String) → String` | [src/runtime/string-native.ts:47](../src/runtime/string-native.ts#L47) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.System.arraycopy(Object, int, Object, int, int) → void` | [src/runtime/game-boot.ts:377](../src/runtime/game-boot.ts#L377) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.System.buildNumber() → int` | [src/runtime/system-native.ts:42](../src/runtime/system-native.ts#L42) | Compatibility constant 940, not the host engine version. |
| `java.lang.System.currentTime() → float` | [src/runtime/system-native.ts:24](../src/runtime/system-native.ts#L24) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.System.isLoading() → int` | [src/runtime/system-native.ts:63](../src/runtime/system-native.ts#L63) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.System.isLoadingReset() → void` | [src/runtime/system-native.ts:59](../src/runtime/system-native.ts#L59) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.System.log(String) → void` | [src/runtime/system-native.ts:67](../src/runtime/system-native.ts#L67) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.System.memUsage() → int` | [src/runtime/system-native.ts:44](../src/runtime/system-native.ts#L44) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.System.openLib(String) → int` | [src/runtime/game-boot.ts:368](../src/runtime/game-boot.ts#L368) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.System.setLdPriority(int) → void` | [src/runtime/system-native.ts:55](../src/runtime/system-native.ts#L55) | Stores the priority; no original engine loader scheduling. |
| `java.lang.System.setMeasure(float) → void` | [src/runtime/system-native.ts:30](../src/runtime/system-native.ts#L30) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.System.simTime() → float` | [src/runtime/system-native.ts:25](../src/runtime/system-native.ts#L25) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.System.syncGameTime(float) → void` | [src/runtime/system-native.ts:26](../src/runtime/system-native.ts#L26) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.System.timeWarp(float) → float` | [src/runtime/system-native.ts:48](../src/runtime/system-native.ts#L48) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.Thread.getPriority() → int` | [src/runtime/thread-native.ts:52](../src/runtime/thread-native.ts#L52) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.Thread.init(String) → void` | [src/runtime/thread-native.ts:22](../src/runtime/thread-native.ts#L22) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.Thread.isAlive() → int` | [src/runtime/thread-native.ts:51](../src/runtime/thread-native.ts#L51) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.Thread.notify()` | [src/runtime/thread-native.ts:67](../src/runtime/thread-native.ts#L67) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Thread.setDaemon(int) → void` | [src/runtime/thread-native.ts:57](../src/runtime/thread-native.ts#L57) | Stores metadata; cooperative browser execution has no original OS thread priorities/daemon lifecycle. |
| `java.lang.Thread.setPriority(int) → void` | [src/runtime/thread-native.ts:53](../src/runtime/thread-native.ts#L53) | Stores metadata; cooperative browser execution has no original OS thread priorities/daemon lifecycle. |
| `java.lang.Thread.sleep(float) → void` | [src/runtime/thread-native.ts:73](../src/runtime/thread-native.ts#L73) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.Thread.start() → void` | [src/runtime/thread-native.ts:23](../src/runtime/thread-native.ts#L23) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.Thread.stop() → void` | [src/runtime/thread-native.ts:41](../src/runtime/thread-native.ts#L41) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.Thread.wait()` | [src/runtime/thread-native.ts:61](../src/runtime/thread-native.ts#L61) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.lang.Vector3.<init>(Ypr) → void` | [src/runtime/vector-native.ts:25](../src/runtime/vector-native.ts#L25) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.Vector3.distance(Vector3) → float` | [src/runtime/vector-native.ts:33](../src/runtime/vector-native.ts#L33) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.Vector3.length() → float` | [src/runtime/vector-native.ts:30](../src/runtime/vector-native.ts#L30) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.Vector3.normalize() → void` | [src/runtime/vector-native.ts:37](../src/runtime/vector-native.ts#L37) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.Vector3.rotate(Vector3, float) → Vector3` | [src/runtime/vector-native.ts:46](../src/runtime/vector-native.ts#L46) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.Vector3.rotate(Ypr) → Vector3` | [src/runtime/vector-native.ts:42](../src/runtime/vector-native.ts#L42) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.Ypr.<init>(Vector3) → void` | [src/runtime/vector-native.ts:58](../src/runtime/vector-native.ts#L58) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.lang.Ypr.mul(Ypr) → void` | [src/runtime/vector-native.ts:64](../src/runtime/vector-native.ts#L64) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.render.Camera.create(ResourceRef, Viewport, int, float, float, float, float, float, int, int) → void` | [src/runtime/camera-native.ts:23](../src/runtime/camera-native.ts#L23) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.render.Camera.destroy() → void` | [src/runtime/camera-native.ts:37](../src/runtime/camera-native.ts#L37) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.render.GfxEngine.closeVideo() → void` | [src/runtime/game-boot.ts:500](../src/runtime/game-boot.ts#L500) | Delegates to OsdVideo when supplied. Without it: openVideo returns 1, isPlayingVideo returns 0, closeVideo has no effect. |
| `java.render.GfxEngine.currDisplayMode() → int` | [src/runtime/game-boot.ts:480](../src/runtime/game-boot.ts#L480) | Browser adapter exposes one current viewport-sized mode, not OS display enumeration. |
| `java.render.GfxEngine.displayModeName(int) → String` | [src/runtime/game-boot.ts:481](../src/runtime/game-boot.ts#L481) | Browser adapter exposes one current viewport-sized mode, not OS display enumeration. |
| `java.render.GfxEngine.isPlayingVideo() → int` | [src/runtime/game-boot.ts:501](../src/runtime/game-boot.ts#L501) | Delegates to OsdVideo when supplied. Without it: openVideo returns 1, isPlayingVideo returns 0, closeVideo has no effect. |
| `java.render.GfxEngine.numDisplayModes() → int` | [src/runtime/game-boot.ts:479](../src/runtime/game-boot.ts#L479) | Browser adapter exposes one current viewport-sized mode, not OS display enumeration. |
| `java.render.GfxEngine.openVideo(String, int, int, int) → int` | [src/runtime/game-boot.ts:498](../src/runtime/game-boot.ts#L498) | Delegates to OsdVideo when supplied. Without it: openVideo returns 1, isPlayingVideo returns 0, closeVideo has no effect. |
| `java.render.GfxEngine.openVideo(String, int, int) → int` | [src/runtime/game-boot.ts:498](../src/runtime/game-boot.ts#L498) | Delegates to OsdVideo when supplied. Without it: openVideo returns 1, isPlayingVideo returns 0, closeVideo has no effect. |
| `java.render.GfxEngine.setGlobalEnvmap(ResourceRef) → void` | [src/runtime/game-boot.ts:483](../src/runtime/game-boot.ts#L483) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.render.Text.changeAlign(int) → void` | [src/runtime/osd-text-native.ts:68](../src/runtime/osd-text-native.ts#L68) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.render.Text.changeColor(int) → void` | [src/runtime/osd-text-native.ts:75](../src/runtime/osd-text-native.ts#L75) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.render.Text.create(ResourceRef, ResourceRef, float, float) → void` | [src/runtime/osd-text-native.ts:38](../src/runtime/osd-text-native.ts#L38) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.render.Text.getCharWidth(ResourceRef, Viewport)` | [src/runtime/osd-text-native.ts:29](../src/runtime/osd-text-native.ts#L29) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.render.Text.getHeight(ResourceRef, Viewport)` | [src/runtime/osd-text-native.ts:29](../src/runtime/osd-text-native.ts#L29) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.render.Text.getLineSpacing(ResourceRef, Viewport)` | [src/runtime/osd-text-native.ts:29](../src/runtime/osd-text-native.ts#L29) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.render.Text.getPos() → Vector3` | [src/runtime/osd-text-native.ts:95](../src/runtime/osd-text-native.ts#L95) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.render.Text.getWidthPixels(String, ResourceRef) → float` | [src/runtime/osd-text-native.ts:20](../src/runtime/osd-text-native.ts#L20) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.render.Text.setPos(float, float) → void` | [src/runtime/osd-text-native.ts:90](../src/runtime/osd-text-native.ts#L90) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.render.Text.setScale(float, float) → void` | [src/runtime/osd-text-native.ts:101](../src/runtime/osd-text-native.ts#L101) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.render.Text.update() → void` | [src/runtime/osd-text-native.ts:63](../src/runtime/osd-text-native.ts#L63) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.render.Viewport.activate(int) → void` | [src/runtime/viewport-native.ts:30](../src/runtime/viewport-native.ts#L30) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.render.Viewport.create(int, float, float, float, float) → void` | [src/runtime/viewport-native.ts:15](../src/runtime/viewport-native.ts#L15) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.render.Viewport.deactivate() → void` | [src/runtime/viewport-native.ts:33](../src/runtime/viewport-native.ts#L33) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.render.Viewport.destroy() → void` | [src/runtime/viewport-native.ts:24](../src/runtime/viewport-native.ts#L24) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.render.Viewport.getAspect() → float` | [src/runtime/viewport-native.ts:44](../src/runtime/viewport-native.ts#L44) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.render.Viewport.getHeight() → float` | [src/runtime/viewport-native.ts:43](../src/runtime/viewport-native.ts#L43) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.render.Viewport.getLeft() → float` | [src/runtime/viewport-native.ts:43](../src/runtime/viewport-native.ts#L43) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.render.Viewport.getTop() → float` | [src/runtime/viewport-native.ts:43](../src/runtime/viewport-native.ts#L43) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.render.Viewport.getWidth() → float` | [src/runtime/viewport-native.ts:43](../src/runtime/viewport-native.ts#L43) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.render.Viewport.resize(float, float, float, float) → void` | [src/runtime/viewport-native.ts:36](../src/runtime/viewport-native.ts#L36) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.sound.Sound.changeMusicSet(int) → void` | [src/runtime/game-boot.ts:513](../src/runtime/game-boot.ts#L513) | Delegates to SoundJavaBridge when supplied. Without the bridge returns void/0; this fallback is not audio playback. |
| `java.sound.Sound.firstTrack() → void` | [src/runtime/game-boot.ts:513](../src/runtime/game-boot.ts#L513) | Delegates to SoundJavaBridge when supplied. Without the bridge returns void/0; this fallback is not audio playback. |
| `java.sound.Sound.getNowPlaying() → int` | [src/runtime/game-boot.ts:513](../src/runtime/game-boot.ts#L513) | Delegates to SoundJavaBridge when supplied. Without the bridge returns void/0; this fallback is not audio playback. |
| `java.sound.Sound.getTotalTracks() → int` | [src/runtime/game-boot.ts:513](../src/runtime/game-boot.ts#L513) | Delegates to SoundJavaBridge when supplied. Without the bridge returns void/0; this fallback is not audio playback. |
| `java.sound.Sound.getVolume(int) → float` | [src/runtime/game-boot.ts:513](../src/runtime/game-boot.ts#L513) | Delegates to SoundJavaBridge when supplied. Without the bridge returns void/0; this fallback is not audio playback. |
| `java.sound.Sound.nextTrack() → void` | [src/runtime/game-boot.ts:513](../src/runtime/game-boot.ts#L513) | Delegates to SoundJavaBridge when supplied. Without the bridge returns void/0; this fallback is not audio playback. |
| `java.sound.Sound.playTrack(int) → void` | [src/runtime/game-boot.ts:513](../src/runtime/game-boot.ts#L513) | Delegates to SoundJavaBridge when supplied. Without the bridge returns void/0; this fallback is not audio playback. |
| `java.sound.Sound.playTrack(String) → void` | [src/runtime/game-boot.ts:513](../src/runtime/game-boot.ts#L513) | Delegates to SoundJavaBridge when supplied. Without the bridge returns void/0; this fallback is not audio playback. |
| `java.sound.Sound.prevTrack() → void` | [src/runtime/game-boot.ts:513](../src/runtime/game-boot.ts#L513) | Delegates to SoundJavaBridge when supplied. Without the bridge returns void/0; this fallback is not audio playback. |
| `java.sound.Sound.randomTrack() → void` | [src/runtime/game-boot.ts:513](../src/runtime/game-boot.ts#L513) | Delegates to SoundJavaBridge when supplied. Without the bridge returns void/0; this fallback is not audio playback. |
| `java.sound.Sound.setVolume(int, float) → void` | [src/runtime/game-boot.ts:513](../src/runtime/game-boot.ts#L513) | Delegates to SoundJavaBridge when supplied. Without the bridge returns void/0; this fallback is not audio playback. |
| `java.sound.Sound.stopMusic() → void` | [src/runtime/game-boot.ts:513](../src/runtime/game-boot.ts#L513) | Delegates to SoundJavaBridge when supplied. Without the bridge returns void/0; this fallback is not audio playback. |
| `java.util.resource.GameRef.clearFlags(int) → void` | [src/runtime/game-type-native.ts:482](../src/runtime/game-type-native.ts#L482) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.GameRef.create_native(GameRef, GameRef, String, String) → void` | [src/runtime/game-type-native.ts:427](../src/runtime/game-type-native.ts#L427) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.GameRef.create(GameRef, GameRef, String, String) → GameType` | [src/runtime/game-type-native.ts:422](../src/runtime/game-type-native.ts#L422) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.GameRef.create(GameRef, ResourceRef, String, String)` | [src/runtime/game-type-native.ts:425](../src/runtime/game-type-native.ts#L425) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.util.resource.GameRef.getFlags() → int` | [src/runtime/game-type-native.ts:478](../src/runtime/game-type-native.ts#L478) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.GameRef.getInfo(int, int) → int` | [src/runtime/game-type-native.ts:470](../src/runtime/game-type-native.ts#L470) | Partial query switch. GII_BONE returns the root resource ID, not an animated bone; unknown query codes throw. |
| `java.util.resource.GameRef.getInfo(int, String) → int` | [src/runtime/game-type-native.ts:470](../src/runtime/game-type-native.ts#L470) | Partial query switch. GII_BONE returns the root resource ID, not an animated bone; unknown query codes throw. |
| `java.util.resource.GameRef.getOri() → Ypr` | [src/runtime/game-type-native.ts:489](../src/runtime/game-type-native.ts#L489) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.GameRef.getOri(Ypr) → Ypr` | [src/runtime/game-type-native.ts:493](../src/runtime/game-type-native.ts#L493) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.GameRef.getPos() → Vector3` | [src/runtime/game-type-native.ts:488](../src/runtime/game-type-native.ts#L488) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.GameRef.getPos(Vector3) → Vector3` | [src/runtime/game-type-native.ts:491](../src/runtime/game-type-native.ts#L491) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.GameRef.getScriptInstance() → Object` | [src/runtime/game-type-native.ts:359](../src/runtime/game-type-native.ts#L359) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.GameRef.getTear()` | [src/runtime/part-native.ts:180](../src/runtime/part-native.ts#L180) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.util.resource.GameRef.getVel() → Vector3` | [src/runtime/game-type-native.ts:490](../src/runtime/game-type-native.ts#L490) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.GameRef.getVel(Vector3) → Vector3` | [src/runtime/game-type-native.ts:495](../src/runtime/game-type-native.ts#L495) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.GameRef.getWear()` | [src/runtime/part-native.ts:171](../src/runtime/part-native.ts#L171) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.util.resource.GameRef.isScripted()` | [src/runtime/game-type-native.ts:382](../src/runtime/game-type-native.ts#L382) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.util.resource.GameRef.isScripted(String) → int` | [src/runtime/game-type-native.ts:381](../src/runtime/game-type-native.ts#L381) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.GameRef.queueEvent(ResourceRef, int, String) → void` | [src/runtime/game-type-native.ts:507](../src/runtime/game-type-native.ts#L507) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.GameRef.setActiveCollision() → void` | [src/runtime/game-type-native.ts:537](../src/runtime/game-type-native.ts#L537) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.GameRef.setFlags(int) → void` | [src/runtime/game-type-native.ts:479](../src/runtime/game-type-native.ts#L479) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.GameRef.setMatrix(Vector3, Ypr) → void` | [src/runtime/game-type-native.ts:500](../src/runtime/game-type-native.ts#L500) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.GameRef.setParent(ResourceRef) → void` | [src/runtime/game-type-native.ts:485](../src/runtime/game-type-native.ts#L485) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.GameRef.setPos(Vector3) → void` | [src/runtime/game-type-native.ts:497](../src/runtime/game-type-native.ts#L497) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.GameRef.setState(Vector3, Ypr, Vector3, Vector3) → void` | [src/runtime/game-type-native.ts:503](../src/runtime/game-type-native.ts#L503) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.GameRef.setTear(float)` | [src/runtime/part-native.ts:182](../src/runtime/part-native.ts#L182) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.util.resource.GameRef.setWear(float)` | [src/runtime/part-native.ts:173](../src/runtime/part-native.ts#L173) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.util.resource.GroundRef.setFog(int, float, float) → void` | [src/runtime/game-boot.ts:324](../src/runtime/game-boot.ts#L324) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.PhysicsRef.createBox(ResourceRef, float, float, float, String) → void` | [src/runtime/osd-button-native.ts:44](../src/runtime/osd-button-native.ts#L44) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.PhysicsRef.destroy()` | [src/runtime/physics-ref-native.ts:36](../src/runtime/physics-ref-native.ts#L36) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.util.resource.PhysicsRef.getAngVel() → Vector3` | [src/runtime/physics-ref-native.ts:33](../src/runtime/physics-ref-native.ts#L33) | Fixed script-created colliders only. setStatic(0) throws; getVel/getAngVel return zero. Standalone dynamic bodies are absent. |
| `java.util.resource.PhysicsRef.getOri() → Ypr` | [src/runtime/physics-ref-native.ts:22](../src/runtime/physics-ref-native.ts#L22) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.PhysicsRef.getPos() → Vector3` | [src/runtime/osd-button-native.ts:96](../src/runtime/osd-button-native.ts#L96) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.PhysicsRef.getVel() → Vector3` | [src/runtime/physics-ref-native.ts:30](../src/runtime/physics-ref-native.ts#L30) | Fixed script-created colliders only. setStatic(0) throws; getVel/getAngVel return zero. Standalone dynamic bodies are absent. |
| `java.util.resource.PhysicsRef.setMatrix(Vector3, Ypr) → void` | [src/runtime/osd-button-native.ts:59](../src/runtime/osd-button-native.ts#L59) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.PhysicsRef.setStatic(int) → void` | [src/runtime/physics-ref-native.ts:25](../src/runtime/physics-ref-native.ts#L25) | Fixed script-created colliders only. setStatic(0) throws; getVel/getAngVel return zero. Standalone dynamic bodies are absent. |
| `java.util.resource.RenderRef.changeResource(ResourceRef, ResourceRef) → void` | [src/runtime/game-type-native.ts:197](../src/runtime/game-type-native.ts#L197) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.RenderRef.create(ResourceRef, RenderRef, String) → void` | [src/runtime/render-ref-native.ts:24](../src/runtime/render-ref-native.ts#L24) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.RenderRef.getTypeID() → int` | [src/runtime/render-ref-native.ts:39](../src/runtime/render-ref-native.ts#L39) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.RenderRef.setFlare(ResourceRef, int, float, float, int, int) → void` | [src/runtime/render-ref-native.ts:60](../src/runtime/render-ref-native.ts#L60) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.RenderRef.setLight(int, int, int) → void` | [src/runtime/render-ref-native.ts:51](../src/runtime/render-ref-native.ts#L51) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.RenderRef.setMatrix(Vector3, Ypr) → void` | [src/runtime/render-ref-native.ts:29](../src/runtime/render-ref-native.ts#L29) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.RenderRef.setType(ResourceRef) → void` | [src/runtime/render-ref-native.ts:41](../src/runtime/render-ref-native.ts#L41) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.ResourceRef.deleteNative() → void` | [src/runtime/game-type-native.ts:268](../src/runtime/game-type-native.ts#L268) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.ResourceRef.destroy() → void` | [src/runtime/game-type-native.ts:243](../src/runtime/game-type-native.ts#L243) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.ResourceRef.duplicate(ResourceRef) → void` | [src/runtime/game-type-native.ts:162](../src/runtime/game-type-native.ts#L162) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.ResourceRef.getFirstChild() → ResourceRef` | [src/runtime/game-type-native.ts:227](../src/runtime/game-type-native.ts#L227) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.ResourceRef.getNextChild() → ResourceRef` | [src/runtime/game-type-native.ts:232](../src/runtime/game-type-native.ts#L232) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.ResourceRef.getParent() → ResourceRef` | [src/runtime/game-type-native.ts:225](../src/runtime/game-type-native.ts#L225) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.ResourceRef.getParentID() → int` | [src/runtime/game-type-native.ts:223](../src/runtime/game-type-native.ts#L223) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.ResourceRef.getWTRoot() → ResourceRef` | [src/runtime/game-type-native.ts:238](../src/runtime/game-type-native.ts#L238) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.ResourceRef.id() → int` | [src/runtime/game-type-native.ts:207](../src/runtime/game-type-native.ts#L207) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.ResourceRef.isScripted()` | [src/runtime/game-type-native.ts:382](../src/runtime/game-type-native.ts#L382) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.util.resource.ResourceRef.isScripted(String)` | [src/runtime/game-type-native.ts:381](../src/runtime/game-type-native.ts#L381) | Host-only overload/adapter; no matching native TUFA declaration in this corpus. **Host addition.** |
| `java.util.resource.ResourceRef.load() → void` | [src/runtime/game-type-native.ts:75](../src/runtime/game-type-native.ts#L75) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.ResourceRef.makeTexture(ResourceRef, String) → void` | [src/runtime/game-boot.ts:315](../src/runtime/game-boot.ts#L315) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.ResourceRef.newNative() → void` | [src/runtime/game-type-native.ts:94](../src/runtime/game-type-native.ts#L94) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.ResourceRef.scaleMesh(float, float, float) → void` | [src/runtime/game-type-native.ts:190](../src/runtime/game-type-native.ts#L190) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.ResourceRef.set(int) → void` | [src/runtime/game-type-native.ts:97](../src/runtime/game-type-native.ts#L97) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.ResourceRef.set(ResourceRef) → void` | [src/runtime/game-type-native.ts:141](../src/runtime/game-type-native.ts#L141) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.ResourceRef.type() → int` | [src/runtime/game-type-native.ts:221](../src/runtime/game-type-native.ts#L221) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.SfxRef.nplay(Vector3, float, float, float, int, int) → int` | [src/runtime/sfx-ref-native.ts:20](../src/runtime/sfx-ref-native.ts#L20) | Host implementation registered; original-engine semantic parity is not implied. |
| `java.util.resource.SfxRef.stop(int) → void` | [src/runtime/sfx-ref-native.ts:33](../src/runtime/sfx-ref-native.ts#L33) | Host implementation registered; original-engine semantic parity is not implied. |

## 2. Mocked

**32 overloads.**

| Method | Implementation | Notes |
|---|---|---|
| `java.game.Frontend.init()` | [src/runtime/game-boot.ts:195](../src/runtime/game-boot.ts#L195) | Logs and returns void. Original frontend initialization is not reproduced by this adapter. **Host addition.** |
| `java.game.LoadingScreen.show(ResourceRef, int)` | [src/runtime/game-boot.ts:195](../src/runtime/game-boot.ts#L195) | Conditional no-op only when original LoadingScreen assets are absent. With assets, the Java loading-screen implementation runs. **Host addition.** |
| `java.game.Navigator.updateNavigator(GameRef, int) → void` | [src/runtime/game-boot.ts:504](../src/runtime/game-boot.ts#L504) | Returns void; the native navigator viewport update is deferred. |
| `java.io.Input.enablePointingDevice()` | [src/runtime/game-boot.ts:195](../src/runtime/game-boot.ts#L195) | Logs and returns void; browser pointer events are managed separately. **Host addition.** |
| `java.lang.GarbageCollector.<init>()` | [src/runtime/game-boot.ts:433](../src/runtime/game-boot.ts#L433) | No-op host adapter; no original collector lifecycle. JavaScript manages memory. **Host addition.** |
| `java.lang.GarbageCollector.flush()` | [src/runtime/game-boot.ts:195](../src/runtime/game-boot.ts#L195) | No-op host adapter; no original collector lifecycle. JavaScript manages memory. **Host addition.** |
| `java.lang.GarbageCollector.push(Object)` | [src/runtime/game-boot.ts:195](../src/runtime/game-boot.ts#L195) | No-op host adapter; no original collector lifecycle. JavaScript manages memory. **Host addition.** |
| `java.lang.System.compileAll(String) → int` | [src/runtime/system-native.ts:66](../src/runtime/system-native.ts#L66) | Returns 0; does not force collection/finalization or compile the original scripts. |
| `java.lang.System.gc() → int` | [src/runtime/system-native.ts:65](../src/runtime/system-native.ts#L65) | Returns 0; does not force collection/finalization or compile the original scripts. |
| `java.lang.System.getConfigOptions() → void` | [src/runtime/system-native.ts:38](../src/runtime/system-native.ts#L38) | Logs and returns void; does not apply the full original system/graphics/FFB configuration. |
| `java.lang.System.runFinalization() → int` | [src/runtime/system-native.ts:65](../src/runtime/system-native.ts#L65) | Returns 0; does not force collection/finalization or compile the original scripts. |
| `java.render.GfxEngine.changeVideoMode(int, int, int) → void` | [src/runtime/game-boot.ts:482](../src/runtime/game-boot.ts#L482) | Returns void; no explicit renderer flush, forced synchronous rendering, or OS display-mode change. |
| `java.render.GfxEngine.flush() → void` | [src/runtime/game-boot.ts:195](../src/runtime/game-boot.ts#L195) | Returns void; no explicit renderer flush, forced synchronous rendering, or OS display-mode change. |
| `java.render.GfxEngine.forceRendering() → void` | [src/runtime/game-boot.ts:471](../src/runtime/game-boot.ts#L471) | Returns void; no explicit renderer flush, forced synchronous rendering, or OS display-mode change. |
| `java.sound.Sound.enableDebugDump(ResourceRef) → int` | [src/runtime/game-boot.ts:515](../src/runtime/game-boot.ts#L515) | Returns 0; no original sound debug dump. |
| `java.sound.Sound.init()` | [src/runtime/game-boot.ts:195](../src/runtime/game-boot.ts#L195) | Logs and returns void; browser audio initialization belongs to host services. **Host addition.** |
| `java.util.resource.GroundRef.addPedestrianType(GameRef) → void` | [src/runtime/game-boot.ts:195](../src/runtime/game-boot.ts#L195) | Accepts/logs the call; no pedestrian simulation. |
| `java.util.resource.GroundRef.addTrafficCar(GameRef, Vector3) → int` | [src/runtime/game-boot.ts:455](../src/runtime/game-boot.ts#L455) | Traffic simulation absent. Logs and returns 0; creates no traffic entity or notification subscription. |
| `java.util.resource.GroundRef.addTrafficN(GameRef, float, float, float, float)` | [src/runtime/game-boot.ts:445](../src/runtime/game-boot.ts#L445) | Traffic simulation absent. addTrafficN returns 0 and creates no traffic; delTraffic only logs. **Host addition.** |
| `java.util.resource.GroundRef.addTrafficN(GameRef, int, float, float, float) → int` | [src/runtime/game-boot.ts:445](../src/runtime/game-boot.ts#L445) | Traffic simulation absent. addTrafficN returns 0 and creates no traffic; delTraffic only logs. |
| `java.util.resource.GroundRef.addWaterLimit(Vector3, Vector3) → void` | [src/runtime/game-boot.ts:463](../src/runtime/game-boot.ts#L463) | Returns void; no water-plane rendering or water bounds. |
| `java.util.resource.GroundRef.delTraffic() → void` | [src/runtime/game-boot.ts:195](../src/runtime/game-boot.ts#L195) | Traffic simulation absent. addTrafficN returns 0 and creates no traffic; delTraffic only logs. |
| `java.util.resource.GroundRef.getNearestCross(Vector3, float) → Vector3` | [src/runtime/game-boot.ts:337](../src/runtime/game-boot.ts#L337) | Road graph absent. Distance 0 returns a copy of the input position; bounded searches or null input return null. This is not a nearest-crossing search. |
| `java.util.resource.GroundRef.getNearestCross(Vector3, int)` | [src/runtime/game-boot.ts:337](../src/runtime/game-boot.ts#L337) | Road graph absent. Distance 0 returns a copy of the input position; bounded searches or null input return null. This is not a nearest-crossing search. **Host addition.** |
| `java.util.resource.GroundRef.notifyTrafficCar(int, int) → int` | [src/runtime/game-boot.ts:455](../src/runtime/game-boot.ts#L455) | Traffic simulation absent. Logs and returns 0; creates no traffic entity or notification subscription. |
| `java.util.resource.GroundRef.setPedestrianDensityN(float) → void` | [src/runtime/game-boot.ts:195](../src/runtime/game-boot.ts#L195) | Accepts/logs the call; no pedestrian simulation. |
| `java.util.resource.GroundRef.setWater(Vector3, Vector3, float, float) → void` | [src/runtime/game-boot.ts:462](../src/runtime/game-boot.ts#L462) | Returns void; no water-plane rendering or water bounds. |
| `java.util.resource.RenderRef.lineAdd(Vector3, Vector3, int, float) → void` | [src/runtime/render-ref-native.ts:81](../src/runtime/render-ref-native.ts#L81) | lineCreate parents a resource and returns 1, but creates no line geometry. lineAdd discards points. Route/SkidMark native lines are invisible. |
| `java.util.resource.RenderRef.lineCreate(ResourceRef, ResourceRef) → int` | [src/runtime/render-ref-native.ts:72](../src/runtime/render-ref-native.ts#L72) | lineCreate parents a resource and returns 1, but creates no line geometry. lineAdd discards points. Route/SkidMark native lines are invisible. |
| `java.util.resource.ResourceRef.cache() → void` | [src/runtime/game-boot.ts:195](../src/runtime/game-boot.ts#L195) | Logs the call; no original resource-cache operation or explicit unloading. |
| `java.util.resource.ResourceRef.precache() → void` | [src/runtime/game-boot.ts:195](../src/runtime/game-boot.ts#L195) | Logs the call; no original resource-cache operation or explicit unloading. |
| `java.util.resource.ResourceRef.unload() → void` | [src/runtime/game-boot.ts:195](../src/runtime/game-boot.ts#L195) | Logs the call; no original resource-cache operation or explicit unloading. |

## 3. Not implemented

**121 overloads.**

| Method | Implementation | Notes |
|---|---|---|
| `java.game.Painter.doPaint(GameRef, int, int, int, float, float, int) → void` | — | No matching registration in the browser Java host. |
| `java.game.Painter.paintPart(GameRef, int) → void` | — | No matching registration in the browser Java host. |
| `java.game.Painter.xPaint(GameRef) → void` | — | No matching registration in the browser Java host. |
| `java.game.parts.bodypart.Chassis.getAIparam_float(int) → float` | — | No matching registration in the browser Java host. |
| `java.game.parts.bodypart.Chassis.getAIparam_int(int) → int` | — | No matching registration in the browser Java host. |
| `java.game.parts.bodypart.Chassis.getAngvel() → Vector3` | — | No matching registration in the browser Java host. |
| `java.game.parts.bodypart.Chassis.getEngineTemp() → float` | — | No matching registration in the browser Java host. |
| `java.game.parts.bodypart.Chassis.getMaterialIndex() → int` | — | No matching registration in the browser Java host. |
| `java.game.parts.bodypart.Chassis.getNitroing() → int` | — | No matching registration in the browser Java host. |
| `java.game.parts.bodypart.Chassis.getOSD(int) → float` | — | No matching registration in the browser Java host. |
| `java.game.parts.bodypart.Chassis.getRPM() → float` | — | No matching registration in the browser Java host. |
| `java.game.parts.bodypart.Chassis.getShifting() → int` | — | No matching registration in the browser Java host. |
| `java.game.parts.bodypart.Chassis.getWheelPos(int) → Vector3` | — | No matching registration in the browser Java host. |
| `java.game.parts.bodypart.Chassis.setAIparam_float(int, float) → void` | — | No matching registration in the browser Java host. |
| `java.game.parts.bodypart.Chassis.setAIparam_int(int, int) → void` | — | No matching registration in the browser Java host. |
| `java.game.parts.bodypart.Chassis.setBuck(int, int, float, float, float, float) → void` | — | No matching registration in the browser Java host. |
| `java.game.parts.bodypart.Chassis.setHornSFX(ResourceRef, float, int) → void` | — | No matching registration in the browser Java host. |
| `java.game.parts.bodypart.Chassis.setNitroSFX(ResourceRef, float) → void` | — | No matching registration in the browser Java host. |
| `java.game.parts.bodypart.Chassis.setOSD(int, float) → void` | — | No matching registration in the browser Java host. |
| `java.game.parts.bodypart.Chassis.setRPM(float) → void` | — | No matching registration in the browser Java host. |
| `java.game.parts.bodypart.Chassis.setSteerWheelRadius(float) → void` | — | No matching registration in the browser Java host. |
| `java.game.parts.bodypart.Chassis.setTorque(float) → void` | — | No matching registration in the browser Java host. |
| `java.game.parts.Part.flap(int) → int` | — | No matching registration in the browser Java host. |
| `java.game.parts.Part.getRenderType() → int` | — | No matching registration in the browser Java host. |
| `java.game.Vehicle.fileVersion() → float` | — | No matching registration in the browser Java host. |
| `java.game.Vehicle.getHorn() → int` | — | No matching registration in the browser Java host. |
| `java.game.Vehicle.hasCrime() → float` | — | No matching registration in the browser Java host. |
| `java.io.Input.activeAxis(int) → int` | — | No matching registration in the browser Java host. |
| `java.io.Input.axisName(int, int) → String` | — | No matching registration in the browser Java host. |
| `java.io.Input.mapAxis(GameRef, int, int, int, float, float, float, float) → void` | — | No matching registration in the browser Java host. |
| `java.io.Input.setAxisSmooth(GameRef, int, float, float, float, float) → void` | — | No matching registration in the browser Java host. |
| `java.io.MouseCursor.getPickedPos() → Vector3` | — | No matching registration in the browser Java host. |
| `java.io.MouseCursor.getPickedPos(Vector3) → Vector3` | — | No matching registration in the browser Java host. |
| `java.lang.Math.atan2(float, float) → float` | — | No matching registration in the browser Java host. |
| `java.lang.Math.exp(float) → float` | — | No matching registration in the browser Java host. |
| `java.lang.Math.ln(float) → float` | — | No matching registration in the browser Java host. |
| `java.lang.Math.log10(float) → float` | — | No matching registration in the browser Java host. |
| `java.lang.Object.disableGC() → void` | — | No matching registration in the browser Java host. |
| `java.lang.Object.enableGC() → void` | — | No matching registration in the browser Java host. |
| `java.lang.Object.errorVM(String) → void` | — | No matching registration in the browser Java host. |
| `java.lang.Object.runDLL(String, String, String, String[]) → String` | — | No matching registration in the browser Java host. |
| `java.lang.Object.runMethod(String, float) → int` | — | No matching registration in the browser Java host. |
| `java.lang.Object.runMethod(String, int) → int` | — | No matching registration in the browser Java host. |
| `java.lang.Object.runMethod(String, Object) → int` | — | No matching registration in the browser Java host. |
| `java.lang.Object.runMethod(String) → int` | — | No matching registration in the browser Java host. |
| `java.lang.System.analyze(float) → void` | — | No matching registration in the browser Java host. |
| `java.lang.System.analyze(int) → void` | — | No matching registration in the browser Java host. |
| `java.lang.System.analyze(Object) → void` | — | No matching registration in the browser Java host. |
| `java.lang.System.exit() → void` | — | No matching registration in the browser Java host. |
| `java.lang.System.exit(String) → void` | — | No matching registration in the browser Java host. |
| `java.lang.System.info(int) → String` | — | No matching registration in the browser Java host. |
| `java.lang.System.netHost() → int` | — | No matching registration in the browser Java host. |
| `java.lang.System.netJoin() → int` | — | No matching registration in the browser Java host. |
| `java.lang.System.netLeave() → int` | — | No matching registration in the browser Java host. |
| `java.lang.Thread.resume() → void` | — | No matching registration in the browser Java host. |
| `java.lang.Thread.suspend() → void` | — | No matching registration in the browser Java host. |
| `java.net.NetworkEngine.httpRequest(String, String, String, String) → String` | — | No matching registration in the browser Java host. |
| `java.render.Camera.activate(Viewport, int) → void` | — | No matching registration in the browser Java host. |
| `java.render.Camera.deactivate(Viewport) → void` | — | No matching registration in the browser Java host. |
| `java.render.Camera.setFog(int, float, float) → void` | — | No matching registration in the browser Java host. |
| `java.render.GfxEngine.printScreen(String) → void` | — | No matching registration in the browser Java host. |
| `java.render.GfxEngine.renderOK() → int` | — | No matching registration in the browser Java host. |
| `java.render.Viewport.unproject(Vector3, int) → Vector3` | — | No matching registration in the browser Java host. |
| `java.sound.Sound.getMode() → int` | — | No matching registration in the browser Java host. |
| `java.sound.Sound.setMode(int) → void` | — | No matching registration in the browser Java host. |
| `java.util.Replay.readFile(int, String, String) → float` | — | No matching registration in the browser Java host. |
| `java.util.Replay.writeFile(String, String) → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.Animation.<init>(RenderRef, ResourceRef) → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.Animation.finalize() → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.Animation.getPos() → float` | — | No matching registration in the browser Java host. |
| `java.util.resource.Animation.loopPlay() → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.Animation.pause() → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.Animation.play() → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.Animation.seek(float) → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.Animation.setFade(float) → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.Animation.setSpeed(float) → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.GameRef.isEmpty() → int` | — | No matching registration in the browser Java host. |
| `java.util.resource.GroundRef.addTrafficP(GameRef, Vector3, int, float, float, float) → int` | — | No matching registration in the browser Java host. |
| `java.util.resource.GroundRef.alignToRoad(Vector3) → Vector3[]` | — | No matching registration in the browser Java host. |
| `java.util.resource.GroundRef.clearHalts() → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.GroundRef.findRoute(Vector3, Vector3) → float` | — | No matching registration in the browser Java host. |
| `java.util.resource.GroundRef.getMaterialCount() → int` | — | No matching registration in the browser Java host. |
| `java.util.resource.GroundRef.getMaterialName(int) → String` | — | No matching registration in the browser Java host. |
| `java.util.resource.GroundRef.getPedestrianPos(Vector3, Vector3, int) → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.GroundRef.getRouteDist(Vector3) → float` | — | No matching registration in the browser Java host. |
| `java.util.resource.GroundRef.getRouteLength(Vector3, Vector3) → float` | — | No matching registration in the browser Java host. |
| `java.util.resource.GroundRef.getRoutePos(float) → Vector3` | — | No matching registration in the browser Java host. |
| `java.util.resource.GroundRef.getStartDirection(Vector3, Vector3) → Vector3` | — | No matching registration in the browser Java host. |
| `java.util.resource.GroundRef.getTrafficCarPos(int, Vector3) → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.GroundRef.haltTrafficCross(Vector3, float) → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.GroundRef.haltTrafficPath(Vector3, Vector3) → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.GroundRef.haltTrafficRoad(Vector3, Vector3) → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.GroundRef.pedestrianDistance(Vector3, int) → float` | — | No matching registration in the browser Java host. |
| `java.util.resource.GroundRef.remPedestrianType(GameRef) → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.GroundRef.remTrafficCar(int) → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.GroundRef.setTrafficCarBehaviour(int, int) → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.GroundRef.setTrafficCrossStopOffset(float) → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.GroundRef.setWater(float, float, float) → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.ParticleSystem.delAction(String) → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.ParticleSystem.getCounter(String) → int` | — | No matching registration in the browser Java host. |
| `java.util.resource.ParticleSystem.init(ResourceRef, RenderRef, String) → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.ParticleSystem.modePermanent(int) → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.ParticleSystem.setCounter(String, Vector3, float) → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.ParticleSystem.setDirectSource(String, Vector3, float, float, Vector3, float, float, float, String) → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.ParticleSystem.setFreq(float) → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.ParticleSystem.setSource(String, Vector3, float, float, Vector3, float, float, float, String) → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.ParticleSystem.stop() → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.PhysicsRef.create(ResourceRef, int, String) → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.PhysicsRef.createSphere(ResourceRef, float, String) → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.PhysicsRef.getVel(Vector3) → Vector3` | — | No matching registration in the browser Java host. |
| `java.util.resource.RenderRef.getBoneId(String) → int` | — | No matching registration in the browser Java host. |
| `java.util.resource.RenderRef.getDetail() → float` | — | No matching registration in the browser Java host. |
| `java.util.resource.RenderRef.plotRoute(ResourceRef, ResourceRef, int, float, Vector3) → int` | — | No matching registration in the browser Java host. |
| `java.util.resource.RenderRef.setColor(int) → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.RenderRef.setMatrix(int, ResourceRef, Vector3, Ypr) → void` | — | No matching registration in the browser Java host. |
| `java.util.resource.ResourceRef.makeSound(ResourceRef, String) → void` | — | No matching registration in the browser Java host. |
| `java.util.Steam.getPackage(int) → String` | — | No matching registration in the browser Java host. |
| `java.util.Steam.initAPI() → int` | — | No matching registration in the browser Java host. |
| `java.util.Steam.neutralize() → void` | — | No matching registration in the browser Java host. |
| `java.util.Steam.resetAchievements() → void` | — | No matching registration in the browser Java host. |
| `java.util.Steam.setAchievement(String) → void` | — | No matching registration in the browser Java host. |
