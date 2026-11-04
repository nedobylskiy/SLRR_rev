import { BufferAttribute, BufferGeometry, ClampToEdgeWrapping, MeshStandardMaterial, NoColorSpace, Texture } from 'three';
import type { ScxMesh } from '../formats/scx';

/** Original baked maps modulate illumination; Three's additive lightMap has different semantics. */
export function bakedLightmapUvs(part: ScxMesh): Float32Array | undefined {
  const map = part.lightmapMap;
  const channel = map?.channel ?? 1;
  const source = channel === 0 ? part.uv : channel === 1 ? part.uv2 : channel === 2 ? part.uv3 : undefined;
  if (!source) return;
  const uv = new Float32Array(source.length);
  for (let i = 0; i < source.length; i += 2) {
    // The authored transform scales around the texture centre and subtracts
    // offsets, with V's opposite orientation. Preserve this for v4 atlases.
    uv[i] = ((source[i] - 0.5) - (map?.offsetU ?? 0)) * (map?.scaleU ?? 1) + 0.5;
    uv[i + 1] = 0.5 - ((0.5 - source[i + 1]) - (map?.offsetV ?? 0)) * (map?.scaleV ?? 1);
  }
  return uv;
}

export function configureBakedLightmap(material: MeshStandardMaterial, geometry: BufferGeometry,
  uv: Float32Array, texture: Texture, enabled: { value: number }): void {
  geometry.setAttribute('slrrBakedUv', new BufferAttribute(uv, 2));
  // Lighting coefficients are data, not diffuse colours. No sRGB conversion.
  texture.colorSpace = NoColorSpace;
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
  material.userData.bakedLightmapTexture = texture;
  const previous = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.slrrBakedLightmapEnabled = enabled;
    shader.uniforms.slrrBakedLightmap = { value: texture };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 slrrBakedUv;\nvarying vec2 vSlrrBakedUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSlrrBakedUv = slrrBakedUv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float slrrBakedLightmapEnabled;\nuniform sampler2D slrrBakedLightmap;\nvarying vec2 vSlrrBakedUv;')
      .replace('#include <opaque_fragment>', `
if (slrrBakedLightmapEnabled > 0.5) {
  vec3 slrrBake = texture2D(slrrBakedLightmap, vSlrrBakedUv).rgb;
  outgoingLight = (outgoingLight - totalEmissiveRadiance) * slrrBake + totalEmissiveRadiance;
}
#include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => `${key}|slrr-baked-lightmap-v1`;
  material.needsUpdate = true;
}
