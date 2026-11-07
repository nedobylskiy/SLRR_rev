import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry,Group,InstancedMesh,Matrix4,Mesh,MeshBasicMaterial,PerspectiveCamera,Vector3} from 'three';
import {MapObjectStream} from '../src/render/map-object-stream';

const placement=(x:number,z=-20,paintColor?:number)=>({position:new Vector3(x,0,z),matrix:new Matrix4().makeTranslation(x,0,z),paintColor});
const part=(name:string)=>{const mesh=new Mesh(new BoxGeometry(2,2,2),new MeshBasicMaterial());mesh.name=name;mesh.userData.staticMapCaster=true;return mesh;};
const cached=(parent:Group)=>parent.children.filter((m):m is InstancedMesh=>m instanceof InstancedMesh&&m.userData.cachedMapCell);

test('precache prepares all categorized placements and camera updates only toggle immutable cell buffers',async()=>{
  const parent=new Group(),stream=new MapObjectStream(parent,40);
  stream.add([placement(0,-20,0xff0000),placement(20),placement(200)],async()=>[part('lamp')],'streetlights');
  await stream.setCachedCells(true,64);
  const batches=cached(parent);assert.equal(batches.length,2);stream.update(new Vector3());
  const versions=batches.map(m=>[m.instanceMatrix.version,m.instanceColor!.version]);
  const matrices=batches.map(m=>Array.from(m.instanceMatrix.array));
  assert.equal(batches.filter(m=>m.visible).length,1);
  assert.equal(stream.total,3);assert.equal(stream.visible,2);
  stream.update(new Vector3(200,0,0));assert.equal(batches.filter(m=>m.visible).length,1);assert.equal(stream.visible,1);
  assert.deepEqual(batches.map(m=>[m.instanceMatrix.version,m.instanceColor!.version]),versions);
  assert.deepEqual(batches.map(m=>Array.from(m.instanceMatrix.array)),matrices);
  assert.equal(batches.reduce((n,m)=>n+m.instanceMatrix.count,0),3,'exact capacity instead of map-wide capacity per cell');
  await stream.setCachedCells(false);stream.update(new Vector3(200,0,0));
  assert.ok(batches.every(m=>!m.visible));assert.ok(parent.children.some(m=>m instanceof InstancedMesh&&!m.userData.cachedMapCell&&m.visible));
  await stream.setCachedCells(true,64);stream.update(new Vector3());assert.ok(cached(parent).every(m=>batches.includes(m)),'reuse cached meshes on re-enable');
  assert.equal(cached(parent).length,1,'off cells leave scene traversal while their buffers stay cached');
  stream.dispose();assert.equal(parent.children.length,0);
});

test('cached cells retain palette, full transformed bounds and off-screen shadow casters',async()=>{
  const parent=new Group(),stream=new MapObjectStream(parent,100),camera=new PerspectiveCamera(60,1,.1,500);camera.updateMatrixWorld();
  const wide=part('tree');wide.geometry.translate(-100,0,0);
  stream.add([placement(100,-20,0x00ff00)],async()=>[wide],'trees');stream.setShadowRange(100);
  await stream.setCachedCells(true,64);stream.update(new Vector3(),camera);
  const mesh=cached(parent)[0];assert.ok(mesh.visible);assert.equal(mesh.userData.streamAuxiliary,false,'bounds overlap view despite distant origin');
  const color=new (await import('three')).Color();mesh.getColorAt(0,color);assert.equal(color.getHex(),0x00ff00);
  const version=mesh.instanceMatrix.version;
  camera.rotation.y=Math.PI;camera.updateMatrixWorld();stream.update(new Vector3(),camera);
  assert.ok(mesh.visible);assert.equal(mesh.userData.streamAuxiliary,true);assert.equal(stream.auxiliaryVisible,1);
  stream.setTreesHidden(true);stream.setInspectResident(true);stream.update(new Vector3(),camera);assert.equal(mesh.visible,false);
  stream.setTreesHidden(false);stream.update(new Vector3(),camera);assert.ok(mesh.visible);assert.equal(mesh.userData.streamAuxiliary,false);
  assert.equal(mesh.instanceMatrix.version,version);stream.dispose();
});

test('cell size rebuilds only the cached representation and ordinary buildings stay on the original stream',async()=>{
  const parent=new Group(),stream=new MapObjectStream(parent,1000);let loads=0,geometryDisposals=0,materialDisposals=0;
  const lamp=part('bin');lamp.geometry.addEventListener('dispose',()=>geometryDisposals++);lamp.material.addEventListener('dispose',()=>materialDisposals++);
  stream.add([placement(-1),placement(1),placement(70)],async()=>{loads++;return [lamp];},'bins');
  stream.add([placement(0)],async()=>[part('building')]);
  await stream.setCachedCells(true,64);assert.equal(cached(parent).length,3);
  stream.update(new Vector3());await Promise.resolve();stream.update(new Vector3());
  assert.ok(parent.children.some(m=>m.name==='building'&&m.visible));
  await stream.setCachedCells(true,128);assert.equal(cached(parent).length,2);stream.update(new Vector3());assert.equal(loads,1);
  assert.equal(geometryDisposals,0);assert.equal(materialDisposals,0);
  assert.ok(parent.children.some(m=>m.name==='building'&&m.visible));
  stream.dispose();assert.equal(geometryDisposals,1);assert.equal(materialDisposals,1);
});

test('disposing during asynchronous cell preparation releases the pending source without adding cached meshes',async()=>{
  const parent=new Group(),stream=new MapObjectStream(parent,100);let finish!:(meshes:Mesh[])=>void,released=0;
  const mesh=part('pending');mesh.geometry.addEventListener('dispose',()=>released++);
  stream.add([placement(0)],()=>new Promise(resolve=>{finish=resolve;}),'bins');
  const ready=stream.setCachedCells(true);stream.dispose();finish([mesh]);await ready;
  assert.equal(parent.children.length,0);assert.equal(released,1);
});
