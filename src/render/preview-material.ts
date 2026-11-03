import * as THREE from 'three';

/** Preview textures retain their cutouts and glass, independently of scene lighting. */
export function previewMaterial(source: THREE.MeshStandardMaterial): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: source.color, map: source.map,
    opacity: source.opacity, transparent: source.transparent, alphaTest: source.alphaTest,
    depthWrite: source.depthWrite, side: source.side, vertexColors: false, fog: false });
}
