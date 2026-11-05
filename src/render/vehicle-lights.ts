/** CFG render channels are activation conditions, not always-visible extra meshes. */
export function cfgRenderVisible(flags = 0, active = 0): boolean {
  const channels = flags & 0x1ff;
  return channels === 0 || (channels & active) !== 0;
}


export function applyCfgRenderChannels(group: { children: { userData: Record<string, any>; visible: boolean }[] }, active: number): void {
  for (const child of group.children) if (child.userData.lightFlags !== undefined)
    child.visible = cfgRenderVisible(child.userData.lightFlags, active);
}
