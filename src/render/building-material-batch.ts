import {BufferAttribute,BufferGeometry,Mesh,MeshStandardMaterial,RepeatWrapping,Texture,Vector2} from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

export function isBuildingAlias(alias:string){return /^krthaz\d+$/i.test(alias)||/^\d+(?:p\d+)?x\d+_/i.test(alias)||/^hotel_\d+_egyedi$/i.test(alias);}
/** Source identity is independent of UV transforms, which are baked per vertex. */
export function buildingLayerKey(material:MeshStandardMaterial){
  const map=material.map;
  return JSON.stringify([map?(map.name?map.name.replaceAll('\\','/').toLowerCase():map.source.uuid):null,
    map?.image?.width,map?.image?.height,map?.flipY,map?.colorSpace,map?.type,map?.format,material.color.toArray()]);
}
export interface BuildingBatchPlan {parts:Mesh[];materials:MeshStandardMaterial[];geometry:BufferGeometry}
/** Opaque stock building surfaces only. Unsupported material passes stay original. */
export function planBuildingBatches(parts:Mesh[]):BuildingBatchPlan[]{
  const groups=new Map<string,Mesh[]>();
  for(const part of parts){
    const m=part.material,g=part.geometry;
    if(!(m instanceof MeshStandardMaterial)||m.transparent||m.opacity!==1||m.alphaTest||m.alphaMap||m.clippingPlanes?.length
      ||m.map&&(m.map.wrapS!==RepeatWrapping||m.map.wrapT!==RepeatWrapping)||!m.map&&m.userData.slrrPaintMask
      ||m.userData.bakedLightmapTexture||m.emissive.getHex()!==0||m.vertexColors||g.groups.length||g.drawRange.start!==0||g.drawRange.count!==Infinity
      ||Object.keys(g.morphAttributes).length||!g.getAttribute('uv')||!g.getAttribute('normal')
      ||Object.keys(g.attributes).some(k=>!['position','normal','uv','slrrColor'].includes(k))
      ||Object.entries(m).some(([k,v])=>v instanceof Texture&&k!=='map'))continue;
    const key=[m.roughness,m.metalness,m.depthTest,m.depthWrite,m.blending,m.polygonOffset,m.polygonOffsetFactor,m.polygonOffsetUnits,
      part.renderOrder,part.layers.mask,part.castShadow,part.receiveShadow,!!part.userData.staticMapCaster].join(':');
    const list=groups.get(key)??[];list.push(part);groups.set(key,list);
  }
  const plans:BuildingBatchPlan[]=[];
  for(const group of groups.values()){
    if(group.length<2||group.reduce((n,p)=>n+p.geometry.getAttribute('position').count,0)>200000)continue;
    const materials:MeshStandardMaterial[]=[],layers=new Map<string,number>();
    for(const p of group){const m=p.material as MeshStandardMaterial,key=buildingLayerKey(m);
      if(!layers.has(key)){layers.set(key,materials.length);materials.push(m);}}

    if(materials.length>16)continue;
    const geometries:BufferGeometry[]=[];
    for(const part of group){
      const source=part.geometry,m=part.material as MeshStandardMaterial,g=new BufferGeometry();
      for(const name of ['position','normal'])g.setAttribute(name,source.getAttribute(name).clone());
      if(source.index)g.setIndex(source.index.clone());
      const count=source.getAttribute('position').count,uv=new Float32Array(count*2),colors=new Float32Array(count*3),params=new Float32Array(count*3),paintTint=new Float32Array(count*3);
      const input=source.getAttribute('uv'),color=source.getAttribute('slrrColor'),point=new Vector2();
      if(m.map?.matrixAutoUpdate)m.map.updateMatrix();
      for(let i=0;i<count;i++){
        point.set(input.getX(i),input.getY(i));if(m.map)point.applyMatrix3(m.map.matrix);uv.set(point.toArray(),i*2);
        colors.set(color?[color.getX(i),color.getY(i),color.getZ(i)]:[1,1,1],i*3);
        paintTint.set(m.userData.slrrPaintColor??[1,1,1],i*3);
        params.set([layers.get(buildingLayerKey(m))!,color?1:0,m.userData.slrrPaintMask?1:0],i*3);
      }
      g.setAttribute('uv',new BufferAttribute(uv,2));g.setAttribute('slrrColor',new BufferAttribute(colors,3));g.setAttribute('slrrBuildingParams',new BufferAttribute(params,3));g.setAttribute('slrrBuildingPaintTint',new BufferAttribute(paintTint,3));
      geometries.push(g);
    }
    // SCX geometry is already in a shared model frame; do not bake instance poses.
    const geometry=mergeGeometries(geometries,false);for(const g of geometries)g.dispose();
    if(!geometry)continue;
    geometry.computeBoundingBox();geometry.computeBoundingSphere();plans.push({parts:group,materials,geometry});
  }
  return plans;
}

/** MeshStandardMaterial retains lighting/fog/shadows; only diffuse lookup is array-based. */
export function configureBuildingArrayMaterial(material:MeshStandardMaterial,texture:Texture){
  material.userData.slrrUnifiedBuilding=true;material.userData.slrrBuildingTexture=texture;
  const previous=material.onBeforeCompile,key=material.customProgramCacheKey();
  material.onBeforeCompile=(shader,renderer)=>{
    previous.call(material,shader,renderer);shader.uniforms.slrrBuildingMaps={value:texture};
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute vec3 slrrBuildingParams;\nattribute vec3 slrrBuildingPaintTint;\nvarying vec3 vSlrrBuildingParams;\nvarying vec2 vSlrrBuildingUv;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvSlrrBuildingParams=slrrBuildingParams;vSlrrBuildingUv=uv;')
      .replace('vSlrrPaintColor = slrrPaintColor;','vSlrrPaintColor = slrrBuildingPaintTint;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform highp sampler2DArray slrrBuildingMaps;\nvarying vec3 vSlrrBuildingParams;\nvarying vec2 vSlrrBuildingUv;')
      .replace('#include <map_fragment>','vec4 sampledDiffuseColor=texture(slrrBuildingMaps,vec3(vSlrrBuildingUv,vSlrrBuildingParams.x));\ndiffuseColor.rgb*=sampledDiffuseColor.rgb;')
      .replace('diffuseColor.rgb *= mix( vec3(1.0), vSlrrColor, slrrVertexColors );',`vec3 slrrBuildingUnpainted=diffuseColor.rgb*mix(vec3(1.0),vSlrrColor,vSlrrBuildingParams.y);
vec3 slrrBuildingPainted=mix(vSlrrColor*vSlrrPaintColor,diffuseColor.rgb,sampledDiffuseColor.a);
diffuseColor.rgb=mix(diffuseColor.rgb,mix(slrrBuildingUnpainted,slrrBuildingPainted,vSlrrBuildingParams.z),slrrVertexColors);`);
  };
  material.customProgramCacheKey=()=>`${key}|slrr-building-array-v1`;
}
