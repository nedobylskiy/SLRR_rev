import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry,Mesh,MeshStandardMaterial,Texture} from 'three';
import {MapMaterialPool} from '../src/render/map-material-pool';

test('equal static surfaces share material state until the last model evicts',()=>{
  const pool=new MapMaterialPool(),source=new Texture();
  const a=new MeshStandardMaterial({map:source.clone()}),b=new MeshStandardMaterial({map:source.clone()});
  const x=new Mesh(new BoxGeometry(),a),y=new Mesh(new BoxGeometry(),b);
  let materialReleases=0,textureReleases=0,discarded=0;
  a.addEventListener('dispose',()=>materialReleases++);a.map!.addEventListener('dispose',()=>textureReleases++);
  b.addEventListener('dispose',()=>discarded++);
  pool.acquire([x]);pool.acquire([y]);assert.equal(x.material,y.material);assert.equal(discarded,1);
  assert.equal(pool.release(x.material),true);assert.equal(materialReleases,0);assert.equal(textureReleases,0);
  pool.release(y.material);assert.equal(materialReleases,1);assert.equal(textureReleases,1);
});

test('one model owns one reference even when several sections share a material',()=>{
  const pool=new MapMaterialPool(),source=new Texture();
  const parts=[0,1,2].map(()=>new Mesh(new BoxGeometry(),new MeshStandardMaterial({map:source.clone()})));
  pool.acquire(parts);assert.equal(new Set(parts.map(p=>p.material)).size,1);
  let releases=0;parts[0].material.addEventListener('dispose',()=>releases++);
  pool.release(parts[0].material);assert.equal(releases,1);
});

test('different UVs, vertex shaders, tint, transparency and baked textures keep separate state',()=>{
  const pool=new MapMaterialPool(),source=new Texture();
  const make=()=>new MeshStandardMaterial({map:source.clone()});
  const a=make(),uv=make(),shader=make(),tint=make(),blend=make(),baked=make();
  uv.map!.offset.x=.5;shader.customProgramCacheKey=()=> 'other vertex color mode';tint.color.set(0xff0000);
  blend.transparent=true;baked.userData.bakedLightmapTexture=new Texture();
  const parts=[a,uv,shader,tint,blend,baked].map(m=>new Mesh(new BoxGeometry(),m));
  pool.acquire(parts);assert.equal(new Set(parts.map(p=>p.material)).size,6);
  for(const p of parts)if(!pool.release(p.material))p.material.dispose();
});
