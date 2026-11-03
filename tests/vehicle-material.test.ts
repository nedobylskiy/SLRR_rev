import test from 'node:test';
import assert from 'node:assert/strict';
import { CubeCamera, Group, Mesh, BoxGeometry, Scene, Vector3, MeshStandardMaterial, Texture } from 'three';
import { partPaintTextures } from '../src/render/part-paint';
import { configureVehicleMaterial } from '../src/render/vehicle-material';
import { VehicleReflections } from '../src/render/vehicle-reflections';
import { previewMaterial } from '../src/render/preview-material';

test('paint replaces only the original default material link and preserves atlases and duplicate layers', () => {
  const links = ['interior.dds', 'Cars/default_white.png', 'glass.dds', 'cars/default_white.png'];
  const painted = partPaintTextures(links, { from: 'cars\\default_white.png', to: 'factory/red.png' });
  assert.deepEqual(painted, ['interior.dds', 'factory/red.png', 'glass.dds', 'cars/default_white.png']);
  assert.equal(links[1], 'Cars/default_white.png');
  assert.equal(partPaintTextures(links), links);
  assert.equal(partPaintTextures(links, { from: 'absent.png', to: 'red.png' }), links);
});

test('authored detail blends over paint while reflections remain an independent switchable pass', () => {
  const detail = new Texture(), reflection = new Texture(), material = new MeshStandardMaterial();
  const uniforms = { environment: { value: null }, available: { value: 0 }, dynamic: { value: 0 } };
  configureVehicleMaterial(material, { reflectionIndex: 3, reflectionStrength: 0.35 }, uniforms, detail, reflection);
  const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <map_fragment>\n#include <opaque_fragment>' };
  material.onBeforeCompile(shader as any, {} as any);
  assert.match(shader.fragmentShader, /mix\(diffuseColor.rgb, slrrDetailColor.rgb, slrrDetailColor.a\)/);
  assert.match(shader.fragmentShader, /0.175000/);
  assert.equal((shader.uniforms as any).slrrRealReflections, uniforms.dynamic);
  const preview = previewMaterial(material);
  assert.equal(preview.userData.detailTexture, detail);
  assert.equal(preview.userData.reflectionTexture, undefined);
  assert.equal(preview.map, material.map);
});


test('local reflections throttle capture, hide vehicles only during capture and release their environment', () => {
  const system = new VehicleReflections(), material = new MeshStandardMaterial(), group = new Group();
  material.userData.vehicleReflective = true;
  const original = new Texture(); material.envMap = original; material.envMapIntensity = 0.4;
  group.add(new Mesh(new BoxGeometry(), material));
  const update = CubeCamera.prototype.update;
  let captures = 0;
  CubeCamera.prototype.update = function () { captures++; assert.equal(group.visible, false); };
  try {
    system.enabled = true;
    for (const now of [0, 100, 250]) system.update({} as any, new Scene(), new Vector3(), [group], now);
    assert.equal(captures, 2); assert.equal(group.visible, true); assert.notEqual(material.envMap, original);
    system.reset(); assert.equal(material.envMap, original); assert.equal(material.envMapIntensity, 0.4);
    CubeCamera.prototype.update = function () { throw new Error('capture failed'); };
    assert.throws(() => system.update({} as any, new Scene(), new Vector3(), [group], 500), /capture failed/);
    assert.equal(group.visible, true);
  } finally { system.reset(); CubeCamera.prototype.update = update; }
});
