import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Bone,BufferAttribute,Group,PerspectiveCamera,InstancedMesh,Matrix4,Mesh,MeshStandardMaterial,Skeleton,SkinnedMesh,SphereGeometry,Vector3,type BufferGeometry} from 'three';
import {LOD_LEVELS,LOD_MAX_ERROR,LOD_NEAR,LOD_RATIOS,lodLevel,lodReach,lodScale} from '../src/render/lod-distance';
import {simplifyLevels,type LodSection} from '../src/render/lod-simplify';
import {runLodJob,type LodJobRequest} from '../src/render/lod-job';
import {LodLibrary,fullGeometry} from '../src/render/lod-library';
import {ObjectLod} from '../src/render/object-lod';
import {MAP_LOD_MAX_RADIUS,MAP_LOD_MIN_TRIANGLES,MapObjectStream} from '../src/render/map-object-stream';

const section=(geometry:BufferGeometry):LodSection=>({index:new Uint32Array(geometry.index!.array),
  attributes:Object.fromEntries(Object.entries(geometry.attributes).map(([n,a])=>[n,{array:new Float32Array(a.array as ArrayLike<number>),itemSize:a.itemSize}]))});

class FakeWorker {
  static all:FakeWorker[]=[];
  onmessage?:(event:{data:unknown})=>void;onerror?:()=>void;requests:LodJobRequest[]=[];terminated=false;
  constructor(){FakeWorker.all.push(this);}
  postMessage(message:LodJobRequest){this.requests.push(message);}
  terminate(){this.terminated=true;}
  static async finish(){for(const worker of FakeWorker.all)for(let r;(r=worker.requests.shift());)worker.onmessage?.({data:(await runLodJob(r)).response});}
}
async function withWorkers(run:()=>Promise<void>){
  const previous=globalThis.Worker;(globalThis as {Worker:unknown}).Worker=FakeWorker;FakeWorker.all=[];
  try{await run();}finally{(globalThis as {Worker:unknown}).Worker=previous;}
}

test('distance scale: full detail to 40 m, coarsest at the view distance, geometric steps',()=>{
  assert.equal(lodLevel(10,300),0);assert.equal(lodLevel(LOD_NEAR,300),0);
  assert.equal(lodLevel(300,300),LOD_LEVELS);assert.equal(lodLevel(900,300),LOD_LEVELS);
  assert.equal(LOD_RATIOS[LOD_LEVELS-1],.2);
  // Each level starts a constant factor further out: short steps near the camera, wide ones near the edge.
  const edge=(level:number)=>{let d=LOD_NEAR;while(lodLevel(d,300)<level)d+=.25;return d;};
  assert.ok(edge(2)-edge(1)<edge(8)-edge(7));
  assert.ok(Math.abs(edge(1)-51.5)<1,`90% from ${edge(1)} m`);
  assert.ok(Math.abs(edge(5)-141)<1,`50% from ${edge(5)} m`);
  for(let d=0;d<400;d+=5)assert.ok(lodScale(d+5,300)>=lodScale(d,300));
});

test('level switches hold within a small distance band',()=>{
  const level=lodLevel(200,300);
  assert.equal(lodLevel(203,300,level),level);assert.equal(lodLevel(197,300,level),level);
  assert.notEqual(lodLevel(260,300,level),level);
});

test('a level chain shrinks monotonically to the coarsest budget and reuses levels capped by error',async()=>{
  const sphere=new SphereGeometry(1,48,32),source=section(sphere),total=source.index.length/3;
  const levels=await simplifyLevels([source],LOD_RATIOS,{mode:'quality',maxError:.02});
  assert.equal(levels.length,LOD_LEVELS);
  for(let k=1;k<levels.length;k++)assert.ok(levels[k].triangles<=levels[k-1].triangles);
  assert.ok(Math.abs(Math.log(levels.at(-1)!.triangles/(total*.2)))<.2,`${levels.at(-1)!.triangles} of ${total}`);
  const capped=await simplifyLevels([source],LOD_RATIOS,{mode:'quality',maxError:1e-4});
  assert.ok(capped.at(-1)!.triangles>total*.5,'a tight error ceiling keeps detail instead of meeting the ratio');
  assert.ok(capped.some((level,k)=>k>0&&level===capped[k-1]),'levels without a real saving are shared');
  sphere.dispose();
});

test('far levels widen the error ceiling so low-poly models still reach the coarsest budget',async()=>{
  const trunk=new SphereGeometry(.3,6,9).scale(1,12,1),total=trunk.index!.count/3;
  const tight=await simplifyLevels([section(trunk)],LOD_RATIOS,{mode:'quality',maxError:.02});
  const graded=await simplifyLevels([section(trunk)],LOD_RATIOS,{mode:'quality',maxError:[...LOD_MAX_ERROR]});
  assert.ok(tight.at(-1)!.triangles>total*.4,'a 2% ceiling stalls a ~100 triangle model');
  assert.ok(graded.at(-1)!.triangles<=total*.25,`coarsest level keeps ${graded.at(-1)!.triangles}/${total}`);
  for(let k=0;k<3;k++)assert.equal(graded[k].triangles,tight[k].triangles,'near levels keep the tight ceiling');
  for(let k=1;k<graded.length;k++)assert.ok(graded[k].triangles<=graded[k-1].triangles);
});

test('vehicle LOD swaps whole-object views that share live vertex buffers, including dented copies',async()=>withWorkers(async()=>{
  const library=new LodLibrary(),lod=new ObjectLod(library),geometry=new SphereGeometry(1,32,24);
  const root=new Group(),mesh=new Mesh<BufferGeometry>(geometry,new MeshStandardMaterial());mesh.name='body';root.add(mesh);
  const layer=new Mesh(geometry.clone(),new MeshStandardMaterial({transparent:true}));layer.name='body / layer2';root.add(layer);
  lod.track(root);
  assert.equal(FakeWorker.all.flatMap(w=>w.requests).length,1);
  assert.equal(FakeWorker.all.flatMap(w=>w.requests)[0].sections.length,1,'the layer pass reuses its base topology');
  await FakeWorker.finish();
  root.position.set(250,0,0);root.updateMatrixWorld();
  lod.update(new Vector3(),300);
  assert.notEqual(mesh.geometry,geometry);assert.equal(fullGeometry(mesh),geometry);
  assert.ok(mesh.geometry.index!.count<geometry.index!.count);
  assert.equal(mesh.geometry.getAttribute('position'),geometry.getAttribute('position'));
  assert.deepEqual(layer.geometry.index!.array,mesh.geometry.index!.array,'layer and base stay coplanar');
  // A damage view clones the full geometry and installs it; the same level follows on the dented copy.
  const dented=fullGeometry(mesh).clone();mesh.geometry=dented;
  lod.update(new Vector3(),300);
  assert.equal(fullGeometry(mesh),dented);assert.equal(mesh.geometry.getAttribute('position'),dented.getAttribute('position'));
  assert.ok(mesh.geometry.index!.count<dented.index!.count);
  lod.update(new Vector3(240,0,0),300);assert.equal(mesh.geometry,dented,'full detail near the camera');
  // Deforming panels park the group at the identity and write world-space vertices: distance follows the skin.
  root.position.set(0,0,0);root.updateMatrixWorld();dented.translate(250,0,0);
  lod.update(new Vector3(250,0,0),300);assert.equal(mesh.geometry,dented,'the skin is next to the camera');
  lod.update(new Vector3(),300);assert.notEqual(mesh.geometry,dented,'the skin is 250 m away, not at the group origin');
  lod.update(new Vector3(),300);lod.untrack(root);assert.equal(mesh.geometry,dented);assert.equal(layer.geometry,fullGeometry(layer));
  library.dispose();
}));

test('map placements draw through one instanced batch per distinct generated level',async()=>withWorkers(async()=>{
  const parent=new Group(),stream=new MapObjectStream(parent,300),geometry=new SphereGeometry(1,48,32);
  stream.setAutoLod(true);
  stream.add([250,20].map(x=>({position:new Vector3(x,0,0),matrix:new Matrix4().makeTranslation(x,0,0)})),async()=>[new Mesh(geometry,new MeshStandardMaterial())]);
  stream.update(new Vector3());await Promise.resolve();stream.update(new Vector3());
  const source=parent.children[0] as InstancedMesh;
  assert.equal(source.count,2,'original detail until levels are ready');
  await FakeWorker.finish();stream.update(new Vector3());
  const generated=parent.children.filter(m=>m.name.includes('generated LOD')) as InstancedMesh[];
  assert.equal(generated.length,1);assert.equal(generated[0].count,1);assert.equal(source.count,1);
  assert.ok(generated[0].geometry.index!.count<geometry.index!.count);
  stream.update(new Vector3(240,0,0));assert.equal(generated[0].count,0);assert.equal(source.count,1,'the far placement is near now, the near one beyond view');
  stream.setAutoLod(false);stream.update(new Vector3());assert.equal(generated[0].count,0);assert.equal(source.count,2);
  stream.dispose();assert.equal(parent.children.length,0);
}));

test('skinned characters join only when asked and measure distance at their root bone',async()=>withWorkers(async()=>{
  const library=new LodLibrary(),lod=new ObjectLod(library),geometry=new SphereGeometry(1,32,24),count=geometry.getAttribute('position').count;
  geometry.setAttribute('skinIndex',new BufferAttribute(new Uint16Array(count*4),4));
  geometry.setAttribute('skinWeight',new BufferAttribute(new Float32Array(count*4).map((_,i)=>i%4?0:1),4));
  const bone=new Bone(),mesh=new SkinnedMesh(geometry,new MeshStandardMaterial()),mount=new Group();
  mount.add(bone,mesh);mesh.bind(new Skeleton([bone]));
  lod.track(mount);assert.equal(lod.size,0,'skinned meshes stay out by default');
  lod.track(mount,1,{skinned:true});assert.equal(lod.size,1);
  await FakeWorker.finish();
  // A ragdoll moves bones, not the mount: the body is 250 m out although the mount never left the origin.
  bone.position.set(250,0,0);mount.updateMatrixWorld(true);
  lod.update(new Vector3(),300);assert.notEqual(mesh.geometry,geometry);
  assert.equal(mesh.geometry.getAttribute('skinWeight'),geometry.getAttribute('skinWeight'),'skin data stays shared');
  lod.update(new Vector3(245,0,0),300);assert.equal(mesh.geometry,geometry);
  lod.untrack(mount);library.dispose();
}));

test('shadow-only caster copies draw a generated level',async()=>withWorkers(async()=>{
  const parent=new Group(),stream=new MapObjectStream(parent,300),geometry=new SphereGeometry(1,48,32);
  stream.setAutoLod(true);stream.setShadowRange(100);
  // Behind the camera (which looks down -z): culled from colour, kept as a shadow caster.
  const camera=new PerspectiveCamera(60,1,.1,500);camera.updateMatrixWorld();
  stream.add([{position:new Vector3(0,0,20),matrix:new Matrix4().makeTranslation(0,0,20)}],async()=>{const mesh=new Mesh(geometry,new MeshStandardMaterial());mesh.castShadow=true;return [mesh];});
  stream.update(new Vector3(),camera);await Promise.resolve();stream.update(new Vector3(),camera);
  await FakeWorker.finish();stream.update(new Vector3(),camera);
  const proxy=parent.children.find(m=>m.name.includes('auxiliary casters')) as InstancedMesh|undefined;
  assert.ok(proxy,'an off-screen caster gets a shadow copy');assert.equal(proxy.count,1);
  assert.notEqual(proxy.geometry,geometry);assert.equal(fullGeometry(proxy),geometry);
  assert.ok(proxy.geometry.index!.count<geometry.index!.count);
  stream.dispose();
}));

test('cutout cards keep their original geometry while opaque parts of the same model get levels',async()=>withWorkers(async()=>{
  const parent=new Group(),stream=new MapObjectStream(parent,300),trunk=new SphereGeometry(1,48,32),leaves=new SphereGeometry(2,24,18);
  stream.setAutoLod(true);
  stream.add([{position:new Vector3(250,0,0),matrix:new Matrix4().makeTranslation(250,0,0)}],async()=>[
    new Mesh(trunk,new MeshStandardMaterial()),new Mesh(leaves,new MeshStandardMaterial({alphaTest:.2}))]);
  stream.update(new Vector3());await Promise.resolve();stream.update(new Vector3());
  const requests=FakeWorker.all.flatMap(w=>w.requests);
  assert.equal(requests.length,1);assert.equal(requests[0].sections.length,1,'only the trunk is simplified');
  await FakeWorker.finish();stream.update(new Vector3());
  const generated=parent.children.filter(m=>m.name.includes('generated LOD')) as InstancedMesh[];
  assert.equal(generated.length,1);assert.ok(generated[0].geometry.index!.count<trunk.index!.count);
  stream.dispose();
}));

test('hidden roots keep their level until they are drawn again',async()=>withWorkers(async()=>{
  const library=new LodLibrary(),lod=new ObjectLod(library),geometry=new SphereGeometry(1,32,24);
  const root=new Group(),mesh=new Mesh<BufferGeometry>(geometry,new MeshStandardMaterial());root.add(mesh);
  lod.track(root);await FakeWorker.finish();
  root.position.set(250,0,0);root.updateMatrixWorld();root.visible=false;
  lod.update(new Vector3(),300);assert.equal(mesh.geometry,geometry,'a parked car is not measured');
  root.visible=true;lod.update(new Vector3(),300);assert.notEqual(mesh.geometry,geometry);
  lod.untrack(root);library.dispose();
}));

test('LOD strength brings the coarsest level closer without entering the full-detail zone',async()=>withWorkers(async()=>{
  assert.equal(lodReach(500,1),500);assert.equal(lodReach(500,5),100);assert.equal(lodReach(200,99),LOD_NEAR+20);assert.equal(lodReach(300,.1),300);
  assert.equal(lodLevel(100,lodReach(500,5)),LOD_LEVELS);assert.equal(lodLevel(LOD_NEAR,lodReach(500,6)),0);
  const parent=new Group(),stream=new MapObjectStream(parent,500),geometry=new SphereGeometry(1,48,32);
  stream.setAutoLod(true);
  stream.add([{position:new Vector3(80,0,0),matrix:new Matrix4().makeTranslation(80,0,0)}],async()=>[new Mesh(geometry,new MeshStandardMaterial())]);
  stream.update(new Vector3());await Promise.resolve();stream.update(new Vector3());await FakeWorker.finish();stream.update(new Vector3());
  const generated=()=>parent.children.find(m=>m.name.includes('generated LOD')) as InstancedMesh|undefined;
  const before=generated()!.geometry.index!.count;
  stream.setLodStrength(5);stream.update(new Vector3());
  const strong=parent.children.filter(m=>m.name.includes('generated LOD')&&(m as InstancedMesh).count>0) as InstancedMesh[];
  assert.equal(strong.length,1);assert.ok(strong[0].geometry.index!.count<before,'80 m is now near the coarsest level');
  stream.dispose();
}));

test('small map parts never get level batches; copies of one level share a GPU index buffer',async()=>withWorkers(async()=>{
  const parent=new Group(),stream=new MapObjectStream(parent,300),small=new SphereGeometry(1,12,8);
  assert.ok(small.index!.count/3<MAP_LOD_MIN_TRIANGLES);
  stream.setAutoLod(true);
  stream.add([{position:new Vector3(250,0,0),matrix:new Matrix4().makeTranslation(250,0,0)}],async()=>[new Mesh(small,new MeshStandardMaterial())]);
  stream.update(new Vector3());await Promise.resolve();stream.update(new Vector3());
  assert.equal(FakeWorker.all.flatMap(w=>w.requests).length,0,'no job for a 100-triangle prop');
  stream.dispose();
  const library=new LodLibrary(),geometry=new SphereGeometry(1,32,24);
  library.request([geometry]);await FakeWorker.finish();
  const a=library.view(geometry,geometry,6),b=library.view(geometry.clone(),geometry,6);
  assert.notEqual(a,b);assert.equal(a.index,b.index);
  library.dispose();
}));

test('baked blocks larger than the full-detail radius keep their geometry',async()=>withWorkers(async()=>{
  const parent=new Group(),stream=new MapObjectStream(parent,300),block=new SphereGeometry(MAP_LOD_MAX_RADIUS*4,64,48);
  stream.setAutoLod(true);
  stream.add([{position:new Vector3(250,0,0),matrix:new Matrix4().makeTranslation(250,0,0)}],async()=>[new Mesh(block,new MeshStandardMaterial())]);
  stream.update(new Vector3());await Promise.resolve();stream.update(new Vector3());
  assert.equal(FakeWorker.all.flatMap(w=>w.requests).length,0,'a city block is not simplified by its origin distance');
  stream.dispose();
}));
