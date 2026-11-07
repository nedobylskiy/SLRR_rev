import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry,InstancedMesh,MeshStandardMaterial,Scene,Texture,PerspectiveCamera,type WebGLRenderer} from 'three';
import {sceneResources,GraphicsDiagnostics} from '../src/render/graphics-diagnostics';
import type {FrameProfiler} from '../src/render/frame-profiler';

test('scene resource estimate counts shared geometry and source storage once, and separates instance buffers',()=>{
  const scene=new Scene(),geometry=new BoxGeometry(),texture=new Texture({width:32,height:32} as any);
  texture.generateMipmaps=false;
  const a=new InstancedMesh(geometry,new MeshStandardMaterial({map:texture}),10);
  const b=new InstancedMesh(geometry,new MeshStandardMaterial({map:texture.clone()}),20);
  scene.add(a,b);const r=sceneResources(scene);
  assert.equal(r.textures,1);assert.equal(r.textureBytes,32*32*4);
  assert.equal(r.materials,2);assert.equal(r.instanceSlots,30);assert.equal(r.instanceBytes,30*16*4);
  assert.equal(r.instancedMeshes,2);assert.deepEqual(r.visibleBatches.map(b=>b.instances),[20,10]);
  assert.equal(r.geometryBytes,Object.values(geometry.attributes).reduce((n,a)=>n+a.array.byteLength,0)+geometry.index!.array.byteLength);
});

test('color GPU timer starts on first submission when renderer skips shadow rendering',()=>{
  const started:string[]=[],finished:unknown[]=[],query={};
  const profiler={detailedGpu:true,startGpuSection:(name:string)=>{started.push(name);return query;},
    finishGpuSection:(q:unknown,keep:boolean)=>{if(q)finished.push([q,keep]);},record(){}} as unknown as FrameProfiler;
  const scene=new Scene(),camera=new PerspectiveCamera(),geometry=new BoxGeometry(),material=new MeshStandardMaterial();
  const object=new InstancedMesh(geometry,material,20);
  const renderer:any={info:{render:{calls:0,triangles:0}},getRenderTarget:()=>null,
    renderLists:{get:()=>({init(){},finish(){},sort(){}})},shadowMap:{render(){}},
    renderBufferDirect(){renderer.info.render.calls++;renderer.info.render.triangles+=240;},
    render(){renderer.renderBufferDirect(camera,scene,geometry,material,object,null);}};
  const diagnostics=new GraphicsDiagnostics(renderer as WebGLRenderer,profiler);diagnostics.enabled=true;
  diagnostics.pass('Main color',()=>renderer.render(scene,camera));
  assert.deepEqual(started,['GPU main color']);assert.deepEqual(finished,[[query,true]]);
});

test('texture-file breakdown identifies independent uploads of the same file while deduplicating shared sources',()=>{
  const scene=new Scene(),geometry=new BoxGeometry();
  const a=new Texture({width:64,height:64} as any),b=new Texture({width:64,height:64} as any);
  a.name=b.name='cars/paint.dds';a.generateMipmaps=b.generateMipmaps=false;
  for(const map of [a,a.clone(),b])scene.add(new InstancedMesh(geometry,new MeshStandardMaterial({map}),1));
  const resources=sceneResources(scene);assert.equal(resources.textures,2);
  assert.deepEqual(resources.textureFiles,[{name:'cars/paint.dds',bytes:64*64*4*2,copies:2,width:64,height:64}]);
  assert.equal(resources.meshes,3);assert.equal(resources.visibleMeshes,3);
});
