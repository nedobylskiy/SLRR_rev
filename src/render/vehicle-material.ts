import { Vector4, type MeshStandardMaterial, type MeshBasicMaterial, type Texture } from 'three';
import type { ScxMesh } from '../formats/scx';

export interface VehicleReflectionUniforms {
  environment: { value: Texture | null }; available: { value: number }; dynamic: { value: number };
}
/** Original authored diffuse mix and additive 2D reflection pass; no tinting of the whole car atlas. */
export function configureVehicleMaterial(material: MeshStandardMaterial | MeshBasicMaterial, mesh: Pick<ScxMesh, 'reflectionIndex' | 'reflectionStrength' | 'reflectionMap' | 'materialType'>,
  uniforms: VehicleReflectionUniforms, detail?: Texture, reflection?: Texture) {
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  const strength = 0.5 * Math.max(0, Math.min(1, Number.isFinite(mesh.reflectionStrength) ? mesh.reflectionStrength! : 0.5));
  const masked = mesh.materialType === 0x15 && !!detail;
  const painted = !!material.userData.paintDefault;
  const reflected = mesh.reflectionIndex !== undefined || !!reflection || painted;
  if (reflected && 'roughness' in material) {
    material.userData.vehicleReflective = true;
    material.roughness = 0.24; material.metalness = 0.25; material.envMapIntensity = 0;
  }
  if (reflection) material.userData.reflectionTexture = reflection;
  if (detail) material.userData.detailTexture = detail;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.slrrDetail = { value: detail ?? null };
    shader.uniforms.slrrReflection = reflection ? { value: reflection } : uniforms.environment;
    // Painted panels can reserve an unbound reflection slot with ordinary UVs.
    // The shared environment fallback needs generated coordinates, not the panel atlas UVs.
    const generated = !mesh.reflectionMap || mesh.reflectionMap.channel === 0xfffffffe || painted && !reflection;
    shader.uniforms.slrrReflectionAvailable = reflection ? { value: 1 } : generated ? uniforms.available : { value: 0 };
    shader.uniforms.slrrRealReflections = uniforms.dynamic;
    const map = mesh.reflectionMap;
    shader.uniforms.slrrReflectionTransform = { value: new Vector4(map?.scaleU ?? 1, map?.scaleV ?? 1, map?.offsetU ?? 0, map?.offsetV ?? 0) };
    if (detail) {
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 slrrDetailUv; varying vec2 vSlrrDetailUv;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSlrrDetailUv = slrrDetailUv;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D slrrDetail; varying vec2 vSlrrDetailUv;')
        .replace('#include <map_fragment>', '#include <map_fragment>\nvec4 slrrDetailColor = texture2D(slrrDetail, vSlrrDetailUv);\nvec3 slrrPaintEncoded = sRGBTransferOETF(vec4(diffuseColor.rgb, 1.0)).rgb;\nvec3 slrrDetailEncoded = sRGBTransferOETF(vec4(slrrDetailColor.rgb, 1.0)).rgb;\ndiffuseColor.rgb = sRGBTransferEOTF(vec4(mix(slrrPaintEncoded, slrrDetailEncoded, slrrDetailColor.a), 1.0)).rgb;');
    }
    if (masked) shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>',
      '#include <lights_fragment_end>\nreflectedLight.indirectSpecular *= 1.0 - slrrDetailColor.a;');
    if (reflected) {
      const authored = !generated;
      if (authored) shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 slrrReflectionUv; varying vec2 vSlrrReflectionUv;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSlrrReflectionUv = slrrReflectionUv;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D slrrReflection; uniform float slrrReflectionAvailable; uniform float slrrRealReflections; uniform vec4 slrrReflectionTransform;' + (authored ? ' varying vec2 vSlrrReflectionUv;' : ''))
        .replace('#include <opaque_fragment>', `vec3 slrrRay = reflect(normalize(-vViewPosition), normal);
          float slrrYaw = atan(viewMatrix[0][2], viewMatrix[2][2]);
          vec2 slrrEnvUv = ${authored ? 'vSlrrReflectionUv' : 'vec2(slrrRay.x * 0.5 - slrrYaw / 6.28318530718, -slrrRay.y * 0.5 + 0.5)'};
          slrrEnvUv = slrrEnvUv * slrrReflectionTransform.xy + slrrReflectionTransform.zw;
          vec3 slrrEnvironment = texture2D(slrrReflection, slrrEnvUv).rgb;
          float slrrReflectionWeight = ${strength.toFixed(6)} * slrrReflectionAvailable * (1.0 - slrrRealReflections)${masked ? " * (1.0 - slrrDetailColor.a)" : ""};
          ${painted ? 'outgoingLight = mix(outgoingLight, slrrEnvironment, slrrReflectionWeight * 0.5);' : 'outgoingLight += slrrEnvironment * slrrReflectionWeight;'}
          #include <opaque_fragment>`);
    }
  };
  material.customProgramCacheKey = () => `${key}|vehicle-layers:${!!detail}:${reflected}:${mesh.reflectionMap?.channel}:${!!reflection}:${painted}:${masked}:${strength}`;
  material.needsUpdate = true;
}
