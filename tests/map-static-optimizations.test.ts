import test from 'node:test';
import assert from 'node:assert/strict';
import {BufferAttribute,BoxGeometry,Group,InstancedMesh,Matrix4,Mesh,MeshStandardMaterial,PerspectiveCamera,PlaneGeometry,SphereGeometry,Vector3} from 'three';
import {mergeStaticMapParts} from '../src/render/map-static-batches';
import {MapObjectStream} from '../src/render/map-object-stream';

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
