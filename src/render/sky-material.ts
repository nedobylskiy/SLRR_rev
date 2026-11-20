import {MeshBasicMaterial,type Material,type MeshStandardMaterial,type Color} from 'three';

/** Authored sky colours are already lit; neither scene lights nor exposure relight them. */
export function skyMaterial(source:Material,fogColor:Color,fogEnabled:{value:number}):MeshBasicMaterial{
  const original=source as MeshStandardMaterial;
  const material=new MeshBasicMaterial({
    name:source.name,map:original.map,alphaMap:original.alphaMap,color:original.color,
    opacity:source.opacity,transparent:source.transparent,alphaTest:source.alphaTest,
    side:source.side,blending:source.blending,blendSrc:source.blendSrc,blendDst:source.blendDst,
    blendEquation:source.blendEquation,premultipliedAlpha:source.premultipliedAlpha,
    depthTest:source.depthTest,depthWrite:false,fog:false,toneMapped:false,
  });
  material.userData.sky=true;
  material.onBeforeCompile=shader=>{
    shader.uniforms.slrrSkyFogColor={value:fogColor};
    shader.uniforms.slrrSkyFogEnabled=fogEnabled;
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>','#include <common>\nvarying float vSlrrSkyElevation;')
      .replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nvec3 slrrSkyWorldPosition = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvSlrrSkyElevation = normalize( slrrSkyWorldPosition - cameraPosition ).y;');
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>','#include <common>\nuniform vec3 slrrSkyFogColor;\nuniform float slrrSkyFogEnabled;\nvarying float vSlrrSkyElevation;')
      .replace('#include <opaque_fragment>','float slrrHorizonFog = ( 1.0 - smoothstep( -0.015, 0.14, vSlrrSkyElevation ) ) * slrrSkyFogEnabled;\noutgoingLight = mix( outgoingLight, slrrSkyFogColor, slrrHorizonFog );\n#include <opaque_fragment>');
  };
  material.customProgramCacheKey=()=> 'slrr-unlit-sky-horizon-fog-v2';
  return material;
}
