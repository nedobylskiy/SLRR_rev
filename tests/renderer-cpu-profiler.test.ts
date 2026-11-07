import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, PerspectiveCamera, type WebGLRenderer } from 'three';
import type { FrameProfiler } from '../src/render/frame-profiler';
import { RendererCpuProfiler } from '../src/render/renderer-cpu-profiler';

test('sampled renderer breakdown partitions matrices, traversal, sorting, shadows and draws',t=>{
  let time=0,enabled=false;
  t.mock.method(performance,'now',()=>time);
  const rows=new Map<string,number>(),scene=new Scene(),camera=new PerspectiveCamera();
  const sceneUpdate=()=>{time+=2;},cameraUpdate=()=>{time+=1;};
  scene.updateMatrixWorld=sceneUpdate;camera.updateMatrixWorld=cameraUpdate;
  const list={init(){},finish(){},sort(){time+=3;}};
  let fail=false;
  const renderer:any={renderLists:{get:()=>list},renderBufferDirect:()=>{time+=7;},
    shadowMap:{render:()=>renderer.renderBufferDirect()},
    render:(scene:Scene,camera:PerspectiveCamera)=>{
      scene.updateMatrixWorld();camera.updateMatrixWorld();
      const list=renderer.renderLists.get();list.init();time+=5;list.finish();list.sort();
      renderer.shadowMap.render();renderer.renderBufferDirect();renderer.renderBufferDirect();time+=6;
      if(fail)throw Error('render failed');
    }};
  const profiler={record:(name:string,ms:number)=>rows.set(name,ms)} as unknown as FrameProfiler;
  new RendererCpuProfiler(renderer as WebGLRenderer,profiler,()=>enabled);
  renderer.render(scene,camera);assert.equal(rows.size,0);
  enabled=true;
  for(let i=0;i<16;i++)renderer.render(scene,camera);
  assert.equal(rows.size,0);
  renderer.render(scene,camera);
  for(const [name,ms] of Object.entries({matrices:3,'traversal + list build':5,sorting:3,'draw submission':14,shadows:7,remaining:6}))
    assert.equal(rows.get(`Renderer ${name} CPU (sampled)`),ms,name);
  assert.equal(scene.updateMatrixWorld,sceneUpdate);assert.equal(camera.updateMatrixWorld,cameraUpdate);
  for(let i=0;i<16;i++)renderer.render(scene,camera);
  fail=true;assert.throws(()=>renderer.render(scene,camera),/render failed/);
  assert.equal(scene.updateMatrixWorld,sceneUpdate);assert.equal(camera.updateMatrixWorld,cameraUpdate);
});
