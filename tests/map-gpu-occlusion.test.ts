import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry,Color,DoubleSide,FrontSide,BackSide,Group,InstancedMesh,Matrix4,Mesh,MeshStandardMaterial,PlaneGeometry,PerspectiveCamera,Vector3,type WebGLRenderer} from 'three';
import {MapGpuOcclusion,gpuDepthOccluder,gpuResultUsable,gpuSourceKey} from '../src/render/map-gpu-occlusion';

test('GPU verdict survives long static intervals but rejects camera translation and turn',()=>{
  assert.ok(gpuResultUsable(35,.4,.005));
  assert.equal(gpuResultUsable(10000,0,0),true);
  assert.equal(gpuResultUsable(20,2.1,0),false);
  assert.equal(gpuResultUsable(20,0,.04),false);
});

test('GPU compacted main pass preserves source casters, colors, exception restoration and stale-source fallback',()=>{
  let duringShadow=()=>{};
  const renderer={shadowMap:{render:()=>duringShadow()}} as unknown as WebGLRenderer;
  const cull=new MapGpuOcclusion(renderer),parent=new Group();
  const mesh=new InstancedMesh(new BoxGeometry(),new MeshStandardMaterial(),2);parent.add(mesh);mesh.updateMatrixWorld();
  mesh.setMatrixAt(0,new Matrix4());mesh.setMatrixAt(1,new Matrix4().makeTranslation(4,0,0));mesh.instanceMatrix.needsUpdate=true;
  mesh.setColorAt(0,new Color('red'));mesh.setColorAt(1,new Color('blue'));
  const state={mesh,key:gpuSourceKey(mesh),world:mesh.matrixWorld.clone(),bounds:[],kept:'',hidden:0};
  (cull as any).states.set(mesh,state);
  (cull as any).apply({items:[{state,slot:0},{state,slot:1}],bytes:new Uint8Array([0,0,0,0,255,255,255,255])});
  assert.equal(cull.stats().hidden_instances,1);
  cull.applyResults=false;
  cull.renderMain(()=>{assert.equal(mesh.visible,true);assert.deepEqual(parent.children,[mesh]);});
  assert.equal(cull.stats().hidden_instances,1,'measurement-only keeps verdicts available for debug');
  cull.applyResults=true;
  duringShadow=()=>assert.equal(mesh.visible,true);
  assert.throws(()=>cull.renderMain(()=>{
    assert.equal(mesh.visible,false);const proxy=parent.children.find(m=>m.userData.gpuOcclusionProxy) as InstancedMesh;
    assert.equal(proxy.count,1);const color=new Color();proxy.getColorAt(0,color);assert.equal(color.getHex(),0x0000ff);
    renderer.shadowMap.render([],parent as any,{} as any);assert.equal(mesh.visible,false);throw Error('render failed');
  }),/render failed/);
  assert.equal(mesh.visible,true);assert.deepEqual(parent.children,[mesh]);
  mesh.instanceMatrix.needsUpdate=true;
  cull.renderMain(()=>assert.equal(mesh.visible,true));
  cull.reset();assert.equal(cull.stats().hidden_instances,0);cull.dispose();mesh.geometry.dispose();(mesh.material as MeshStandardMaterial).dispose();mesh.dispose();
});


test('GPU depth accepts flat roads and small facade pieces but excludes tall props and real alpha holes',()=>{
  const road=new InstancedMesh(new PlaneGeometry(80,80),new MeshStandardMaterial(),1);road.geometry.rotateX(-Math.PI/2);road.userData.mapOcclusionRole='terrain';
  const wall=new InstancedMesh(new BoxGeometry(2,1,.1),new MeshStandardMaterial(),1);wall.userData.mapOcclusionRole='structure';
  const tree=new InstancedMesh(new BoxGeometry(12,20,12),new MeshStandardMaterial(),1);tree.userData.mapOcclusionRole='prop';
  assert.equal(gpuDepthOccluder(road),true);assert.equal(gpuDepthOccluder(wall),true);assert.equal(gpuDepthOccluder(tree),false);
  (wall.material as MeshStandardMaterial).alphaTest=.5;assert.equal(gpuDepthOccluder(wall),false);
  (wall.material as MeshStandardMaterial).alphaTest=0;(wall.material as MeshStandardMaterial).transparent=true;assert.equal(gpuDepthOccluder(wall),false);
  for(const m of [road,wall,tree]){m.geometry.dispose();(m.material as MeshStandardMaterial).dispose();m.dispose();}
});

test('map streaming preserves depth roles through cached prop cells and terrain chunks',async()=>{
  const {MapObjectStream}=await import('../src/render/map-object-stream');
  for(const role of ['prop','terrain']){
    const parent=new Group(),stream=new MapObjectStream(parent,100);
    const part=new Mesh(role==='terrain'?new PlaneGeometry(256,256,16,16):new BoxGeometry(12,20,12),new MeshStandardMaterial());part.userData.mapOcclusionRole=role;
    if(role==='terrain')part.geometry.rotateX(-Math.PI/2);
    stream.add([{position:new Vector3(),matrix:new Matrix4(),bounds:{minX:-128,maxX:128,minZ:-128,maxZ:128}}],async()=>[part],role==='prop'?'trees':false);
    stream.update(new Vector3());await Promise.resolve();stream.update(new Vector3());
    if(role==='terrain'){stream.setGeometryCutoff(true);stream.update(new Vector3());}else{await stream.setCachedCells(true,64);stream.update(new Vector3());}
    const shown=parent.children.filter(m=>m.visible) as InstancedMesh[];assert.ok(shown.length);
    for(const mesh of shown){assert.equal(mesh.userData.mapOcclusionRole,role);assert.equal(gpuDepthOccluder(mesh),role==='terrain');}
    stream.dispose();
  }
});


test('observer debug projects boxes with observer camera but decodes depth with captured primary near/far',()=>{
  let renderedCamera:unknown;
  const renderer={shadowMap:{enabled:true,render:()=>{}},info:{autoReset:true},autoClear:true,
    getViewport:(v:any)=>v.set(0,0,1280,720),getScissor:(v:any)=>v.set(0,0,1280,720),getScissorTest:()=>false,
    setViewport:()=>{},setScissor:()=>{},setScissorTest:()=>{},render:(_scene:unknown,camera:unknown)=>{renderedCamera=camera;}
  } as unknown as WebGLRenderer;
  const cull=new MapGpuOcclusion(renderer),observer=new PerspectiveCamera(60,1,5,100);
  cull.enabled=true;cull.observerView=true;(cull as any).depthNearFar.set(.25,5000);
  cull.debugMode='depth';cull.renderDebug(observer);
  assert.deepEqual((cull as any).debugMaterial.uniforms.nearFar.value.toArray(),[.25,5000]);
  cull.debugMode='boxes';cull.renderDebug(observer);assert.equal(renderedCamera,observer);
  assert.equal(cull.stats().visibility_camera,'primary');assert.equal(cull.stats().observer_view,true);
  assert.equal(renderer.autoClear,true);assert.equal(renderer.info.autoReset,true);assert.equal(renderer.shadowMap.enabled,true);
  cull.dispose();
});


test('last completed visibility stays applied beyond 100 ms and through a pending fence until replacement is ready',()=>{
  let ready=false;
  const gl={TIMEOUT_EXPIRED:1,WAIT_FAILED:2,ALREADY_SIGNALED:3,PIXEL_PACK_BUFFER_BINDING:4,PIXEL_PACK_BUFFER:5,
    isContextLost:()=>false,clientWaitSync:()=>ready?3:1,getParameter:()=>null,bindBuffer:()=>{},
    getBufferSubData:(_target:number,_offset:number,bytes:Uint8Array)=>bytes.fill(255),deleteSync:()=>{},deleteBuffer:()=>{}};
  const renderer={shadowMap:{render:()=>{}},getContext:()=>gl} as unknown as WebGLRenderer;
  const cull=new MapGpuOcclusion(renderer),root=new Group(),camera=new PerspectiveCamera();camera.updateMatrixWorld();
  const mesh=new InstancedMesh(new BoxGeometry(),new MeshStandardMaterial(),2);root.add(mesh);
  mesh.setMatrixAt(0,new Matrix4().makeTranslation(0,0,-10));mesh.setMatrixAt(1,new Matrix4().makeTranslation(4,0,-10));mesh.instanceMatrix.needsUpdate=true;
  (cull as any).collect(root);const state=(cull as any).states.get(mesh);
  (cull as any).apply({items:[{state,slot:0},{state,slot:1}],bytes:new Uint8Array([0,0,0,0,255,255,255,255])});
  (cull as any).lastPose={time:performance.now()-2000,position:camera.position.clone(),rotation:camera.quaternion.clone(),projection:camera.projectionMatrix.clone()};
  cull.enabled=true;cull.intervalFrames=12;cull.freeze=true;(cull as any).submissions=1;
  (cull as any).pending={sync:{},buffer:{},bytes:new Uint8Array(8),items:[{state,slot:0},{state,slot:1}],frame:0,time:performance.now()-2000,position:camera.position.clone(),rotation:camera.quaternion.clone(),projection:camera.projectionMatrix.clone()};
  for(let i=0;i<30;i++){
    cull.prepare(camera,root,false,0);assert.equal(cull.stats().hidden_instances,1);
    cull.renderMain(()=>{assert.equal(mesh.visible,false);assert.equal((root.children.find(m=>m.userData.gpuOcclusionProxy) as InstancedMesh).count,1);});
  }
  ready=true;cull.prepare(camera,root,false,0);
  assert.equal(cull.stats().hidden_instances,0,'ready visible verdict replaces old hidden verdict');
  cull.renderMain(()=>assert.equal(mesh.visible,true));cull.dispose();mesh.geometry.dispose();(mesh.material as MeshStandardMaterial).dispose();mesh.dispose();
});

test('streamer slot reorder keeps known hidden placements and shows only new placements while GPU result is pending',()=>{
  const gl={TIMEOUT_EXPIRED:1,WAIT_FAILED:2,isContextLost:()=>false,clientWaitSync:()=>1,deleteSync:()=>{},deleteBuffer:()=>{}};
  const renderer={shadowMap:{render:()=>{}},getContext:()=>gl} as unknown as WebGLRenderer;
  const cull=new MapGpuOcclusion(renderer),root=new Group(),camera=new PerspectiveCamera();camera.updateMatrixWorld();
  const mesh=new InstancedMesh(new BoxGeometry(),new MeshStandardMaterial(),3);root.add(mesh);mesh.count=2;
  mesh.setMatrixAt(0,new Matrix4().makeTranslation(0,0,-10));mesh.setMatrixAt(1,new Matrix4().makeTranslation(4,0,-10));mesh.instanceMatrix.needsUpdate=true;
  (cull as any).collect(root);const state=(cull as any).states.get(mesh);
  (cull as any).apply({items:[{state,slot:0},{state,slot:1}],bytes:new Uint8Array([0,0,0,0,255,255,255,255])});
  mesh.count=3;mesh.setMatrixAt(0,new Matrix4().makeTranslation(4,0,-10));mesh.setMatrixAt(1,new Matrix4().makeTranslation(0,0,-10));mesh.setMatrixAt(2,new Matrix4().makeTranslation(8,0,-10));mesh.instanceMatrix.needsUpdate=true;
  cull.enabled=true;(cull as any).pending={sync:{},buffer:{}};
  cull.prepare(camera,root,false,1);assert.equal(cull.stats().hidden_instances,1);
  cull.renderMain(()=>{assert.equal(mesh.visible,false);const proxy=root.children.find(m=>m.userData.gpuOcclusionProxy) as InstancedMesh;
    assert.equal(proxy.count,2);const m=new Matrix4();proxy.getMatrixAt(0,m);assert.equal(m.elements[12],4);proxy.getMatrixAt(1,m);assert.equal(m.elements[12],8);});
  cull.dispose();mesh.geometry.dispose();(mesh.material as MeshStandardMaterial).dispose();mesh.dispose();
});


test('transparent two-pass shader recompilation preserves visibility keys, while real depth changes invalidate them',()=>{
  const material=new MeshStandardMaterial({transparent:true,opacity:.6,side:DoubleSide});
  const mesh=new InstancedMesh(new BoxGeometry(),material,1);const key=gpuSourceKey(mesh);
  for(let frame=0;frame<36;frame++){
    material.side=BackSide;material.needsUpdate=true;material.side=FrontSide;material.needsUpdate=true;material.side=DoubleSide;
    assert.equal(gpuSourceKey(mesh),key);
  }
  material.opacity=.4;assert.notEqual(gpuSourceKey(mesh),key);material.opacity=.6;
  material.depthTest=false;assert.notEqual(gpuSourceKey(mesh),key);material.depthTest=true;
  material.side=FrontSide;assert.notEqual(gpuSourceKey(mesh),key);material.side=DoubleSide;
  mesh.instanceMatrix.needsUpdate=true;assert.notEqual(gpuSourceKey(mesh),key);
  mesh.geometry.dispose();material.dispose();mesh.dispose();
});
