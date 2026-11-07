import test from 'node:test';
import assert from 'node:assert/strict';
import {BufferAttribute,BoxGeometry,Group,InstancedMesh,Matrix4,Mesh,MeshStandardMaterial,PerspectiveCamera,PlaneGeometry,SphereGeometry,Vector3} from 'three';
import {mergeStaticMapParts} from '../src/render/map-static-batches';
import {generateMapLod,type LodGeometryData} from '../src/render/map-lod-generator';
import {MapAutoLod} from '../src/render/map-auto-lod';
import {MapObjectStream} from '../src/render/map-object-stream';
import {acceptableLodShape,closedLodSurface} from '../src/render/map-lod-quality';

function parts(){
  const material=new MeshStandardMaterial();
  return [0,1].map(x=>{const g=new BoxGeometry().translate(x,0,0);
    g.setAttribute('slrrBakedUv',g.getAttribute('uv').clone());
    const mesh=new Mesh(g,material);mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.staticMapCaster=true;return mesh;});
}
test('static batches preserve triangles, authored UV attributes, bounds, materials and caster flags',()=>{
  const source=parts(),merged=mergeStaticMapParts(source);
  assert.equal(merged.length,1);assert.equal(merged[0].geometry.index!.count,72);
  assert.equal(merged[0].geometry.getAttribute('slrrBakedUv').count,48);
  assert.equal(merged[0].material,source[0].material);assert.equal(merged[0].userData.staticMapCaster,true);
  assert.equal(merged[0].castShadow,true);assert.equal(merged[0].receiveShadow,true);
  assert.equal(merged[0].geometry.boundingBox!.min.x,-.5);assert.equal(merged[0].geometry.boundingBox!.max.x,1.5);
  assert.equal(source[0].geometry.index!.count,36,'source remains unchanged for A/B restoration');
});
test('static batches keep spatially distant, transparent and different-material surfaces separate',()=>{
  const source=parts();source[1].geometry.translate(300,0,0);
  assert.equal(mergeStaticMapParts(source).length,2);
  source[1].geometry.translate(-300,0,0);source[1].material=new MeshStandardMaterial({transparent:true});
  assert.equal(mergeStaticMapParts(source).length,2);
  source[1].material=new MeshStandardMaterial();assert.equal(mergeStaticMapParts(source).length,2);
});
test('stream toggles merged representation and auxiliary casters without disposing shared material',async()=>{
  const source=parts(),parent=new Group(),stream=new MapObjectStream(parent,100);
  let disposed=0;(source[0].material as MeshStandardMaterial).addEventListener('dispose',()=>disposed++);
  stream.setStaticBatching(true);stream.setShadowRange(100);
  stream.add([-20,20].map(z=>({position:new Vector3(0,0,z),matrix:new Matrix4().makeTranslation(0,0,z)})),async()=>source);
  const camera=new PerspectiveCamera(60,1,.1,200);camera.lookAt(0,0,-1);
  stream.update(new Vector3(),camera);await Promise.resolve();stream.update(new Vector3(),camera);
  assert.equal(parent.children.length,2,'one main batch and one shadow reserve');
  assert.equal(parent.children.filter(m=>m.userData.streamAuxiliary).length,1);
  assert.ok(parent.children.every(m=>(m as InstancedMesh).count===1));
  stream.setStaticBatching(false);stream.update(new Vector3(),camera);
  assert.equal(parent.children.length,4);assert.equal(disposed,0);
  stream.setStaticBatching(true);stream.update(new Vector3(),camera);assert.equal(parent.children.length,2);
  stream.dispose();assert.equal(parent.children.length,0);assert.equal(disposed,1);
});

function sphereData():LodGeometryData {
  const geometry=new SphereGeometry(1,24,18);
  return {attributes:Object.fromEntries(Object.entries(geometry.attributes).map(([name,a])=>[name,{array:new Float32Array(a.array),itemSize:a.itemSize}])),
    index:new Uint32Array(geometry.index!.array)};
}
test('generated LOD reduces geometry while retaining supported attributes and source data',()=>{
  const data=sphereData();data.attributes.slrrColor={array:new Float32Array(data.attributes.position.array.length).fill(.5),itemSize:3};
  const original=new Float32Array(data.attributes.position.array),result=generateMapLod(data)!;
  assert.ok(result);assert.ok((result.index?.length??result.attributes.position.array.length/3)<data.index!.length*.8);
  assert.deepEqual(Object.keys(result.attributes).sort(),Object.keys(data.attributes).sort());
  assert.deepEqual(data.attributes.position.array,original);
  for(const a of Object.values(result.attributes))assert.ok(a.array.every(Number.isFinite));
});
test('generated LOD rejects additional UV channels rather than deleting authored lighting',()=>{
  const data=sphereData();data.attributes.slrrBakedUv={array:new Float32Array(data.attributes.uv.array),itemSize:2};
  assert.equal(generateMapLod(data),undefined);
});

test('open facades and panels are retained rather than collapsed into broken outlines',()=>{
  const geometry=new PlaneGeometry(20,10,24,24);
  const data:LodGeometryData={attributes:Object.fromEntries(Object.entries(geometry.attributes).map(([name,a])=>[name,{array:new Float32Array(a.array),itemSize:a.itemSize}])),index:new Uint32Array(geometry.index!.array)};
  assert.equal(closedLodSurface(geometry),false);assert.equal(generateMapLod(data),undefined);
  assert.equal(acceptableLodShape(new SphereGeometry(1,24,18),new SphereGeometry(.5,24,18)),false);
  assert.equal(acceptableLodShape(new SphereGeometry(1,24,18),geometry),false);
});

class FakeWorker {
  static last:FakeWorker;
  onmessage?: (event:any)=>void;onerror?:()=>void;requests:any[]=[];terminated=false;
  constructor(){FakeWorker.last=this;}
  postMessage(message:any){this.requests.push(message);}
  terminate(){this.terminated=true;}
  finish(){const request=this.requests.shift();this.onmessage?.({data:{id:request.id,data:generateMapLod(request.data)}});}
}
test('LOD worker keeps source available and selects near/far instances with hysteresis',async()=>{
  const previous=globalThis.Worker;(globalThis as any).Worker=FakeWorker;
  try {
    const parent=new Group(),stream=new MapObjectStream(parent,500),geometry=new SphereGeometry(1,24,18);
    stream.setAutoLod(true);
    stream.add([{position:new Vector3(220,0,0),matrix:new Matrix4().makeTranslation(220,0,0)}],async()=>[new Mesh(geometry,new MeshStandardMaterial())]);
    stream.update(new Vector3());await Promise.resolve();stream.update(new Vector3());
    assert.equal((parent.children[0] as InstancedMesh).count,1);
    FakeWorker.last.finish();stream.update(new Vector3());
    const lod=parent.children.find(m=>m.name.includes('generated LOD')) as InstancedMesh;
    assert.ok(lod);assert.equal(lod.count,1);assert.equal((parent.children[0] as InstancedMesh).count,0);
    stream.update(new Vector3(40,0,0));assert.equal(lod.count,1,'180 m retains far state');
    stream.update(new Vector3(70,0,0));assert.equal(lod.count,0,'150 m restores source');
    stream.update(new Vector3(40,0,0));assert.equal(lod.count,0,'180 m retains near state');
    stream.update(new Vector3());assert.equal(lod.count,1);
    stream.setAutoLod(false);stream.update(new Vector3());assert.equal(lod.count,0);
    stream.dispose();assert.equal(parent.children.length,0);assert.ok(FakeWorker.last.terminated);
  } finally {(globalThis as any).Worker=previous;}
});
test('late LOD worker results cannot resurrect an evicted source',()=>{
  const previous=globalThis.Worker;(globalThis as any).Worker=FakeWorker;
  try {
    let changes=0;const cache=new MapAutoLod(()=>changes++),geometry=new SphereGeometry(1,16,12);
    cache.get(geometry);geometry.dispose();FakeWorker.last.finish();
    assert.equal(changes,1,'completion releases queue pressure even when source was evicted');cache.dispose();
  } finally {(globalThis as any).Worker=previous;}
});
