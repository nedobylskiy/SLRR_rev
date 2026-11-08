import { Mesh, MeshStandardMaterial, type Object3D } from 'three';

/** CFG render channels are activation conditions, not always-visible extra meshes. */
export function isNightTime(timeSeconds: number): boolean {
  const hour = ((timeSeconds / 3600) % 24 + 24) % 24;
  return hour < 6 || hour >= 18;
}

export function drivingLightMask(previous: number, brake: boolean, reverse: boolean, running: boolean, timeSeconds: number): number {
  return (previous & ~7) | (brake ? 1 : 0) | (reverse ? 2 : 0) | (running && isNightTime(timeSeconds) ? 4 : 0);
}

export function cfgRenderVisible(flags = 0, active = 0): boolean {
  const channels = flags & 0x1ff;
  return channels === 0 || (channels & active) !== 0;
}


export function applyCfgRenderChannels(group: { children: { userData: Record<string, any>; visible: boolean }[] }, active: number): void {
  for (const child of group.children) if (child.userData.lightFlags !== undefined)
    child.visible = cfgRenderVisible(child.userData.lightFlags, active);
}

/** Activated lamp lens overlays emit their texture instead of depending on scene illumination. */
export function configureCfgLampEmission(group: Object3D, flags = 0): void {
  if (!(flags & 0x1ff)) return;
  group.traverse(object => {
    if (!(object instanceof Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof MeshStandardMaterial)) continue;
      material.emissive.setRGB(1, 1, 1);
      material.emissiveMap = material.map;
      material.emissiveIntensity = 1.4;
      material.needsUpdate = true;
    }
  });
}
