import test from 'node:test';
import assert from 'node:assert/strict';
import {Color,MeshStandardMaterial,Texture,Vector4,NoBlending,NoToneMapping,RepeatWrapping} from 'three';
import {createBuildingTextureArray,BuildingTextureArrays} from '../src/render/building-texture-array';

test('array preparation preserves paint alpha, generates per-layer mipmaps and restores renderer state',()=>{
  const texture=new Texture({width:64,height:32} as any);texture.repeat.set(3,2);texture.offset.set(.25,.5);
  const materials=[new MeshStandardMaterial({map:texture}),new MeshStandardMaterial({color:0xff0000})];
  const originalTarget={},viewport=new Vector4(4,5,100,200),scissor=new Vector4(6,7,40,50),calls:any[]=[];
  let current:any=originalTarget,currentLayer=2,activeViewport=viewport.clone(),activeScissor=scissor.clone(),scissorTest=true;
  const renderer:any={autoClear:false,toneMapping:123,xr:{enabled:true},
    getRenderTarget:()=>current,getActiveCubeFace:()=>2,getActiveMipmapLevel:()=>0,
    getViewport:(v:Vector4)=>v.copy(activeViewport),getScissor:(v:Vector4)=>v.copy(activeScissor),getScissorTest:()=>scissorTest,
    getClearColor:(v:Color)=>v.setHex(0x123456),getClearAlpha:()=>.5,
    setRenderTarget:(t:any,l:number)=>{current=t;currentLayer=l;},setViewport:(v:Vector4)=>{activeViewport.copy(v);},setScissor:(v:Vector4)=>{activeScissor.copy(v);},
    setScissorTest:(v:boolean)=>{scissorTest=v;},setClearColor:()=>{},
    render:(scene:any)=>{const material=scene.children[0].material;calls.push({layer:currentLayer,transparent:material.transparent,blending:material.blending,mips:current.texture.generateMipmaps,mapRepeat:material.map?.repeat.toArray()});assert.equal(renderer.toneMapping,NoToneMapping);},
  };
  const target=createBuildingTextureArray(renderer,materials);
  assert.equal(target.width,64);assert.equal(target.height,32);assert.equal(target.depth,2);assert.equal(target.texture.wrapS,RepeatWrapping);
  assert.deepEqual(calls.map(c=>c.layer),[0,1]);assert.ok(calls.every(c=>c.transparent&&c.blending===NoBlending));assert.deepEqual(calls.map(c=>c.mips),[false,true]);assert.deepEqual(calls[0].mapRepeat,[1,1]);
  assert.deepEqual(texture.repeat.toArray(),[3,2]);assert.deepEqual(texture.offset.toArray(),[.25,.5]);
  assert.equal(current,originalTarget);assert.equal(renderer.autoClear,false);assert.equal(renderer.toneMapping,123);assert.equal(renderer.xr.enabled,true);assert.equal(scissorTest,true);assert.deepEqual(activeViewport.toArray(),viewport.toArray());
  target.dispose();
  const pool=new BuildingTextureArrays(),a=pool.acquire(renderer,materials),b=pool.acquire(renderer,materials);
  assert.equal(pool.count,1);assert.equal(a.texture,b.texture);assert.equal(calls.length,4,'second acquire reuses GPU copy');
  a.release();assert.equal(pool.count,1);a.release();assert.equal(pool.count,1,'release is idempotent');b.release();assert.equal(pool.count,0);assert.equal(pool.bytes,0);
  assert.throws(()=>createBuildingTextureArray(renderer,materials,1),/budget/);
});
