/** Single-atlas compatibility for stock renders with out-of-range SCX diffuse slots. */
export function diffuseTextureIndex(index: number, textures: readonly string[]): number {
  // An explicit absent-map sentinel remains untextured. Never guess among
  // multiple textures or substitute for a missing entry inside an authored table.
  if (index !== 0xffff && index !== 0xffffffff && index >= textures.length && textures.length === 1 && textures[0]) return 0;
  return index;
}
