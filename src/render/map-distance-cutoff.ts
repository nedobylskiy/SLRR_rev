import {Vector3,type MeshStandardMaterial} from 'three';

/** Exact horizontal cutoff on boundary cells; whole far cells are culled on CPU. */
export class MapDistanceCutoff {
  readonly enabled={value:0};
  readonly focus={value:new Vector3()};
  readonly radius={value:500};
  configure(material:MeshStandardMaterial){
    const previous=material.onBeforeCompile,key=material.customProgramCacheKey();
    material.onBeforeCompile=(shader,renderer)=>{
      previous.call(material,shader,renderer);
      shader.uniforms.slrrMapCutoffEnabled=this.enabled;
      shader.uniforms.slrrMapCutoffFocus=this.focus;
      shader.uniforms.slrrMapCutoffRadius=this.radius;
      shader.vertexShader=shader.vertexShader
        .replace('#include <common>','#include <common>\nvarying vec2 vSlrrMapCutoffXZ;')
        .replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
vec4 slrrCutoffWorld=vec4(transformed,1.0);
#ifdef USE_INSTANCING
slrrCutoffWorld=instanceMatrix*slrrCutoffWorld;
#endif
vSlrrMapCutoffXZ=(modelMatrix*slrrCutoffWorld).xz;`);
      shader.fragmentShader=shader.fragmentShader
        .replace('#include <common>',`#include <common>
varying vec2 vSlrrMapCutoffXZ;
uniform float slrrMapCutoffEnabled;
uniform vec3 slrrMapCutoffFocus;
uniform float slrrMapCutoffRadius;`)
        .replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
vec2 slrrCutoffDelta=vSlrrMapCutoffXZ-slrrMapCutoffFocus.xz;
if(slrrMapCutoffEnabled>0.5&&dot(slrrCutoffDelta,slrrCutoffDelta)>slrrMapCutoffRadius*slrrMapCutoffRadius)discard;`);
    };
    material.customProgramCacheKey=()=>`${key}|slrr-map-cutoff-v1`;material.needsUpdate=true;
  }
}
