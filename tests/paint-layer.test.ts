import test from 'node:test';
import assert from 'node:assert/strict';
import {BufferGeometry,Float32BufferAttribute,Matrix4,MeshBasicMaterial,MeshStandardMaterial,ShaderLib} from 'three';
import {PAINT_UV,configurePaintLayer,paintLayerOf,paintLayerSize,paintUvInfo} from '../src/render/paint-layer';

function quads(uvs:number[][]){
  const position:number[]=[],uv:number[]=[];
  uvs.forEach(([u0,v0,u1,v1],i)=>{
    const z=i*2;position.push(0,0,z,1,0,z,1,1,z, 0,0,z,1,1,z,0,1,z);
    uv.push(u0,v0,u1,v0,u1,v1, u0,v0,u1,v1,u0,v1);
  });
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(position,3));g.setAttribute('uv',new Float32BufferAttribute(uv,2));return g;
}

test('paint layers accept separate UV islands and reject shared or tiled ones',()=>{
  assert.equal(paintUvInfo(quads([[0,0,.4,.4],[.5,.5,.9,.9]])).usable,true,'two islands side by side');
  const mirrored=paintUvInfo(quads([[0,0,.5,.5],[0,0,.5,.5]]));
  assert.equal(mirrored.usable,false,'a mirrored side sharing texels would get the decal twice');assert.ok(mirrored.overlap>.9);
  assert.equal(paintUvInfo(quads([[0,0,2,2]])).usable,false,'tiled UVs outside 0..1');
});

test('layer size targets about 5 mm per texel and the material samples the primary UVs',()=>{
  const g=quads([[0,0,1,1]]);
  assert.equal(paintLayerSize(g,new Matrix4(),1),256,'1 m² → 200 texels → minimum 256');
  assert.equal(paintLayerSize(g,new Matrix4().makeScale(4,4,4),.5),2048,'16 m² at half coverage is capped at 2048');
  const material=new MeshStandardMaterial();configurePaintLayer(material,g);
  assert.ok(paintLayerOf(material));assert.equal(g.getAttribute(PAINT_UV),g.getAttribute('uv'),'shares the uv buffer');
  assert.ok(material.customProgramCacheKey().includes('paint-layer'));
  const key=material.customProgramCacheKey();configurePaintLayer(material,g);assert.equal(material.customProgramCacheKey(),key,'configured once');
});

test('the layer reaches the fragment shader even when an earlier hook consumed color_fragment',()=>{
  const g=quads([[0,0,1,1]]),material=new MeshStandardMaterial();
  // The scene lighting hook substitutes its own paint-mask mix for color_fragment before this one runs.
  material.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','');};
  configurePaintLayer(material,g);
  const shader={uniforms:{} as Record<string,unknown>,vertexShader:ShaderLib.physical.vertexShader,fragmentShader:ShaderLib.physical.fragmentShader};
  material.onBeforeCompile(shader as never,undefined as never);
  assert.ok(shader.fragmentShader.includes('texture2D(slrrPaintLayer, vSlrrPaintUv)'),'fragment samples the layer');
  const basic=new MeshBasicMaterial();configurePaintLayer(basic,g);
  const unlit={uniforms:{} as Record<string,unknown>,vertexShader:ShaderLib.basic.vertexShader,fragmentShader:ShaderLib.basic.fragmentShader};
  basic.onBeforeCompile(unlit as never,undefined as never);
  assert.ok(unlit.fragmentShader.includes('texture2D(slrrPaintLayer, vSlrrPaintUv)'),'unlit previews sample it too');
  assert.ok(shader.vertexShader.includes('vSlrrPaintUv = slrrPaintUv'));
  assert.equal(shader.uniforms.slrrPaintLayer,paintLayerOf(material)!.map);
});
