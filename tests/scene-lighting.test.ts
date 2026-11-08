import test from 'node:test';
import assert from 'node:assert/strict';
import { BasicShadowMap, PCFSoftShadowMap, DirectionalLight, MeshStandardMaterial, ShaderLib, Vector3, WebGLRenderTarget, type WebGLRenderer } from 'three';
import { SceneLighting } from '../src/render/scene-lighting';
import { StaticMapShadows } from '../src/render/static-map-shadows';

test('night hard shadows stay centred on the vehicle, reuse their configuration and restore day quality', () => {
  const lighting = new SceneLighting(), sun = new DirectionalLight(); lighting.configureSun(sun);
  const renderer = { shadowMap: { type: PCFSoftShadowMap } } as WebGLRenderer;
  const old = new WebGLRenderTarget(2048, 2048); let disposed = 0;
  old.addEventListener('dispose', () => disposed++); sun.shadow.map = old;
  assert.equal(lighting.setNightShadows(renderer, sun, true), true);
  assert.equal(renderer.shadowMap.type, BasicShadowMap); assert.equal(sun.shadow.mapSize.x, 3072);
  assert.equal(sun.shadow.camera.near, 210); assert.equal(sun.shadow.camera.far, 290);
  assert.equal(sun.shadow.camera.right - sun.shadow.camera.left, 80); assert.equal(disposed, 1);
  const focus = new Vector3(130, 2, -95); lighting.updateSun(sun, focus);
  assert.deepEqual(sun.target.position, focus);
  sun.updateMatrixWorld(true);sun.shadow.updateMatrices(sun);
  const frustum=sun.shadow.getFrustum();
  assert.equal(frustum.containsPoint(focus),true);
  assert.equal(frustum.containsPoint(focus.clone().addScaledVector(lighting.direction,60)),false);
  assert.equal(frustum.containsPoint(focus.clone().addScaledVector(lighting.direction,-60)),false);
  assert.ok(sun.position.clone().sub(focus).normalize().distanceTo(lighting.direction) < 1e-9);
  assert.equal(lighting.setNightShadows(renderer, sun, true), false); assert.equal(disposed, 1);
  assert.equal(lighting.setNightShadows(renderer, sun, false), true);
  assert.equal(renderer.shadowMap.type, PCFSoftShadowMap); assert.equal(sun.shadow.mapSize.x, 2048);
  assert.equal(sun.shadow.camera.right - sun.shadow.camera.left, 200);
  assert.equal(sun.shadow.camera.near, 1); assert.equal(sun.shadow.camera.far, 500);
});

test('standard lighting avoids duplicate shadow-mask evaluation and cached night shadows use a single tap', () => {
  const lighting = new SceneLighting(), cache = new StaticMapShadows(), material = new MeshStandardMaterial();
  lighting.configureMaterial(material); cache.configure(material);
  const shader = { vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader, uniforms: {} } as any;
  material.onBeforeCompile(shader, {} as WebGLRenderer);
  assert.ok(shader.fragmentShader.includes('if (slrrDynamicLighting < 0.5) { outgoingLight = diffuseColor.rgb * getShadowMask()'));
  assert.equal(shader.uniforms.slrrStaticHard, cache.hard);
  cache.hard.value = 1; assert.equal(shader.uniforms.slrrStaticHard.value, 1);
  assert.match(shader.fragmentShader, /if \(slrrStaticHard > 0\.5\) \{\s*lit = step[^]*?\} else \{/);
  material.dispose(); cache.reset();
});
