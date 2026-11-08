import { BasicShadowMap, PCFSoftShadowMap, Color, DirectionalLight, MeshStandardMaterial, Vector3, type WebGLRenderer } from 'three';

/** Debug switches for renderer lighting; original baked lighting is left intact. */
export class SceneLighting {
  readonly dynamic = { value: 1 };
  readonly vertexColors = { value: 1 };
  readonly direction = new Vector3(3, 5, 4).normalize();
  shadows = false;
  private nightShadowMode=false;

  /** Change only on a day/night transition; no per-frame map allocation. */
  setNightShadows(renderer: WebGLRenderer, sun: DirectionalLight, night: boolean): boolean {
    if (night === this.nightShadowMode) return false;
    this.nightShadowMode = night;
    renderer.shadowMap.type = night ? BasicShadowMap : PCFSoftShadowMap;
    const size = night ? 3072 : 2048, radius = night ? 40 : 100;
    sun.shadow.mapSize.set(size, size);
    sun.shadow.map?.dispose(); sun.shadow.map = null;
    Object.assign(sun.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: night ? 210 : 1, far: night ? 290 : 500 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.needsUpdate = true;
    return true;
  }

  configureMaterial(material: MeshStandardMaterial, hasVertexColors = false, paintMask = false, paintColor = new Color(1, 1, 1)) {
    // Paint is custom shader state, not fully represented by standard material fields.
    material.userData.slrrPaintMask=paintMask;
    // The shader captures this fallback tint; include it in immutable map-material identity.
    material.userData.slrrPaintColor=paintColor.toArray();
    const previous = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey.bind(material);
    const key = previousKey();
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);
      // Sky materials retain their own appearance and horizon fog blend.
      shader.uniforms.slrrDynamicLighting = material.userData.sky ? { value: 1 } : this.dynamic;
      if (hasVertexColors || paintMask) {
        shader.uniforms.slrrVertexColors = material.userData.sky ? { value: 0 } : this.vertexColors;
        shader.uniforms.slrrPaintColor = { value: paintColor };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>\n${hasVertexColors ? 'attribute vec3 slrrColor;' : ''}\nuniform vec3 slrrPaintColor;\nvarying vec3 vSlrrColor;\nvarying vec3 vSlrrPaintColor;`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>\nvSlrrColor = ${hasVertexColors ? 'slrrColor' : 'vec3(1.0)'};\nvSlrrPaintColor = slrrPaintColor;\n#ifdef USE_INSTANCING_COLOR\nvSlrrPaintColor = instanceColor;\n#endif`);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float slrrVertexColors;\nvarying vec3 vSlrrPaintColor;\nvarying vec3 vSlrrColor;')
          .replace('#include <color_fragment>', paintMask
            ? '#ifdef USE_MAP\ndiffuseColor.rgb = mix( diffuseColor.rgb, mix( vSlrrColor * vSlrrPaintColor, diffuseColor.rgb, sampledDiffuseColor.a ), slrrVertexColors );\n#endif'
            : 'diffuseColor.rgb *= mix( vec3(1.0), vSlrrColor, slrrVertexColors );');
      }
      shader.fragmentShader = shader.fragmentShader
        // CFG palette colors affect paint regions, not windows/signage on the same instance.
        .replace('#include <color_fragment>', '')
        .replace('#include <common>', '#include <common>\nuniform float slrrDynamicLighting;')
        .replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>')
        .replace('#include <opaque_fragment>', 'if (slrrDynamicLighting < 0.5) { outgoingLight = diffuseColor.rgb * getShadowMask() + totalEmissiveRadiance; }\n#include <opaque_fragment>');
    };
    material.customProgramCacheKey = () => `${key}|slrr-debug-lighting-v5|colors:${hasVertexColors}|paint:${paintMask}`;
  }

  configureSun(sun: DirectionalLight) {
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -100, right: 100, top: 100, bottom: -100, near: 1, far: 500 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.normalBias = 0.12;
    sun.shadow.bias = -0.0001;
  }

  updateSun(sun: DirectionalLight, focus: Vector3) {
    // Move the light and its target together so the script's sun direction stays unchanged.
    sun.position.copy(focus).addScaledVector(this.direction, 250);
    sun.target.position.copy(focus);
    sun.target.updateMatrixWorld();
  }
}
