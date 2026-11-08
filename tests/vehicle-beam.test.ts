import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createVehicleBeam, createHeadlightCameraFlare } from '../src/render/vehicle-beam';
import type { VehicleLight } from '../src/engine/vehicle-light';

test('headlights are plain spotlights with no gobo, custom GPU passes or slow attenuation', () => {
  const source: VehicleLight = { texture: 'glow.png', color: [1, 1, 1], alpha: 1, position: [0.2, 0.1, 0],
    direction: [0, 0.09, -1], cone: 2.5, size: 8, offset: 4,
    beam: { horizontal: 'h.dds', vertical: 'v.png', color: [0.7, 0.7, 0.7], range: 800, innerCone: 0.896 } };
  const group = createVehicleBeam(source)!;
  const mesh = new THREE.Group(); mesh.scale.setScalar(0.01);
  const fixture = new THREE.Group(); fixture.scale.setScalar(100); mesh.add(fixture); fixture.add(group); mesh.updateMatrixWorld(true);
  const light = group.children.find(object => object instanceof THREE.SpotLight) as THREE.SpotLight;
  assert.equal(light.map, null); assert.equal(light.decay, 2); assert.equal(light.castShadow, false);
  assert.equal(light.distance, 60); assert.equal(light.intensity, 80);
  assert.ok(light.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(...source.position)) < 1e-8);
  assert.equal(group.children.length, 2, 'only standard spotlight and target are created');
  group.userData.disposeVehicleLight();
});

test('headlight camera optics use ordinary depth testing without framebuffer read/copy operations', () => {
  const source: VehicleLight = { texture: 'flare.png', color: [0.2, 0.2, 0.2], alpha: 1,
    position: [0, 0, 0], direction: [0, 0, -1], cone: 2.5, size: 8, offset: 4 };
  const map = new THREE.Texture();
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map }));
  const flare = createHeadlightCameraFlare(source, halo, 0.2);
  const group = new THREE.Group(); group.add(flare); group.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 500);
  camera.position.z = -5; camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  // No framebuffer or renderer context API is supplied. Only viewport size is needed.
  const renderer = { getSize: (target: THREE.Vector2) => target.set(1000, 1000) } as THREE.WebGLRenderer;
  flare.onBeforeRender(renderer, new THREE.Scene(), camera, undefined as any, flare.material, null as any);
  assert.equal(flare.material.depthTest, true); assert.equal(flare.material.depthWrite, false);
  assert.equal(flare.material.sizeAttenuation, true); assert.ok(flare.material.opacity > 0.9);
  const depth = -flare.getWorldPosition(new THREE.Vector3()).applyMatrix4(camera.matrixWorldInverse).z;
  const pixels = flare.scale.y * camera.projectionMatrix.elements[5] * 1000 / (2 * depth);
  assert.ok(Math.abs(pixels - 90) < 0.01);
  assert.ok(flare.position.z < -0.2, 'glow clears its own lens surface');
  camera.position.z = -100; camera.updateMatrixWorld(true);
  flare.onBeforeRender(renderer, new THREE.Scene(), camera, undefined as any, flare.material, null as any);
  assert.ok(flare.scale.y <= 0.9, 'distant inspection camera cannot inflate the flare in world space');
  const distantPixels = flare.scale.y * camera.projectionMatrix.elements[5] * 1000 / 200;
  assert.ok(distantPixels < pixels / 5, 'flare shrinks on screen as the camera retreats');
  camera.position.z = 5; camera.updateMatrixWorld(true);
  flare.onBeforeRender(renderer, new THREE.Scene(), camera, undefined as any, flare.material, null as any);
  assert.equal(flare.material.opacity, 0, 'glow disappears when viewed from behind');
  flare.material.map!.dispose(); flare.material.dispose(); map.dispose(); halo.material.dispose();
});
