# Baked lightmaps and dynamic shadows

Graphics / map debug exposes independent switches:

- **Baked lightmaps**: authored SCX lighting/shadow textures. Initially off.
- **Dynamic shadows**: the renderer's sun shadow map. Initially off.
- **Dynamic lighting**: sun/ambient shading. Initially on.
- **Vertex colors**: authored vertex RGB. Initially on.

All combinations are allowed, including baked lighting with dynamic shadows and
dynamic lighting. For a diffuse-times-bake inspection, enable baked maps and
disable dynamic lighting. Combining lighting sources can darken the result;
the switches deliberately do not change each other.

SCX v3 extended materials store a signed texture index at material offset `0x38`.
Negative values mean absent; v3 always uses UV channel 1 (the second channel).
The 56-byte header has no baked-map field. V4 uses map property `0x06000007`,
with its authored UV channel and centred scale/offset transform. `0x06000004`
is not a lightmap. Missing UVs or texture files do not substitute diffuse UVs.

The render layer loads baked maps as lighting coefficients, without sRGB decode,
and multiplies the illuminated surface by them before output encoding. Emission
is preserved. This is a separate shader stage rather than Three's additive
`lightMap`, so the material can combine the baked result with dynamic shadowing.
Its shared enable uniform also affects subsequently streamed objects, without
rebuilding geometry or shaders on every toggle. Baked textures are released on
scene disposal, stream eviction and cancelled stream loads.

A future baker can supply replacement coefficients through this same rendering
stage; it must also supply the corresponding UV layout and texture binding.
No baker or automatic rebaking is implemented here.

Format/UV reference: OpenSLRR at
[`82f9cd7`, scx_mesh.cpp](https://github.com/EliasFD3S/openslrr/blob/82f9cd7045ea72f2008834898f9183c54d1a2241/src/resources/scx_mesh.cpp)
and [fs_mesh.sc](https://github.com/EliasFD3S/openslrr/blob/82f9cd7045ea72f2008834898f9183c54d1a2241/shaders/fs_mesh.sc).
Unlike that renderer's baked-only lighting path, this implementation keeps the
dynamic lighting contribution independently selectable.

Validation covers v3 signed/absent indices, v4 property selection, UV atlas
transforms, independent shader uniforms and streamed texture disposal. A local
headless Chrome/WebGL probe rendered all eight bake/light/shadow combinations;
each switch changed its contribution independently.
The original city/city2 render resources resolved all 577 mapped material
references with no missing baked UV channels. A browser render of the original
`Wall_123.scx` bound eight baked materials without warnings and changed pixels
when toggled. This count covers external SCX render resources, not embedded
ground POLY data; a separate POLY decoder is outside this change.
