import { Color, Mesh, type Object3D, type Material } from 'three';

/** Modulation is local to the instance; RPK template materials remain shared and unchanged. */
export function applyRenderColor(root: Object3D, argb: number | null, cloneMaterials = true): void {
  if (argb === null) return;
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const apply = (material: Material) => {
      const copy = (cloneMaterials ? material.clone() : material) as Material & { color?: Color };
      copy.color?.multiply(new Color(argb & 0xffffff));
      copy.opacity *= (argb >>> 24) / 255;
      copy.transparent ||= copy.opacity < 1;
      return copy;
    };
    object.material = Array.isArray(object.material) ? object.material.map(apply) : apply(object.material);
  });
}
