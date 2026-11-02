import { Color, DirectionalLight, MeshStandardMaterial, Vector3 } from 'three';

/** Debug switches for renderer lighting; original baked lighting is left intact. */
export class SceneLighting {
  readonly dynamic = { value: 1 };
  readonly vertexColors = { value: 1 };
  readonly direction = new Vector3(3, 5, 4).normalize();
  shadows = false;

  configureMaterial(material: MeshStandardMaterial, hasVertexColors = false, paintMask = false, paintColor = new Color(1, 1, 1)) {
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
          .replace('#include <common>', `#include <common>\n${hasVertexColors ? 'attribute vec3 slrrColor;' : ''}\nvarying vec3 vSlrrColor;`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>\nvSlrrColor = ${hasVertexColors ? 'slrrColor' : 'vec3(1.0)'};`);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float slrrVertexColors;\nuniform vec3 slrrPaintColor;\nvarying vec3 vSlrrColor;')
          .replace('#include <color_fragment>', paintMask
            ? '#include <color_fragment>\n#ifdef USE_MAP\ndiffuseColor.rgb = mix( diffuseColor.rgb, mix( vSlrrColor * slrrPaintColor, diffuseColor.rgb, sampledDiffuseColor.a ), slrrVertexColors );\n#endif'
            : '#include <color_fragment>\ndiffuseColor.rgb *= mix( vec3(1.0), vSlrrColor, slrrVertexColors );');
      }
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float slrrDynamicLighting;')
        .replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>')
        .replace('#include <opaque_fragment>', 'outgoingLight = mix( diffuseColor.rgb * getShadowMask() + totalEmissiveRadiance, outgoingLight, slrrDynamicLighting );\n#include <opaque_fragment>');
    };
    material.customProgramCacheKey = () => `${key}|slrr-debug-lighting-v3|colors:${hasVertexColors}|paint:${paintMask}`;
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
