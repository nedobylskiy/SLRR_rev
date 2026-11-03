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
  assert.match(shader.fragmentShader, /mix\(slrrPaintEncoded, slrrDetailEncoded, slrrDetailColor.a\)/);
  assert.match(shader.fragmentShader, /sRGBTransferOETF/);
  assert.match(shader.fragmentShader, /sRGBTransferEOTF/);
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
    assert.equal(material.envMapIntensity, 0.5);
    system.reset(); assert.equal(material.envMap, original); assert.equal(material.envMapIntensity, 0.4);
    CubeCamera.prototype.update = function () { throw new Error('capture failed'); };
    assert.throws(() => system.update({} as any, new Scene(), new Vector3(), [group], 500), /capture failed/);
    assert.equal(group.visible, true);
  } finally { system.reset(); CubeCamera.prototype.update = update; }
});


test('painted door and fender use the same subdued global reflection when their SCX slot is unbound', () => {
  const global = new Texture();
  const uniforms = { environment: { value: global }, available: { value: 1 }, dynamic: { value: 0 } };
  const fragments: string[] = [];
  for (const channel of [0xfffffffe, 0]) {
    const material = new MeshStandardMaterial(); material.userData.paintDefault = 'default_white.png';
    configureVehicleMaterial(material, { reflectionIndex: 2, reflectionStrength: 0.3,
      reflectionMap: { channel, tiling: 3, scaleU: 1, scaleV: 1, offsetU: 0, offsetV: 0 } }, uniforms);
    const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <opaque_fragment>' };
    material.onBeforeCompile(shader as any, {} as any);
    assert.equal((shader.uniforms as any).slrrReflectionAvailable, uniforms.available);
    assert.doesNotMatch(shader.vertexShader, /attribute vec2 slrrReflectionUv/);
    assert.match(shader.fragmentShader, /mix\(outgoingLight, slrrEnvironment, slrrReflectionWeight \* 0.5\)/);
    assert.equal(material.envMapIntensity, 0); // No second PBR environment contribution.
    fragments.push(shader.fragmentShader);
  }
  assert.equal(fragments[0], fragments[1]);
});

test('a bound reflection texture still uses its authored UVs on painted panels', () => {
  const material = new MeshStandardMaterial(); material.userData.paintDefault = 'default_white.png';
  configureVehicleMaterial(material, { reflectionIndex: 2,
    reflectionMap: { channel: 1, tiling: 3, scaleU: 1, scaleV: 1, offsetU: 0, offsetV: 0 } },
    { environment: { value: null }, available: { value: 0 }, dynamic: { value: 0 } }, undefined, new Texture());
  const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <opaque_fragment>' };
  material.onBeforeCompile(shader as any, {} as any);
  assert.match(shader.vertexShader, /attribute vec2 slrrReflectionUv/);
});


test('stock masked paint material suppresses environment reflections on opaque detail regions', () => {
  const material = new MeshStandardMaterial(); material.userData.paintDefault = 'default_white.png';
  configureVehicleMaterial(material, { materialType: 0x15, reflectionIndex: 2, reflectionStrength: 0.3 },
    { environment: { value: null }, available: { value: 1 }, dynamic: { value: 0 } }, new Texture());
  const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <map_fragment>\n#include <lights_fragment_end>\n#include <opaque_fragment>' };
  material.onBeforeCompile(shader as any, {} as any);
  assert.match(shader.fragmentShader, /slrrRealReflections\) \* \(1.0 - slrrDetailColor.a\)/);
  assert.match(shader.fragmentShader, /reflectedLight.indirectSpecular \*= 1.0 - slrrDetailColor.a/);
});
