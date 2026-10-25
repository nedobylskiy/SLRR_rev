# Search for original map collision

Checking local Steam installation on October 24, 2026. You can reproduce the inventory using the command `npm run audit:map-physics`; the name of the other card is passed as the second argument after the game root: `npx tsx tools/audit-map-physics.ts <game-root> city`. The tool only reads files. It is important to distinguish between the original text `.rdb`, the assembled `.rpk`, the individual `.SCX/.SCY`, and the algorithm inside the EXE.

## Confirmed data

| | Test Track | City |
|---|---:|---:|
|`typeof 1` objects in text RDB| 1597 | 11003 |
|`type 1` objects in the assembled RPK| 1 | 1 |
|Render resources `type 14` in RPK| 169 | 142 |
|Mesh resources `type 5` in RPK| 170 | 148 |
|Explicitly named `_phys.SCX` in the RPK|absent| `c1_phys.SCX` |

The number of mesh resources in the audit output can be one less than the total number of `type 5`: it only counts entries with text `sourcefile`. The vast majority of `typeof 1` instances from the RDB were not included in the installed RPK. Their coordinates can be used to reconstruct visible objects, but the match of this text version of the map with the installed EXE has not been proven. Nor can it be argued that missing `obstacles/*.rpk` are available only because they are listed in `external_links`. Test Track does not have these three dependency files in the installation: `obstacles/common.rpk`, `obstacles/test_track.rpk`, `obstacles.rpk`.

Checking the missing containers yielded a specific chain: RDB contains 80 instances of `gametype 0x00060527` with `params x,y,z,yaw,pitch,roll`; the dependency `0x0006` points to `objects.rpk`, where the resource `0x527` contains the compiled `ICFG`. Its initial `objects/scripts/kontener.cfg` specifies `render 0x522` and `body ... box 2.705278 1.347327 1.354536`. The render resource points to `objects/meshes/kontener/kontener.scx`. Similarly, another 1333 instances of 10 types are resolved. Now they are displayed, and `box` shapes are involved in the contacts of the body and the support of the wheels on top. This is part of the **original object physics data**, but not yet the original contact algorithm or road physics.

The assembled Test Track references `palya.scY`, whereas the text RDB references `palya.scx`. The first file contains 86 materials and **zero triangles** in the proven INVO v3 structure; the second is 11,295 triangles and is used by our loader as a visual fallback. This does not prove that the game uses `palya.scx` for collisions. Signatures `PHYS` and `POLY` (search for byte sequence) were not found in the resource payload Test Track; their absence does not exclude different packaging of physical data or the generation of a collision during loading.

City has a separate `c1_phys.SCX` (12,126 triangles), connected through the mesh resource `0x16d` and the render resource `0x16e`. The name makes it a candidate for the original physical surface, but there is no EXE loader trace yet to confirm the use of this particular file for pins. A separate `_phys.SCX` was not found in the Test Track resources. SCX v4 has chunk `type 1` (`HardSurfaceDef` in [format description](formats/scx.md)); The Test Track and `c1_phys.SCX` meshes are version 3, so this mechanism does not explain their collision. The SCX v3 material flags in [format parsing](https://github.com/nonamesex/io_invo_scx/blob/7bcc34e51a3cb40369cc28db2950ab27f9587078/imhex/scx.hexpat) describe blending/transparency, not the collision flag we set.

## Current boundary and next step

### Checking the Steam EXE loader

Checked installed `StreetLegal_Redline.exe` (SHA-256
`F44FB88A4335C657E20701CDB84AFB8D1D85F7C3ACEB93D30113E6E6E44FEFC2`).
This is a different binary than the EXE sent separately and the EXE from the Elias archive;
Function shifts cannot be transferred between them. PDB symbols in installed
no file; the following names are obtained from RTTI, strings and addresses are virtual
addresses of this particular PE with the base `0x400000`.

|Address|Observation in machine code|What should not be concluded yet|
|---|---|---|
| `0x4BADE0` (`_type_ground::virtual_12`) |Parses a record of format `%x,%f,%f,%f,%f,%f,%f,%s,%s`; reads `gravity` and `ground_friction`.|The record format has not yet been mapped byte-by-byte to RDB/RPK.|
|`0x4BB19F` inside her|Passes the name `groundbody` to the general constructor of the `0x4E8A50` object, then calls the functions `0x4EBDD0` with the mask `0x200000` and `0x4EABC0`.|The name itself does not prove the shape of the physical body. The mask value has not yet been set.|
|`0x4BB1DB` inside her|Resolves a resource of type `0x0e` by parsed ID and creates `r_ground`/`bone00`; this is a separate display path.|The displayed mesh cannot be automatically considered a collision.|
| `0x451130` (`CompatibleMesh_ground::virtual_20`) |Checks the `INVO` signature and parses mesh versions; This is confirmed by the special ground-mesh loader.|It has not yet been established which mesh he receives on the Test Track and which sections are given to physics.|

The `0x4E8A50` call is used in ten other places in the EXE, so the following
check - associate its shared object with `RIF_UPDATECOLLISION` and real
creating collision geometry, and then compare the input resource with `palya.scx`,
`palya.SCY` and `c1_phys.SCX` on City. For the springboard **not yet discovered**
separate CFG-body: treat its visible triangles as original collider
would be an unconfirmed guess.

### Can a physical body be a mesh?

**Yes.** In the installed game, 4855 lines of `body` were found in CFG; 3419 of them
refer to `.scx` (1894 different paths), the rest mostly use
`sphere` and `box`. For example,
`objects/scripts/19x6_garazs.cfg` specifies two bodies via
`objects/meshes/19x6_garazs/phys_01.scx` and `phys_02.scx`, and the display is
separate `render` resources. The first physical mesh contains 12
triangles, while the visible garage model contains 214. This is a straight
example that the original collision boundaries may differ from
visible surfaces, even when both files are in SCX format.

In the Steam EXE, the form handler near `0x4BC021–0x4BC1BC` compares the string
with `ball`, `sphere`, `box`, `rodx`, `rody`, `rodz`. For another line it
passes it as a file name to the constructor of the form `0x4F7D60` with a code of type `6`.
A branch like `6` at address `0x4F817F` calls the loader `0x4F5B90`;
it reports `Fatal! Missing mesh file` if there is no file and parses
INVO structure, including triangle indices. This confirms support
mesh as a physical form in the binary itself, and not just the CFG syntax.

**For the Test Track springboard, the source of the form has not yet been set.** In the found ones
CFG of placed objects there is no separate `body` for it; he could be part
physical soil grid, but this does not follow from the visual model alone.
EXE support for mesh-body makes this hypothesis plausible without having to prove it.
that this particular visible mesh is used for contacts.

#### Test Track wooden jumps found

Identifying visual patterns is no longer a barrier. This
`maps/test_track/meshes/Box10.scx` and `Box11.scx`, mesh resources `0xAC` and
`0xAF`, connected via render resources `0xAD` and `0xB0` under the root
`0x14`. The textures of both render resources are resolved to
`maps/textures/Deszka02.dds` (boards) and `gerenda2.dds` (beams). Every SCX
contains 280 triangles, has dimensions of about 11.7 × 2.9 × 5.0 m;
the vertices are already specified in map coordinates. Example of `Box10` boundaries after
conversion to meters: `x=-223.1…-211.5`, `y=-0.2…2.7`,
`z=-1032.4…-1027.4`. Nearby there are containers from RDB, including
`x=-230.742`, `z=-1038.196`.

In the **text** RDB there are entries `Box10`/`Box11` of type `1`, but in
**collected** `test_track.rpk` only mesh/render resources remain for them;
their models are included in the mapping hierarchy `ground` without a separate CFG.
There is no `body` or reference to physical SCX in their RSD. Therefore the question
now not “what model is this?”, but “which sections of the `Box10/Box11` bootloader
`ground` passes to physics and how does it choose the contact surface?
Their 280 visible triangles cannot be declared to be the exact original shape,
this EXE branch has not been traced yet.

### How the physical form of an ordinary object is chosen

The choice is recorded in the **CFG of the resource**, and in the collected RPK it is saved in the payload
`ICFG` along with the command text. `render <resource>` assigns the displayed
model; a separate command `body x y z yaw pitch roll mass <shape>` specifies
physical body and its position. `<shape>` can be primitive (`box`,
`sphere`, etc.) with parameters or the path to the physical SCX. Name
`_phys` on the way - game file agreement, not engine switch: to load
mesh is indicated precisely by the command argument `body`.

Examples from installation:

| CFG |Display|Physical form|
|---|---|---|
| `objects/scripts/kontener.cfg` | `render 0x522` | `body ... box 2.705278 1.347327 1.354536` |
| `objects/scripts/19x6_garazs.cfg` |several `render`|two `body ... phys_01.scx` and `phys_02.scx`|
| `objects/scripts/fa03a.cfg` |two `render` with LOD|there is no explicit `body`|
| `objects/scripts/fa06a.cfg` |two `render` with LOD|`body 0 3 0 ... box 0.0501 3 0.0501` - narrow barrel|
| `objects/scripts/fa12a.cfg` |two `render` with LOD|`body 0 4 0 ... box 0.050 6 0.050` - narrow barrel|
| `misc/garage/vehicle_lift/scripts/lift_arm.cfg` | `render 0x0a` |`body ... _phys_lift_arm.scx`, then `nocollision`|

`bounds` is present in the tree even without `body`: this is separate boundary data
object, not evidence of physical form. `nocollision` after `body`
shows that the body can exist without ordinary contacts; For example,
in cars, floating bodies with `buoy` are marked this way. For a normal object without
`body` should not automatically build collisions from `render`.
On Test Track, from the available `objects.rpk`, 881 copies of `fa06a` and 105 `fa12a` are allowed with these original boxes. Previously, the prototype tested collisions only at eight corners of the body: the 0.1 m thick trunk usually ended up between them, so the car went through the tree, although its `body` was already loaded. Now each such `body` is checked against the entire oriented volume of the body; The collision impulse is transferred to the deformable parts. Foliage is not involved in contacts. The original solver's accuracy and response to `fa03a` (without explicit `body`) has not yet been confirmed.
Ground/road maps are loaded in their own way (`_type_ground`) and require
separate check - a rule for CFG objects is impossible without proof
transfer to `palya.scx`.

Our `MapTerrain` indexes the **visual** triangles of all ground-SCXs as static surfaces; `MapCollision` builds side contacts from the same triangles. These are monolithic triangular collision meshes rather than independently moving physical vertices. Previously, when covering the ramp deck with asphalt, the vertical sampling preferred a height closer to zero. After identifying `Box10/Box11`, it selects the top surface below the query point (with a penetration tolerance of 0.5 m); the body and free parts convey their own height so as not to be attracted to the distant surface above them. On a real map, at `x=-214,z=-1031.5` the flooring `y≈1.67` is now selected, and for the point below it the asphalt `y≈0.12` is selected. This corrects the known conflict between two layers **in the prototype**, but does not prove that its triangles or tolerances match the original collider.

To restore the original behavior, you need to trace in the **original EXE of the selected version** the path `GroundRef` → loading the map/mesh → creating physical primitives → requests for wheel and body contacts. The addresses from the [Elias archive](elias-workspace-archive.md) refer to a different EXE; his `Physics_Step` is marked by the author as `Soft` and does not reproduce the original solver. You should check your hypotheses on Test Track and City: which resource is loaded as a collider, how SCY and `_phys.SCX` are used, whether the collision is transferred from RDB, and then compare the coordinates and normals of individual surfaces with the original game. The wooden springboard is not selected among the 11 recognized types of Test Track objects with CFG shapes: its support is still taken from the visual `Box10/Box11.scx`. The top of the confirmed CFG boxes is also accessible to the wheel beams, but this does not establish the origin of the physical surface of the springboard. Before the EXE trace, the map collision in the demo should be considered temporary.
