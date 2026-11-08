import * as THREE from 'three';
import type { VehicleLight } from '../engine/vehicle-light';

/** Plain headlights: standard Three.js cone and inverse-square attenuation. */
export function createVehicleBeam(source: VehicleLight): THREE.Group | undefined {
  if (!source.beam) return;
  const group = new THREE.Group(); group.name = 'Headlight spot';
  const light = new THREE.SpotLight(new THREE.Color(...source.beam.color), 80, 60, Math.PI / 6, 0.2);
  light.position.fromArray(source.position);
  const direction = new THREE.Vector3(...source.direction);
  direction.y = -Math.abs(direction.y) - 0.02;
  light.target.position.copy(light.position).add(direction.normalize());
  light.castShadow = false;
  group.add(light, light.target);
  group.userData.disposeVehicleLight = () => light.dispose();
  return group;
}

/** Camera-sized optical glow, occluded by ordinary depth without framebuffer copies. */
export function createHeadlightCameraFlare(source: VehicleLight, halo: THREE.Sprite, lensRadius = 0): THREE.Sprite {
  const texture = halo.material.map!.clone();
  const color = new THREE.Color(...source.color).multiplyScalar(source.beam ? 8 : 1);
  const material = new THREE.SpriteMaterial({ map: texture, color, transparent: true,
    blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false,
    toneMapped: false, fog: false, sizeAttenuation: true });
  const flare = new THREE.Sprite(material); flare.name = 'Headlight camera flare';
  flare.position.fromArray(source.position);
  const origin = new THREE.Vector3(...source.position), inverse = new THREE.Matrix4();
  const position = new THREE.Vector3(), forward = new THREE.Vector3(), toCamera = new THREE.Vector3();
  const viewport = new THREE.Vector2(), worldScale = new THREE.Vector3(), viewPosition = new THREE.Vector3();
  flare.onBeforeRender = (renderer, _scene, camera) => {
    if (!flare.parent) return;
    position.copy(origin).applyMatrix4(flare.parent.matrixWorld);
    camera.getWorldPosition(toCamera).sub(position).normalize();
    flare.position.copy(position).addScaledVector(toCamera, lensRadius + 0.04)
      .applyMatrix4(inverse.copy(flare.parent.matrixWorld).invert());
    forward.fromArray(source.direction).transformDirection(flare.parent.matrixWorld);
    material.opacity = Math.max(0, forward.dot(toCamera)) * source.alpha;
    renderer.getSize(viewport);
    // Match a 90px close-up flare, but never let its physical billboard grow
    // with observer-camera distance. SpriteMaterial now applies perspective.
    const projectionScale = Math.abs(camera.projectionMatrix.elements[5]);
    viewPosition.copy(flare.position).applyMatrix4(flare.parent.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
    const perspective = (camera as THREE.PerspectiveCamera).isPerspectiveCamera;
    const depth = perspective ? Math.max(0, -viewPosition.z) : 1;
    const diameter = Math.min(0.9, 180 * depth / Math.max(1, viewport.y * projectionScale));
    flare.parent.getWorldScale(worldScale);
    flare.scale.set(diameter / Math.max(1e-6, Math.abs(worldScale.x)),
      diameter / Math.max(1e-6, Math.abs(worldScale.y)), 1);
    flare.updateMatrixWorld(true);
  };
  return flare;
}
