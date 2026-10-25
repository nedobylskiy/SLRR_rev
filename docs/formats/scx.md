# SCX / SCY / TEX

SCX is the Invictus 3D model format. Parser `src/formats/scx.ts`, renderer `src/render/viewer.ts`. Out of 6033 files, one is zero; the remaining 6032 are structurally readable. An empty valid INVO header is a placeholder, not a damaged model.

Primary external reference: [io_invo_scx](https://github.com/nonamesex/io_invo_scx/tree/7bcc34e51a3cb40369cc28db2950ab27f9587078), especially [ImHex description](https://github.com/nonamesex/io_invo_scx/blob/7bcc34e51a3cb40369cc28db2950ab27f9587078/imhex/scx.hexpat). The implementation is written separately; This importer's code was not copied.

All numbers are little-endian. Header: `INVO` + u32 version.

## Version 3

Next, the materials with geometry are repeated:

1. u32 material size, including this field: 56, 104, 136 met. Size zero completes the list.
2. Material: diffuse RGBA f32[4] (+4), specular RGB f32[3] (+20), specular weight (+32), glossiness (+36), flags u32 (+40), diffuse/bump/specular/reflection/layer2 texture indices u16 (from +44). `0xffff` means no texture map.
3. Advanced material >56 contains additional channels, vertex size and lighting. Block 136 contains the name char[32] by +104.
4. u32 vertex count; vertices are 44 bytes for material 56 and 64 for 104/136.
5. u32 triangle count; for each triangle u32[3] indices.

Base vertex: position f32[3], normal f32[3], UV1 f32[2], UV2 f32[2], color u8[4]. The 64-byte version adds 8 service bytes, UV3 f32[2], 4 service bytes. The parser stores all three sets of UVs, the fifth material texture index (`layer2`, offset +52), flags (+40) and explicitly specified channels of the main and second maps (+70 and +72 in the extended material). Channel 0 corresponds to UV1, 1 to UV2, 2 to UV3. For example, `area_1934.scx` grass `area.dds` uses channel 2 with hundreds of repetitions, and `invictus_racing500.dds`, `ReallyFast_Text.dds` and `DragRacingofStates.dds` in the second layer use channel 0, about 0..1. It was a mistake to select UVs based on coordinates: neighboring materials without a second layer also use UV3.

The `0x1` flag (`alphaOpacity` in [ImHex description](https://github.com/nonamesex/io_invo_scx/blob/7bcc34e51a3cb40369cc28db2950ab27f9587078/imhex/scx.hexpat#L5-L15)) turns on the transparency of the main map, and `0x40` turns on the blending of the second layer according to its alpha. On Test Track, `area_1810.scx` uses `cross.dds` as an **opaque RGB asphalt**, although the alpha of this DDS is almost zero: the material has `0x40`, but not `0x1`. The second layer `parkolo01.dds` gives the markings. The previous render turned on the transparency of the main map simply by the presence of alpha in the file, which is why the WebGL background color was shown instead of the coverage. For `park_fnc.dds`, the neighboring material has `0x101` flags, so its cut alpha remains active. This is confirmed by real SCX fields and visual DDS content; the remaining v3 blending modes have not yet been reconstructed.

## Version 4

After version: u32 directory count; then pairs u32 type, u32 absolute offset. Each chunk starts with `type:u32`, `size:u32`. **Size includes these 8 bytes** - tested on the entire local corpus, this is important for strict boundaries.

| type |Purpose|
|---:|---|
| 0 |Material|
| 1 |Hard surface / start of physics-only group|
| 2 | Sparse bone list |
| 3 | Bone list |
| 4 |Peaks|
| 5 |Indexes|

Material: flags, function word, property count, then typed properties. Colors 0..2 have RGBA u8[4]. Values 0x01000000..2 - f32. Maps 0x06000000..5 contain seven 32-bit values: texture index, channel, tiling flags, scale U/V, offset U/V. For the selected diffuse map, the renderer now applies the corresponding UV channel and affine transformation `u'=u·scaleU+offsetU`, `v'=v·scaleV+offsetV`. The observed flag tiling=3 is retained, the exact behavior of other values has not yet been tested. Name 0x08000000 is char[32]. The corpus contains additional properties 0x05000000 and 0x07000000, one dword each: the structure is readable, the purpose and shading have not yet been implemented.

`0x06000000` is the primary diffuse map; `0x06000001` is the secondary diffuse map (`DiffuseMixSecond`). Some models, including `objects/meshes/kontener/kontener.scx`, contain only the latter. Its index 0 points to the sole `texture` in the `objects.rpk` render resource: `maps/textures/kontener.dds`. When there is no primary map, the renderer uses the secondary map for color. When both are present, the primary map takes precedence regardless of property order. The original shader's two-map blending has not yet been reproduced. The current `kontener.dds` also has a separate [atlas/UV mismatch](../test-track-container-uv.md), unrelated to the choice of map index.

Vertex chunk: count u32, flags u32, interleaved records. Bits: position 0x1; influence group 0x2/4/8/10; bone indices 0x20; normal 0x40; emissive 0x80; color 0x100; UV1 0x200; UV2 0x400; UV3 0x800; tangent/bump normal 0x40000. UV2/UV3 are now readable and available to the material. An audit of the current installation found 13 environment models with additional UV channels and hundreds of diffuse map entries with scale/displacement other than one/zero.

**The weights are not an independent float per bit set.** Group 0x2 means one die and 0 explicit weights; 0x4 - two dice and 1 weight; 0x8 - three and 2 weights; 0x10 - four and 3 weights. The last weight is not stored. This is tested on `humans/drivers/police.SCX`; an invalid stride breaks all subsequent data.

Index chunk: u32 number of **indices**, then u16[count], not count of triangles. One material group can have several vertex/index pairs (for example, by bone groups). The parser should not overwrite previous geometry.

## Textures, axes and scale

`.tex` - line-by-line list of textures, the material is referenced by index. This is a fallback for standalone SCX. When loading via RPK, the order is taken from the repeating `texture` in the RSD. DDS/TGA/PNG/JPEG are decoded by Three.js loaders; DDS compression support depends on WebGL extensions.

The render takes into account the alpha channel of the original texture: for DXT1/DXT3/DXT5 the top level of DDS is checked, masks with transparent and opaque pixels are drawn through `alphaTest` with depth recording (foliage, gratings), smooth transparency is through blending. For PNG/TGA with alpha channel, already decoded pixels are checked: the fully opaque RGBA map remains in the normal pass. For example, `cars/textures/default_white.png` has an RGBA title, but the alpha of all pixels is 255; the previous blending without recording depth caused the body panels to show through each other. The result of the check is cached along the texture path within the current scene. This also eliminates the white rectangles around Test Track foliage (`Lomb3.dds` contains DXT3 alpha), but does not reproduce all of the original engine's material effects.

The parser preserves the original axes and units. When viewed separately, the model is centered and scaled to inspection size. In the CFG world, SCX vertices are converted to meters with a coefficient of **0.01**, without rearranging the axes. On the Baiern this gives a body length of 4,212 m and combines the hood/door geometry with CFG mounts; `verify:world` checks the size and placement of real meshes. For bone/compound, other types of resources and mods, calibration must be continued. Blender axis swaps do not carry over to WebGL.

## What is not yet supported visually

Skeletal animation, deformation, geometry damage, coloring, vertex colors, most special layers, normal/reflection/emissive maps and accurate lighting of the original. For v3, implemented an observable layer `layer2` with alpha blending on top of the basemap; other material modes have not yet been reproduced. Reading 6032 files does not mean that these effects are visually identical. SCY has declared support in a foreign importer, but a separate full run of local SCY is not yet included.
