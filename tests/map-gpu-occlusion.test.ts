import {allocateMapPlacementIds,setMapPlacementIds} from '../src/render/map-placement-ids';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry,Color,DoubleSide,FrontSide,BackSide,Group,InstancedMesh,Matrix4,Mesh,MeshStandardMaterial,PlaneGeometry,PerspectiveCamera,Vector3,type WebGLRenderer} from 'three';
import {MapGpuOcclusion,gpuDepthOccluder,gpuSourceKey} from '../src/render/map-gpu-occlusion';

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


test('camera translation, turning and projection changes retain the last verdict until the pending GPU replacement is ready',()=>{
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
  cull.enabled=true;cull.intervalFrames=12;cull.freeze=true;(cull as any).submissions=1;
  (cull as any).pending={sync:{},buffer:{},bytes:new Uint8Array(8),items:[{state,slot:0},{state,slot:1}],frame:0,time:performance.now()-2000,position:camera.position.clone(),rotation:camera.quaternion.clone(),projection:camera.projectionMatrix.clone()};
  for(let i=0;i<30;i++){
    camera.position.x+=3;camera.rotation.y+=.05;camera.fov+=.1;camera.updateProjectionMatrix();
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


test('depth-pass instances stay out of candidate counters and bounding-box diagnostics',()=>{
  const renderer={shadowMap:{enabled:true,render:()=>{}},info:{autoReset:true},autoClear:true,
    getViewport:(v:any)=>v.set(0,0,1280,720),getScissor:(v:any)=>v.set(0,0,1280,720),getScissorTest:()=>false,
    setViewport:()=>{},setScissor:()=>{},setScissorTest:()=>{},render:()=>{}} as unknown as WebGLRenderer;
  const cull=new MapGpuOcclusion(renderer),root=new Group();
  const wall=new InstancedMesh(new BoxGeometry(10,10,1),new MeshStandardMaterial(),2);wall.userData.mapOcclusionRole='structure';
  const prop=new InstancedMesh(new BoxGeometry(1,10,1),new MeshStandardMaterial(),3);prop.userData.mapOcclusionRole='prop';root.add(wall,prop);
  (cull as any).collect(root);cull.enabled=true;cull.debugMode='boxes';cull.renderDebug(new PerspectiveCamera());
  assert.equal(cull.stats().depth_only_instances,2);assert.equal(cull.stats().candidate_instances,3);
  assert.equal((cull as any).boxLines.geometry.attributes.position.count,3*24,'only prop boxes are diagnostic candidates');
  cull.dispose();for(const m of [wall,prop]){m.geometry.dispose();(m.material as MeshStandardMaterial).dispose();m.dispose();}
});


test('hidden placements survive streamer removal/re-entry and pending results follow captured placement identities',()=>{
  const renderer={shadowMap:{render:()=>{}}} as unknown as WebGLRenderer;
  const cull=new MapGpuOcclusion(renderer),root=new Group();
  const mesh=new InstancedMesh(new BoxGeometry(),new MeshStandardMaterial(),3);root.add(mesh);mesh.count=2;
  const a=new Matrix4().makeTranslation(0,0,-10),b=new Matrix4().makeTranslation(4,0,-10),c=new Matrix4().makeTranslation(8,0,-10);
  mesh.setMatrixAt(0,a);mesh.setMatrixAt(1,b);mesh.instanceMatrix.needsUpdate=true;
  (cull as any).collect(root);const original=(cull as any).states.get(mesh);
  (cull as any).apply({items:[{state:original,slot:0},{state:original,slot:1}],bytes:new Uint8Array([0,0,0,0,255,255,255,255])});
  mesh.count=1;mesh.setMatrixAt(0,b);mesh.instanceMatrix.needsUpdate=true;(cull as any).collect(root);
  assert.equal(cull.stats().hidden_instances,0);
  mesh.count=0;mesh.visible=false;(cull as any).collect(root);
  mesh.visible=true;mesh.count=3;mesh.setMatrixAt(0,b);mesh.setMatrixAt(1,c);mesh.setMatrixAt(2,a);mesh.instanceMatrix.needsUpdate=true;(cull as any).collect(root);
  assert.equal(cull.stats().hidden_instances,1,'re-entered A remains hidden without another shader pass');
  let state=(cull as any).states.get(mesh);assert.deepEqual([...state.visibleSlots],[0,1]);
  // The old GPU ticket says A visible, B hidden. Slots have since changed to B,C,A.
  (cull as any).apply({items:[{state:original,slot:0},{state:original,slot:1}],bytes:new Uint8Array([255,255,255,255,0,0,0,0])});
  state=(cull as any).states.get(mesh);assert.deepEqual([...state.visibleSlots],[1,2]);
  assert.equal(cull.stats().hidden_instances,1,'B hidden, unknown C and GPU-visible A shown');
  cull.renderMain(()=>{assert.equal(mesh.visible,false);const proxy=root.children.find(o=>o.userData.gpuOcclusionProxy) as InstancedMesh;
    const m=new Matrix4();proxy.getMatrixAt(0,m);assert.equal(m.elements[12],8);proxy.getMatrixAt(1,m);assert.equal(m.elements[12],0);});
  cull.dispose();mesh.geometry.dispose();(mesh.material as MeshStandardMaterial).dispose();mesh.dispose();
});


test('static placement boxes and GPU packing survive repeated passes and stream reorder',()=>{
  const cull=new MapGpuOcclusion({shadowMap:{render:()=>{}}} as unknown as WebGLRenderer),root=new Group();
  const mesh=new InstancedMesh(new BoxGeometry(),new MeshStandardMaterial(),2);root.add(mesh);
  const a=new Matrix4().makeTranslation(1,2,-10),b=new Matrix4().makeTranslation(4,5,-20);
  mesh.setMatrixAt(0,a);mesh.setMatrixAt(1,b);mesh.instanceMatrix.needsUpdate=true;
  cull.workProfile.setEnabled(true);
  const internals=cull as any;internals.collect(root);
  assert.equal(cull.workProfile.drain().bounds_built_count,2);
  const first=internals.states.get(mesh),items=internals.prepareCandidates(),texture=internals.boxes,version=texture.version;
  assert.equal(internals.prepareCandidates(),items);
  assert.equal(texture.version,version,'unchanged candidates do not upload boxes again');
  internals.collect(root);assert.equal(internals.prepareCandidates(),items);
  mesh.setMatrixAt(0,b);mesh.setMatrixAt(1,a);mesh.instanceMatrix.needsUpdate=true;internals.collect(root);
  const reordered=internals.states.get(mesh);
  assert.equal(reordered.bounds[0],first.bounds[1]);assert.equal(reordered.bounds[1],first.bounds[0]);
  assert.notEqual(internals.prepareCandidates(),items);assert.ok(texture.version>version);
  assert.equal(items[0].state,first,'pending GPU ticket retains its original immutable slot mapping');
  const work=cull.workProfile.drain();assert.equal(work.bounds_reused_count,2);assert.equal(work.bounds_uploads_count,2);
  assert.ok(work.collect_ms>=0&&work.pack_bounds_ms>=0);
  mesh.position.x=20;internals.collect(root);
  assert.notEqual(internals.states.get(mesh).bounds[0],reordered.bounds[0],'world transform invalidates cache');
  cull.reset();assert.equal(internals.prepareCandidates().length,0);cull.dispose();
  mesh.geometry.dispose();(mesh.material as MeshStandardMaterial).dispose();mesh.dispose();
});


test('numeric placement IDs distinguish coincident objects, preserve verdicts across slot changes and reject old transforms',()=>{
  const cull=new MapGpuOcclusion({shadowMap:{render:()=>{}}} as unknown as WebGLRenderer),root=new Group();
  const mesh=new InstancedMesh(new BoxGeometry(),new MeshStandardMaterial(),2);root.add(mesh);
  const ids=allocateMapPlacementIds(2),matrix=new Matrix4().makeTranslation(0,0,-10);
  assert.notEqual(ids[0],ids[1]);mesh.setMatrixAt(0,matrix);mesh.setMatrixAt(1,matrix);mesh.instanceMatrix.needsUpdate=true;setMapPlacementIds(mesh,ids);
  cull.workProfile.setEnabled(true);const api=cull as any;api.collect(root);const first=api.states.get(mesh);
  assert.deepEqual(first.identities,ids);api.apply({items:[{state:first,slot:0},{state:first,slot:1}],bytes:new Uint8Array([0,0,0,0,255,0,0,0])});
  assert.equal(first.hidden,1);assert.equal(first.visibleSlots.has(0),false);assert.equal(first.visibleSlots.has(1),true);
  setMapPlacementIds(mesh,[ids[1],ids[0]]);mesh.instanceMatrix.needsUpdate=true;api.collect(root);
  const reordered=api.states.get(mesh);assert.equal(reordered.hidden,1);assert.equal(reordered.visibleSlots.has(1),false);
  assert.equal(reordered.bounds[1],first.bounds[0]);
  mesh.removeFromParent();api.collect(root);root.add(mesh);api.collect(root);
  assert.equal(api.states.get(mesh).hidden,1,'temporary removal preserves the last shader verdict');
  mesh.setMatrixAt(1,new Matrix4().makeTranslation(50,0,-10));mesh.instanceMatrix.needsUpdate=true;api.collect(root);
  const moved=api.states.get(mesh);assert.equal(moved.hidden,0,'changed transform invalidates this placement only');
  assert.notEqual(moved.bounds[1],first.bounds[0]);assert.ok(moved.bounds[1].min.x>40);
  api.apply({items:[{state:first,slot:0},{state:first,slot:1}],bytes:new Uint8Array([0,0,0,0,255,0,0,0])});
  assert.equal(moved.hidden,0,'pending result for an old transform cannot hide the moved placement');
  const work=cull.workProfile.drain();assert.ok(work.numeric_identity_instances_count>0);assert.equal(work.fallback_matrix_identity_instances_count,undefined);
  cull.dispose();mesh.geometry.dispose();(mesh.material as MeshStandardMaterial).dispose();mesh.dispose();
});


test('depth GPU resources survive stream compaction, color changes and temporary absence, and dispose with their source',()=>{
  const cull=new MapGpuOcclusion({shadowMap:{render:()=>{}}} as unknown as WebGLRenderer),root=new Group();
  const mesh=new InstancedMesh(new BoxGeometry(),new MeshStandardMaterial(),4);mesh.count=2;mesh.userData.mapOcclusionRole='structure';root.add(mesh);
  const ids=allocateMapPlacementIds(2);setMapPlacementIds(mesh,ids);
  mesh.setMatrixAt(0,new Matrix4().makeTranslation(0,0,-10));mesh.setMatrixAt(1,new Matrix4().makeTranslation(50,0,-10));mesh.instanceMatrix.needsUpdate=true;
  cull.workProfile.setEnabled(true);const api=cull as any;api.collect(root);
  const first=api.states.get(mesh),depth=first.depth,material=depth.material;let disposed=0,materialDisposed=0;
  depth.addEventListener('dispose',()=>disposed++);material.addEventListener('dispose',()=>materialDisposed++);
  const uploadVersion=depth.instanceMatrix.version;
  mesh.setColorAt(0,new Color('red'));mesh.instanceColor!.needsUpdate=true;api.collect(root);
  assert.equal(api.states.get(mesh).depth,depth);assert.equal(depth.instanceMatrix.version,uploadVersion,'palette changes do not reupload depth matrices');
  mesh.count=1;mesh.setMatrixAt(0,new Matrix4().makeTranslation(50,0,-10));mesh.instanceMatrix.needsUpdate=true;setMapPlacementIds(mesh,[ids[1]]);api.collect(root);
  const current=api.states.get(mesh);assert.equal(current.depth,depth);assert.equal(depth.material,material);assert.equal(depth.count,1);
  assert.ok(depth.boundingSphere.center.x>40,'aggregate depth bounds follow the compacted matrices');
  assert.deepEqual(first.identities,ids,'old ticket metadata remains an immutable snapshot');assert.deepEqual(current.identities,[ids[1]]);
  mesh.removeFromParent();api.collect(root);assert.equal(depth.parent,null);assert.equal(disposed,0);
  root.add(mesh);api.collect(root);assert.equal(api.states.get(mesh).depth,depth);assert.equal(depth.parent,api.depthScene);
  assert.equal(api.prepareCandidates().length,0,'depth sources never enter the candidate buffer');
  const work=cull.workProfile.drain();assert.equal(work.depth_proxies_created_count,1);assert.ok(work.depth_proxies_reused_count>=2);assert.equal(work.sources_resumed_count,1);
  mesh.dispose();assert.equal(disposed,1);assert.equal(materialDisposed,1);assert.equal(api.states.has(mesh),false);assert.equal(api.dormant.size,0);
  cull.dispose();assert.equal(disposed,1);mesh.geometry.dispose();(mesh.material as MeshStandardMaterial).dispose();
});

test('visible GPU proxy buffers survive all-visible/all-hidden masks and semantic changes release incompatible resources',()=>{
  const cull=new MapGpuOcclusion({shadowMap:{render:()=>{}}} as unknown as WebGLRenderer),root=new Group();
  const mesh=new InstancedMesh(new BoxGeometry(),new MeshStandardMaterial(),2);root.add(mesh);
  setMapPlacementIds(mesh,allocateMapPlacementIds(2));mesh.setMatrixAt(0,new Matrix4());mesh.setMatrixAt(1,new Matrix4().makeTranslation(4,0,0));mesh.instanceMatrix.needsUpdate=true;
  const api=cull as any;api.collect(root);let state=api.states.get(mesh);
  const apply=(a:number,b:number)=>api.apply({items:[{state,slot:0},{state,slot:1}],bytes:new Uint8Array([a,0,0,0,b,0,0,0])});
  apply(0,255);const proxy=state.proxy;let disposed=0;proxy.addEventListener('dispose',()=>disposed++);
  apply(255,255);assert.equal(state.proxy,proxy);assert.equal(proxy.count,0);assert.equal(state.hidden,0);
  apply(0,0);assert.equal(state.proxy,proxy);assert.equal(proxy.count,0);assert.equal(state.hidden,2);
  apply(255,0);assert.equal(state.proxy,proxy);assert.equal(proxy.count,1);assert.equal(disposed,0);
  mesh.setColorAt(0,new Color('blue'));mesh.instanceColor!.needsUpdate=true;api.collect(root);
  state=api.states.get(mesh);assert.equal(state.proxy,proxy);assert.equal(state.hidden,1);
  (mesh.material as MeshStandardMaterial).side=BackSide;api.collect(root);assert.equal(disposed,1,'semantic changes release incompatible proxies');
  state=api.states.get(mesh);assert.equal(state.hidden,0);apply(0,255);const replacement=state.proxy;assert.notEqual(replacement,proxy);
  let replacementDisposed=0;replacement.addEventListener('dispose',()=>replacementDisposed++);
  mesh.removeFromParent();api.collect(root);assert.equal(replacementDisposed,0);assert.equal(api.prepareCandidates().length,0);
  root.add(mesh);api.collect(root);assert.equal(api.prepareCandidates().length,2);assert.equal(api.states.get(mesh).proxy,replacement);
  mesh.removeFromParent();api.collect(root);mesh.dispose();assert.equal(replacementDisposed,1);assert.equal(disposed,1);cull.dispose();
  mesh.geometry.dispose();(mesh.material as MeshStandardMaterial).dispose();
});


test('incremental source collection touches only changed batches and preserves untouched masks/resources',()=>{
  const root=new Group(),cull=new MapGpuOcclusion({shadowMap:{render:()=>{}}} as unknown as WebGLRenderer),api=cull as any;
  const meshes=Array.from({length:3},(_,i)=>{
    const mesh=new InstancedMesh(new BoxGeometry(),new MeshStandardMaterial(),2);mesh.count=2;
    mesh.userData.mapOcclusionRole=i===0?'structure':'prop';setMapPlacementIds(mesh,allocateMapPlacementIds(2));
    mesh.setMatrixAt(0,new Matrix4().makeTranslation(i*5,0,-10));mesh.setMatrixAt(1,new Matrix4().makeTranslation(i*5+2,0,-10));mesh.instanceMatrix.needsUpdate=true;root.add(mesh);return mesh;
  });
  api.collect(root);const unchanged=api.states.get(meshes[0]),changed=api.states.get(meshes[1]);
  api.apply({items:[{state:changed,slot:0},{state:changed,slot:1}],bytes:new Uint8Array([0,0,0,0,255,0,0,0])});
  const ids=meshes[1].userData.mapPlacementIds;setMapPlacementIds(meshes[1],[ids[1],ids[0]]);
  meshes[1].setMatrixAt(0,new Matrix4().makeTranslation(7,0,-10));meshes[1].setMatrixAt(1,new Matrix4().makeTranslation(5,0,-10));meshes[1].instanceMatrix.needsUpdate=true;
  cull.workProfile.setEnabled(true);api.collect(root,[meshes[1]]);let work=cull.workProfile.drain();
  assert.equal(work.sources_seen_count,1);assert.equal(work.incremental_collects_count,1);assert.equal(api.states.get(meshes[0]),unchanged);
  assert.equal(api.states.get(meshes[1]).visibleSlots.has(1),false);
  meshes[1].visible=false;api.collect(root,[meshes[1]]);assert.equal(api.states.has(meshes[1]),false);assert.equal(api.states.size,2);
  meshes[1].visible=true;api.collect(root,[meshes[1]]);assert.equal(api.states.get(meshes[1]).hidden,1);assert.equal(api.states.size,3);
  cull.dispose();for(const mesh of meshes){mesh.dispose();mesh.geometry.dispose();(mesh.material as MeshStandardMaterial).dispose();}
});

test('prepare accepts contiguous deltas but uses full collection after missing changes or bypass',()=>{
  const root=new Group(),mesh=new InstancedMesh(new BoxGeometry(),new MeshStandardMaterial(),1);root.add(mesh);
  const cull=new MapGpuOcclusion({shadowMap:{render:()=>{}},getContext:()=>({isContextLost:()=>false})} as unknown as WebGLRenderer),api=cull as any,camera=new PerspectiveCamera();
  cull.freeze=true;api.submissions=1;cull.workProfile.setEnabled(true);
  cull.prepare(camera,root,false,0,{fromRevision:0,revision:0,full:true,meshes:[]});assert.equal(cull.workProfile.drain().full_collects_count,1);
  mesh.instanceMatrix.needsUpdate=true;cull.prepare(camera,root,false,1,{fromRevision:0,revision:1,full:false,meshes:[mesh]});
  let work=cull.workProfile.drain();assert.equal(work.incremental_collects_count,1);assert.equal(work.full_collects_count,undefined);
  cull.prepare(camera,root,false,3,{fromRevision:2,revision:3,full:false,meshes:[]});assert.equal(cull.workProfile.drain().full_collects_count,1);
  cull.prepare(camera,root,true,4,{fromRevision:3,revision:4,full:false,meshes:[]});
  cull.prepare(camera,root,false,5,{fromRevision:4,revision:5,full:false,meshes:[]});assert.equal(cull.workProfile.drain().full_collects_count,1);
  cull.dispose();mesh.dispose();mesh.geometry.dispose();(mesh.material as MeshStandardMaterial).dispose();
});
