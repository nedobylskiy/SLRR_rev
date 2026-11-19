import { Color, Mesh, type Object3D, type Material } from 'three';

/** Modulation is local to the instance; RPK template materials remain shared and unchanged. */
export function applyRenderColor(root: Object3D, argb: number | null, cloneMaterials = true): void {
  if (argb === null) return;
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const apply = (material: Material) => {
      const copy = (cloneMaterials ? material.clone() : material) as Material & { color?: Color };
      if(cloneMaterials&&(material.userData.sky||material.userData.slrrPaintMask)){
        copy.onBeforeCompile=material.onBeforeCompile;
        copy.customProgramCacheKey=material.customProgramCacheKey;
      }
      const tint=new Color(argb&0xffffff);
      if(material.userData.slrrPaintMask){
        // SCX paint materials reserve texture alpha for coverage: tint belongs
        // in their paint uniform, while opaque label/cap pixels retain their RGB.
        const previous=copy.onBeforeCompile,key=copy.customProgramCacheKey();
        copy.onBeforeCompile=(shader,renderer)=>{
          previous.call(copy,shader,renderer);
          shader.uniforms.slrrPaintColor={value:tint};
        };
        copy.customProgramCacheKey=()=>`${key}|render-paint-tint`;
        copy.userData.slrrPaintColor=tint.toArray();
      }else copy.color?.multiply(tint);
      copy.opacity *= (argb >>> 24) / 255;
      copy.transparent ||= copy.opacity < 1;
      return copy;
    };
    object.material = Array.isArray(object.material) ? object.material.map(apply) : apply(object.material);
  });
}
