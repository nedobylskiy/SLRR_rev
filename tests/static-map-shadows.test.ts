import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, Scene, Texture, Vector3, Vector4 } from 'three';
import { StaticMapShadows } from '../src/render/static-map-shadows';

test('static shadow cache excludes vehicles, preserves cutouts and restores renderer state even after failure', () => {
  const cache = new StaticMapShadows(), scene = new Scene(), root = new Group();scene.add(root);
  const source = new MeshStandardMaterial({map:new Texture(),alphaTest:0.5}), tree = new Mesh(new BoxGeometry(),source);
  tree.castShadow=false;tree.userData.staticMapCaster=true;root.add(tree);
  const car = new Mesh(new BoxGeometry(),new MeshStandardMaterial());scene.add(car);
  let captures = 0, fail = false;
  const renderer = {
    autoClear:false,shadowMap:{autoUpdate:true},getRenderTarget:()=>null,
    getClearColor:(out:Color)=>out.set(0x123456),getClearAlpha:()=>0.4,getViewport:(out:Vector4)=>out.set(1,2,300,200),
    setRenderTarget(){},setClearColor(){},setViewport(){},clear(){},
    render(pass:Scene) {
      captures++;assert.equal(pass.children[0],root);assert.equal(car.parent,scene);
      assert.equal((tree.material as any).isMeshDepthMaterial,true);
      assert.equal((tree.material as any).map,source.map);assert.equal(tree.material.alphaTest,0.5);
      assert.equal(tree.visible,true,'static-only casters still enter the cached depth bake');
      assert.equal(tree.castShadow,false,'the bake does not enable dynamic shadow casting');
      if(fail)throw new Error('capture failed');
    },
  };
  const direction=new Vector3(1,2,1).normalize();
  const update = (now:number,revision=1,focus=new Vector3())=>cache.update(renderer as any,root,focus,direction,revision,now);
  update(0);assert.equal(captures,0);
  cache.enabled.value=1;update(0);assert.equal(captures,1);assert.equal(cache.available.value,1);
  update(2000);assert.equal(captures,1,'stationary static scene reuses its projection');
  update(2001,2);assert.equal(captures,2,'new streamed geometry invalidates the cache');
  update(2100,3);assert.equal(captures,2,'streaming captures are throttled');
  update(3100,3);assert.equal(captures,3);
  direction.set(-1,2,1).normalize();update(3150,3);
  assert.equal(captures,4,'sun turns bypass the streaming throttle to follow dynamic shadows');
  const sunProjection=cache.matrix.value.clone();
  const projectedOrigin=new Vector3().applyMatrix4(sunProjection),projectedAlongSun=direction.clone().applyMatrix4(sunProjection);
  assert.ok(Math.abs(projectedOrigin.x-projectedAlongSun.x)<1e-10);
  assert.ok(Math.abs(projectedOrigin.y-projectedAlongSun.y)<1e-10,'cached projection looks along the current sun direction');
  direction.x+=1e-6;direction.normalize();update(3200,3);
  assert.equal(captures,4,'sub-tolerance sun jitter does not recapture every frame');
  assert.equal(root.parent,scene);assert.equal(tree.material,source);assert.equal(tree.visible,true);
  assert.equal(renderer.autoClear,false);assert.equal(renderer.shadowMap.autoUpdate,true);
  cache.setNightQuality(true);update(3300,3);
  assert.equal(cache.texture.value!.image.width,3072);
  assert.equal(cache.texel.value,1/3072);
  const nightCaptures=captures;
  cache.setNightQuality(true);update(4400,3);
  assert.equal(captures,nightCaptures,'stable night quality reuses its shadow map');
  cache.setNightQuality(false);update(4500,3);
  assert.equal(cache.texture.value!.image.width,2048);
  assert.equal(cache.texel.value,1/2048);
  fail=true;
  const projection = cache.matrix.value.clone();
  assert.throws(()=>update(5000,4,new Vector3(100,0,0)),/capture failed/);
  assert.deepEqual(cache.matrix.value,projection,'failed captures cannot publish a matrix for the old texture');
  assert.equal(root.parent,scene);assert.equal(tree.material,source);
  assert.equal(renderer.autoClear,false);assert.equal(renderer.shadowMap.autoUpdate,true);
  cache.reset();assert.equal(cache.available.value,0);assert.equal(cache.texture.value,null);
  assert.equal(cache.enabled.value,1,'changing maps preserves the UI switch');
});
