import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry,Group,InstancedMesh,Matrix4,MeshStandardMaterial,PerspectiveCamera,Vector4,type WebGLRenderer} from 'three';
import {MapGpuOcclusion} from '../src/render/map-gpu-occlusion';
import {allocateMapPlacementIds,setMapPlacementIds} from '../src/render/map-placement-ids';

function fixture(){
  let ready=false,fail=false,target:unknown=null;
  const rendered:string[]=[];
  const gl={TIMEOUT_EXPIRED:1,WAIT_FAILED:2,ALREADY_SIGNALED:3,PIXEL_PACK_BUFFER_BINDING:4,PIXEL_PACK_BUFFER:5,STREAM_READ:6,RGBA:7,UNSIGNED_BYTE:8,SYNC_GPU_COMMANDS_COMPLETE:9,
    isContextLost:()=>false,clientWaitSync:()=>ready?3:1,getParameter:()=>null,bindBuffer:()=>{},bufferData:()=>{},readPixels:()=>{},
    createBuffer:()=>({}),fenceSync:()=>({}),flush:()=>{},deleteSync:()=>{},deleteBuffer:()=>{},getBufferSubData:(_target:number,_offset:number,bytes:Uint8Array)=>bytes.fill(255)};
  const renderer={shadowMap:{enabled:true,render:()=>{}},xr:{enabled:true},autoClear:false,info:{render:{calls:1,triangles:2}},
    getContext:()=>gl,getRenderTarget:()=>target,getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,
    getViewport:(v:Vector4)=>v.set(0,0,800,600),getScissor:(v:Vector4)=>v.set(0,0,800,600),getScissorTest:()=>true,
    setViewport:()=>{},setScissor:()=>{},setScissorTest:()=>{},setRenderTarget:(t:unknown)=>{target=t;},
    render:(scene:unknown)=>{if(fail)throw Error('stage failed');rendered.push(scene===(cull as any).depthScene?'depth':'quad');}
  };
  const cull=new MapGpuOcclusion(renderer as unknown as WebGLRenderer),root=new Group(),camera=new PerspectiveCamera(60,1,.1,100);
  const mesh=new InstancedMesh(new BoxGeometry(),new MeshStandardMaterial(),3);mesh.count=2;root.add(mesh);
  const ids=allocateMapPlacementIds(3);setMapPlacementIds(mesh,ids.slice(0,2));
  mesh.setMatrixAt(0,new Matrix4().makeTranslation(0,0,-10));mesh.setMatrixAt(1,new Matrix4().makeTranslation(4,0,-10));mesh.instanceMatrix.needsUpdate=true;
  const api=cull as any;api.collect(root);const state=api.states.get(mesh);
  api.apply({items:[{state,slot:0},{state,slot:1}],bytes:new Uint8Array([0,0,0,0,255,0,0,0])});
  return {cull,api,root,camera,mesh,ids,renderer,rendered,setReady:()=>{ready=true;},setFail:()=>{fail=true;},getTarget:()=>target,
    dispose:()=>{cull.dispose();mesh.dispose();mesh.geometry.dispose();(mesh.material as MeshStandardMaterial).dispose();}};
}

test('Hi-Z splits depth/test frames, captures one camera/bounds generation and keeps the old mask until readback',()=>{
  const f=fixture(),{cull,api,root,camera,mesh,ids,rendered}=f;cull.workProfile.setEnabled(true);
  cull.prepare(camera,root,false,0);
  assert.deepEqual(rendered,['depth']);assert.equal(api.pending,undefined);assert.ok(api.staged);
  const snapshot=api.staged,projection=snapshot.viewProjection.clone(),bounds=Array.from(snapshot.boxes.image.data);
  assert.equal(api.states.get(mesh).hidden,1);assert.equal(cull.workProfile.drain().depth_stages_count,1);
  camera.position.x=20;camera.rotation.y=.5;camera.updateProjectionMatrix();
  mesh.count=3;mesh.setMatrixAt(0,new Matrix4().makeTranslation(4,0,-10));mesh.setMatrixAt(1,new Matrix4().makeTranslation(0,0,-10));mesh.setMatrixAt(2,new Matrix4().makeTranslation(8,0,-10));
  setMapPlacementIds(mesh,[ids[1],ids[0],ids[2]]);mesh.instanceMatrix.needsUpdate=true;
  cull.prepare(camera,root,false,1);
  assert.equal(rendered.filter(s=>s==='depth').length,1,'frame two never rebuilds depth');
  assert.equal(rendered.length,11);assert.equal(api.staged,undefined);assert.equal(api.pending.items.length,2);
  assert.ok(api.test.uniforms.viewProjection.value.equals(projection));assert.equal(api.test.uniforms.count.value,2);assert.deepEqual(Array.from(api.test.uniforms.boxes.value.image.data),bounds);
  let state=api.states.get(mesh);assert.equal(state.hidden,1);assert.equal(state.visibleSlots.has(1),false);assert.equal(state.visibleSlots.has(2),true);
  const work=cull.workProfile.drain();assert.equal(work.depth_stages_count,undefined);assert.equal(work.visibility_stages_count,1);
  cull.prepare(camera,root,false,1);assert.equal(api.states.get(mesh).hidden,1,'pending GPU readback keeps old mask');
  cull.renderMain(()=>assert.equal(mesh.visible,false));assert.equal(mesh.visible,true);
  f.setReady();cull.prepare(camera,root,false,1);state=api.states.get(mesh);assert.equal(state.hidden,0,'ready replacement finally publishes visible');
  assert.equal(cull.stats().pipeline_stage,'idle');assert.equal(rendered.filter(s=>s==='depth').length,1);
  assert.equal(f.getTarget(),null);assert.equal(f.renderer.xr.enabled,true);assert.equal(f.renderer.shadowMap.enabled,true);assert.equal(f.renderer.autoClear,false);
  f.dispose();
});

test('a failed next stage cancels only the new generation and preserves the last applied mask',()=>{
  const f=fixture();f.cull.prepare(f.camera,f.root,false,0);assert.ok(f.api.staged);
  f.setFail();f.cull.prepare(f.camera,f.root,false,0);
  assert.equal(f.api.staged,undefined);assert.equal(f.api.pending,undefined);assert.equal(f.api.states.get(f.mesh).hidden,1);
  assert.match(f.cull.stats().error,/stage failed/);assert.equal(f.getTarget(),null);assert.equal(f.renderer.xr.enabled,true);assert.equal(f.renderer.shadowMap.enabled,true);
  f.dispose();
});
