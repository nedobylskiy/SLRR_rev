# UV containers Test Track

`objects.rpk:0x522` links `objects/meshes/kontener/kontener.scx` with `maps/textures.rpk:0x11f` (`maps/textures/kontener.dds`). The SCX material contains one map `DiffuseMixSecond`, index 0, UV channel 0, scale 1x1 and offset 0. The render resource has no additional UV transformation. The render now takes into account the UV channel, scale and offset of other SCX materials, but in this case they do not explain the mismatch. Rotating the V alone also cannot match the design on all edges.

SCX has 12 cuboid triangles and six separate UV rectangles. Their boundaries along V are located around 0, 1/3, 2/3 and 1. According to the normals of the faces: the short ends X± use the right areas of the second and third rows, the long sides Z± use the left areas of the first and second, the top and bottom use the remaining areas of the first and third. This is a meaningful layout for an atlas of 2 columns × 3 rows.

In the current Steam installation, `kontener.dds` has a size of 512x512 and a different atlas: doors in the upper left quarter, sides in the upper right and lower half. The boundaries of its drawing do not coincide with the UV boundaries of SCX, so parts of neighboring areas are visible on the edges. `kontenertext1.dds` is 256x256 and has a 2x3 satin that matches the scan, but the pattern is rusty rather than the gold of the reference photo.

A comparison with the transmitted archive of researcher Elias (`local/SLRR-REVERSE-WIP.zip`) clarifies the origin of the discrepancy:

|Resource|Elias Archive|Current Steam installation|
|---|---|---|
| `kontener.scx` | SHA-256 `15a81b2c7164…` |same file|
| `kontener.dds` |SHA-256 `2bb7a6c5d0cd…`, 256×256, rusty satin 2×3|SHA-256 `02a6d10f03ca…`, 512×512, golden satin 2×2|
| `kontenertext1.dds` | SHA-256 `2bb7a6c5d0cd…` |the same rusty satin 2x3|

The RPK render link to `kontener.dds` remains the same. Consequently, there is a discrepancy between the specific version of the texture and the unchanged scan of the model. It is impossible to derive a universal permutation of areas of the new atlas from the available SCX/RPK: the texture does not store the correspondence of the faces. Random global UV shuffling would make other models and mods worse.

According to the option chosen for the test scene, the render takes the old atlas `kontenertext1.dds` preserved in the same installation. The UV coordinates of the model do not change. The substitution works only for a verified regular pair: the path, SCX geometry fingerprint and SHA-256 of both DDSs must match. For other resources, including mods, the usual link from the RPK works. This is version-specific data compatibility, not a rule of the original engine. The color of the containers will still be rusty and will not match the golden reference; The position of the pattern on the faces must be checked visually in the test scene.
