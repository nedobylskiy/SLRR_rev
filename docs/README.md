# Research on SLRR and the new engine

Date of primary research: October 23, 2026. Object is a specific local Steam installation with modifications. Findings may not automatically carry over to all versions of SLRR.

## Navigation

|Document|Content|
|---|---|
|[Status and playback](status.md)|What has actually been implemented and what has been verified?|
|[Installation map](installation.md)|Files, game layers, native border|
| [RPK/RDB](formats/rpk.md) |Binary table, dependencies, resource IDs|
| [SCX/SCY/TEX](formats/scx.md) |Geometry, materials, versions 3 and 4|
|[Maps](maps.md)|Loading built-in Test Track and support boundaries|
| [TUFA/TREE](formats/tufa.md) |Original `.class`, constants, methods, nodes|
|[Other formats](formats/other.md)|CFG, textures, maps, animation, unknown|
|[Vehicle condition](vehicle-serialization.md)|Old SDAT, save/load, new buffer format|
|[Architecture](architecture.md)|Implemented modules and planned structure|
|[Engine World](engine-world.md)|RPK/CFG factory, instances, assembly, transforms and boundaries|
|[Game functionality](gameplay.md)|What is needed for a managed machine, native contracts and current gaps|
|[Mounts and test drive](mounts-and-driving.md)|compatible/slottype, five cars, controls, motion model and restrictions|
|[Deformable Physics](deformable-physics.md)|Audit of the found reverse, plasticity, separation of parts and the next prototype|
|[Original hood stand](hood-prototype.md)|Working demo, XPBD framework, supports, impulses, results and limitations|
|[Collision of assembled car](car-crash-demo.md)|Hood contact, moving fasteners, EngineWorld.detach and independent part|
|[Body Contacts and Recoil](body-contacts.md)|Triangles of the original car, falling of the hood onto the roof, impulses and rebound of the chassis|
|[Car in 3D](vehicle-3d.md)|CFG suspension, deformable mounts, part condition, physics meshes and performance|
|[Stock suspension and engine components](original-mechanics.md)|Selection of original parts, numerical parameters, damage and limitations of the prototype|
| [Part source runtime](part-runtime.md) |Original save/load via memory and check limits|
|[Multiplayer](multiplayer.md)|Server authority, snapshots, lifecycle|
|[DLLs and binaries](legacy-extensions.md)|runDLL/runMethod, intermediate EXE, bridge errors|
|[Roadmap](roadmap.md)|Stages with acceptance criteria|
|[Sources](sources.md)|Direct links, versions, reliability|
|[Working archive Elias](elias-workspace-archive.md)|IDA, native ABI, wheel physics, third-party host boundaries|

## Confidence levels

**Confirmed by the corpus** - the parser checked the structure on local files with full consumption of the corresponding sections. This is not a proof of the semantics of each field.

**Confirmed by source** - the procedure is visible in the local Java files; execution of native functions does not follow from this.

**External analysis** - information from the public reconstruction. Addresses in someone else's EXE cannot be applied to another binary without checking the hash and binding functions.

**Design solution** - design of a new engine. It should not be described as an existing feature of the old EXE.

## Machine-readable materials

`reports/inventory.json` - quantities, signatures, RPK and PE hashes, package dependencies. `reports/classes.json` - names and sizes of TUFA classes. `reports/native-candidates.json` - native/abstract/declaration candidates and explicit declarations from Java. An empty tree by itself does not prove that the method is native. `reports/pe-comparison.json` - comparative analysis of two EXEs and libcall.dll.

The contents of game saves and the full source DLL are not published in these reports.
