import test from 'node:test';
import assert from 'node:assert/strict';
import { BufferGeometry, MeshStandardMaterial, ShaderLib, Texture, NoColorSpace } from 'three';
import { bakedLightmapUvs, configureBakedLightmap } from '../src/render/baked-lightmap';
import { SceneLighting } from '../src/render/scene-lighting';
import type { ScxMesh } from '../src/formats/scx';

const mesh = (): ScxMesh => ({name:'mapped', positions:new Float32Array(6), normals:new Float32Array(6),
  uv:new Float32Array([0,0,1,1]), uv2:new Float32Array([0.25,0.5,0.75,1]), uv3:new Float32Array([1,0,0,1]),
  indices:new Uint32Array(), diffuse:[1,1,1,1], textureIndex:0, lightmapIndex:1});

test('baked UVs use the authored channel and centred v4 atlas transform without modifying diffuse UVs', () => {
  const part = mesh();
  assert.deepEqual(bakedLightmapUvs(part),part.uv2);
  part.lightmapMap = {channel:1,tiling:0,scaleU:2,scaleV:0.5,offsetU:0.125,offsetV:0.25};
  assert.deepEqual(Array.from(bakedLightmapUvs(part)!),[-0.25,0.625,0.75,0.875]);
  assert.deepEqual(Array.from(part.uv2!),[0.25,0.5,0.75,1]);
  part.lightmapMap.channel = 2;
  assert.ok(bakedLightmapUvs(part));
  part.lightmapMap.channel = 3;
  assert.equal(bakedLightmapUvs(part),undefined, 'missing channels cannot silently sample diffuse UVs');
});

test('baked coefficients compose after lighting/shadows and share an independent live switch across materials', () => {
  const lighting = new SceneLighting(), enabled = {value:0};
  for (const dynamic of [0,1]) for (const shadows of [false,true]) {
    lighting.dynamic.value = dynamic; lighting.shadows = shadows;
    const material = new MeshStandardMaterial(), geometry = new BufferGeometry(), texture = new Texture();
    lighting.configureMaterial(material,true);
    configureBakedLightmap(material,geometry,bakedLightmapUvs(mesh())!,texture,enabled);
    const key = material.customProgramCacheKey();
    const shader = {uniforms:{},vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader};
    material.onBeforeCompile(shader as any,{} as any);
    assert.equal((shader.uniforms as any).slrrBakedLightmapEnabled,enabled);
    assert.equal((shader.uniforms as any).slrrDynamicLighting,lighting.dynamic);
    assert.ok(shader.fragmentShader.indexOf('getShadowMask() + totalEmissiveRadiance')
      < shader.fragmentShader.indexOf('vec3 slrrBake = texture2D'));
    assert.match(shader.fragmentShader, /outgoingLight = \(outgoingLight - totalEmissiveRadiance\) \* slrrBake \+ totalEmissiveRadiance/);
    assert.equal(texture.colorSpace,NoColorSpace);
    assert.equal(material.userData.bakedLightmapTexture,texture);
    enabled.value = 1;
    assert.equal((shader.uniforms as any).slrrBakedLightmapEnabled.value,1);
    assert.equal(lighting.dynamic.value,dynamic);
    assert.equal(lighting.shadows,shadows);
    assert.equal(material.customProgramCacheKey(),key, 'switching does not rebuild shader programs');
    enabled.value = 0;
  }
});
