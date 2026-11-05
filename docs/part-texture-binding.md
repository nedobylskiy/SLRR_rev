# PTX materials and single-atlas diffuse binding

The ordinary mesh texture loader now accepts stock PTX textures, including the
accessory battery textures. PTX contains smallest-first JPEG mip records with
optional grayscale alpha JPEGs. The renderer decodes the last, full-resolution
record, combines alpha without premultiplying colour, and lets Three generate
sampling mips. Image bitmaps are closed after the canvas copy; the resulting
texture follows the existing material disposal path. This loader preserves the
whole image, unlike the separate cropped lamp/sun flare loaders.

The original Einvagen transmission render `0x126` in
`parts/engines/Einvagen_Duhen_Ishima_Focer.rpk` binds only `inline4_all.dds`.
Its SCX has diffuse indices 0 and 2. For this single-atlas case the renderer uses
the sole bound texture when a non-sentinel diffuse index exceeds the table.
This is a compatibility fallback, not a claim that native out-of-range texture
behaviour has been recovered. Explicit absent-map sentinels, missing entries
inside a table, and multi-texture renders retain their existing behaviour.
Reflection, detail and baked-lightmap indices are not remapped by this rule.

Validation includes mip record bounds/truncation, opaque and alpha JPEG paths,
largest-mip selection, bitmap cleanup and the restricted atlas fallback. A local
Chrome/WebGL render loaded the original black battery (128×128) and both
transmission materials (1024×1024), with no texture warnings; the resulting
render was visually inspected.

PTX layout reference: OpenSLRR
[`ptx_image.cpp` at 82f9cd7](https://github.com/EliasFD3S/openslrr/blob/82f9cd7045ea72f2008834898f9183c54d1a2241/src/resources/ptx_image.cpp).
