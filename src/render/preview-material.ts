import * as THREE from 'three';
import { configureVehicleMaterial } from './vehicle-material';

/** Preview textures retain their cutouts and glass, independently of scene lighting. */
export function previewMaterial(source: THREE.MeshStandardMaterial): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({ color: source.color, map: source.map,
    opacity: source.opacity, transparent: source.transparent, alphaTest: source.alphaTest,
    depthWrite: source.depthWrite, side: source.side, vertexColors: false, fog: false });
  if (source.userData.detailTexture) configureVehicleMaterial(material, {},
    { environment: { value: null }, available: { value: 0 }, dynamic: { value: 0 } }, source.userData.detailTexture);
  return material;
}
