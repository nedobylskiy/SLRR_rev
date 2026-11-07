import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry,BufferAttribute,Mesh,MeshStandardMaterial,Texture,RepeatWrapping,ShaderLib} from 'three';
import {planBuildingBatches,configureBuildingArrayMaterial,isBuildingAlias} from '../src/render/building-material-batch';
import {SceneLighting} from '../src/render/scene-lighting';

function part(name:string){const map=new Texture();map.wrapS=map.wrapT=RepeatWrapping;const material=new MeshStandardMaterial({map});const mesh=new Mesh(new BoxGeometry(),material);mesh.name=name;mesh.geometry.clearGroups();return mesh;}

test('opaque building parts become a single geometry with per-face material selection, tiled UVs and paint flags',()=>{
  const wall=part('wall'),windows=part('windows');windows.geometry.translate(4,0,0);
  wall.material.map!.repeat.set(4,2);wall.material.map!.offset.set(.25,-.5);wall.material.userData.slrrPaintMask=true;
  wall.geometry.setAttribute('slrrColor',new BufferAttribute(new Uint8Array(24*3).fill(128),3,true));
  const oldUv=Array.from(wall.geometry.getAttribute('uv').array);
  const [plan]=planBuildingBatches([wall,windows]);assert.equal(plan.parts.length,2);assert.equal(plan.materials.length,2);assert.equal(plan.geometry.groups.length,0);
  assert.equal(plan.geometry.index!.count,wall.geometry.index!.count+windows.geometry.index!.count);
  const uv=plan.geometry.getAttribute('uv'),original=wall.geometry.getAttribute('uv'),params=plan.geometry.getAttribute('slrrBuildingParams');
  assert.equal(uv.getX(0),original.getX(0)*4+.25);assert.equal(uv.getY(0),original.getY(0)*2-.5);
  assert.equal(params.getX(0),0);assert.equal(params.getY(0),1);assert.equal(params.getZ(0),1);
  assert.equal(params.getX(24),1);assert.equal(params.getY(24),0);assert.equal(params.getZ(24),0);
  assert.ok(Math.abs(plan.geometry.getAttribute('slrrColor').getX(0)-128/255)<1e-6);assert.equal(plan.geometry.getAttribute('slrrColor').getX(24),1);
  assert.deepEqual(Array.from(wall.geometry.getAttribute('uv').array),oldUv);assert.ok(plan.geometry.boundingBox!.max.x>4);plan.geometry.dispose();
});

test('transparent, cutout, authored-lightmap and unsupported passes retain their original representation',()=>{
  const wall=part('wall'),windows=part('windows'),glass=part('glass'),cutout=part('cutout'),baked=part('baked');
  glass.material.transparent=true;cutout.material.alphaTest=.5;baked.material.userData.bakedLightmapTexture=new Texture();
  const plans=planBuildingBatches([wall,windows,glass,cutout,baked]);assert.equal(plans.length,1);assert.deepEqual(plans[0].parts,[wall,windows]);
  assert.equal(planBuildingBatches([glass,cutout,baked]).length,0);
});

test('unified material keeps stock lighting switches, vertex paint and native texture-array lookup',()=>{
  const material=new MeshStandardMaterial(),lighting=new SceneLighting(),texture=new Texture();lighting.configureMaterial(material,true,false);
  configureBuildingArrayMaterial(material,texture);
  const shader={uniforms:{},vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader};material.onBeforeCompile(shader as any,{} as any);
  assert.equal((shader.uniforms as any).slrrBuildingMaps.value,texture);
  assert.equal((shader.uniforms as any).slrrVertexColors,lighting.vertexColors);
  assert.match(shader.fragmentShader,/sampler2DArray/);assert.match(shader.fragmentShader,/slrrBuildingPainted/);
  assert.doesNotMatch(shader.fragmentShader,/diffuseColor.rgb \*= mix\( vec3\(1.0\), vSlrrColor/);
  assert.ok(isBuildingAlias('krthaz02'));assert.ok(isBuildingAlias('06x5_shop'));assert.equal(isBuildingAlias('lamp_base'),false);
});

test('UV and paint differences share texture layers without sharing per-vertex state',()=>{
  const a=part('wall'),b=part('trim');b.material.map=a.material.map!.clone();b.material.map.repeat.set(5,1);
  a.material.userData.slrrPaintMask=true;a.material.userData.slrrPaintColor=[.2,.3,.4];
  const [plan]=planBuildingBatches([a,b]);assert.equal(plan.materials.length,1);
  assert.equal(plan.geometry.getAttribute('slrrBuildingParams').getX(24),0);
  assert.ok(Math.abs(plan.geometry.getAttribute('slrrBuildingPaintTint').getX(0)-.2)<1e-6);
  assert.equal(plan.geometry.getAttribute('slrrBuildingParams').getZ(24),0);
  assert.equal(plan.geometry.getAttribute('uv').getX(24),b.geometry.getAttribute('uv').getX(0)*5);
});
