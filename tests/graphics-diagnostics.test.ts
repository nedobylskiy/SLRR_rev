import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry,InstancedMesh,MeshStandardMaterial,Scene,Texture} from 'three';
import {sceneResources} from '../src/render/graphics-diagnostics';

test('scene resource estimate counts shared geometry and source storage once, and separates instance buffers',()=>{
  const scene=new Scene(),geometry=new BoxGeometry(),texture=new Texture({width:32,height:32} as any);
  texture.generateMipmaps=false;
  const a=new InstancedMesh(geometry,new MeshStandardMaterial({map:texture}),10);
  const b=new InstancedMesh(geometry,new MeshStandardMaterial({map:texture.clone()}),20);
  scene.add(a,b);const r=sceneResources(scene);
  assert.equal(r.textures,1);assert.equal(r.textureBytes,32*32*4);
  assert.equal(r.materials,2);assert.equal(r.instanceSlots,30);assert.equal(r.instanceBytes,30*16*4);
  assert.equal(r.geometryBytes,Object.values(geometry.attributes).reduce((n,a)=>n+a.array.byteLength,0)+geometry.index!.array.byteLength);
});
