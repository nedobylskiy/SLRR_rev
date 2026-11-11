import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry,BufferAttribute,Color,Frustum,Group,InstancedMesh,Matrix4,Mesh,MeshBasicMaterial,MeshStandardMaterial,PerspectiveCamera,Texture,Vector3} from 'three';
import {GlobalFacadeBatches} from '../src/render/global-facade-batches';
import {MapObjectStream} from '../src/render/map-object-stream';
const placement=(x:number,color?:number)=>({position:new Vector3(x,0,-20),matrix:new Matrix4().makeTranslation(x,0,-20),paintColor:color});
function source(texture:Texture){
  const geometry=new BoxGeometry();geometry.clearGroups();geometry.setAttribute('slrrBuildingPaintTint',new BufferAttribute(new Float32Array(24*3).fill(.2),3));
  const material=new MeshStandardMaterial();material.userData.slrrUnifiedBuilding=true;material.userData.slrrBuildingTexture=texture;
  const mesh=new InstancedMesh(geometry,material,2);mesh.name='facade';mesh.userData.staticMapCaster=true;return mesh;
}

test('global facades combine different models and bake all instance poses and palette colors once',()=>{
  const parent=new Group(),texture=new Texture(),a=source(texture),b=source(texture);parent.add(a,b);
  const original=Array.from(a.geometry.getAttribute('position').array),batch=new GlobalFacadeBatches(parent,[{mesh:a,placements:[placement(0,0xff0000),placement(10,0x00ff00)]},{mesh:b,placements:[placement(20)]}]);
  assert.equal(batch.meshes.length,1);assert.equal(batch.sourceCopies,3);assert.equal(batch.sources.size,2);assert.equal(batch.triangles,36);
  assert.deepEqual(batch.meshes[0].userData.facadeContributions,[{name:'facade',copies:2,triangles:24},{name:'facade',copies:1,triangles:12}]);
  const mesh=batch.meshes[0],paint=mesh.geometry.getAttribute('slrrBuildingPaintTint');assert.equal(paint.getX(0),1);assert.equal(paint.getY(24),1);assert.ok(Math.abs(paint.getX(48)-.2)<1e-6);
  assert.equal(mesh.geometry.boundingBox!.max.x,20.5);assert.equal(mesh.geometry.boundingBox!.min.z,-20.5);
  assert.deepEqual(Array.from(a.geometry.getAttribute('position').array),original);assert.equal(a.parent,null);assert.ok(a.userData.globalFacadeSource);
  const vertices=Array.from(mesh.geometry.getAttribute('position').array),version=mesh.instanceMatrix.version;
  batch.update();batch.update();assert.equal(parent.children.length,1);assert.equal(mesh.count,1);assert.equal(mesh.instanceColor,null);assert.equal(mesh.instanceMatrix.version,version);
  assert.deepEqual(Array.from(mesh.geometry.getAttribute('position').array),vertices);
  let materialDisposed=0,sourceDisposed=0;a.material.addEventListener('dispose',()=>materialDisposed++);a.geometry.addEventListener('dispose',()=>sourceDisposed++);
  batch.dispose();assert.equal(parent.children.length,0);assert.equal(materialDisposed,0);assert.equal(sourceDisposed,0);assert.equal(a.userData.globalFacadeSource,undefined);
});

test('material arrays stay separate and size budgets keep whole source models as fallbacks',()=>{
  const parent=new Group(),a=source(new Texture()),b=source(new Texture());
  const batch=new GlobalFacadeBatches(parent,[{mesh:a,placements:[placement(0),placement(10)]},{mesh:b,placements:[placement(20)]}],24,100);
  assert.equal(batch.meshes.length,3);assert.ok(batch.meshes.every(m=>m.userData.facadeContributions.reduce((sum:number,c:{triangles:number})=>sum+c.triangles,0)===12),'per-batch provenance resets when the vertex limit splits a source');assert.ok(batch.meshes.every(m=>m.geometry.getAttribute('position').count<=24));batch.dispose();
  const limited=new GlobalFacadeBatches(parent,[{mesh:a,placements:[placement(0),placement(10)]}],24,24);
  assert.equal(limited.meshes.length,0);assert.equal(limited.skippedSources,1);assert.equal(a.userData.globalFacadeSource,undefined);limited.dispose();
});

test('global batch frustum checks preserve off-screen shadow casters without changing geometry',()=>{
  const parent=new Group(),a=source(new Texture()),batch=new GlobalFacadeBatches(parent,[{mesh:a,placements:[placement(100)]}]);
  const camera=new PerspectiveCamera(60,1,.1,500);camera.updateMatrixWorld();const frustum=new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  batch.update(frustum,new Vector3(100,0,0),30);assert.equal(batch.meshes[0].visible,true);assert.equal(batch.meshes[0].userData.streamAuxiliary,true);assert.equal(batch.visibleBatches,0);
  batch.update(frustum);assert.equal(batch.meshes[0].parent,null);batch.update();assert.equal(batch.visibleBatches,1);batch.dispose();
});

test('stream global mode removes compiled source submissions while retaining uncombined surfaces',async()=>{
  const parent=new Group(),stream=new MapObjectStream(parent,100),a=source(new Texture());
  const glass=new Mesh(new BoxGeometry(),new MeshBasicMaterial({transparent:true}));glass.name='glass';
  stream.add([placement(0),placement(10)],async()=>[new Mesh(a.geometry,a.material),glass],false,true);
  await stream.preparePinnedModels();stream.compileGlobalFacades();stream.update(new Vector3());
  const global=parent.children.filter(m=>m.userData.globalFacadeBatch);assert.equal(global.length,1);assert.equal((global[0] as InstancedMesh).count,1);
  assert.ok(parent.children.some(m=>m.name==='glass'&&m.visible));assert.equal(parent.children.some(m=>m.userData.globalFacadeSource),false);
  const version=(global[0] as InstancedMesh).instanceMatrix.version;stream.update(new Vector3(2,0,0));assert.equal((global[0] as InstancedMesh).instanceMatrix.version,version);
  stream.dispose();assert.equal(parent.children.length,0);
});

test('fully compiled facade types stay detached when legacy merge/cutoff switches change',async()=>{
  const parent=new Group(),stream=new MapObjectStream(parent,100),a=source(new Texture());
  stream.add([placement(0),placement(10)],async()=>[new Mesh(a.geometry,a.material)],false,true);
  await stream.preparePinnedModels();stream.compileGlobalFacades();stream.update(new Vector3());
  stream.setStaticBatching(true);stream.setGeometryCutoff(true);stream.update(new Vector3());stream.update(new Vector3());
  assert.ok(parent.children.every(m=>m.userData.globalFacadeBatch));assert.equal(parent.children.length,1);
  stream.setStaticBatching(false);stream.setGeometryCutoff(false);stream.update(new Vector3());assert.equal(parent.children.length,1);stream.dispose();
});


test('global facade change notifications include primary-to-shadow-only switches without visibility changes',()=>{
  const parent=new Group(),a=source(new Texture()),batch=new GlobalFacadeBatches(parent,[{mesh:a,placements:[placement(100)]}]);
  const changes:InstancedMesh[]=[],changed=(mesh:InstancedMesh)=>changes.push(mesh);
  batch.update(undefined,undefined,0,changed);assert.equal(changes.length,1);changes.length=0;
  const camera=new PerspectiveCamera(60,1,.1,500);camera.updateMatrixWorld();const frustum=new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  assert.equal(batch.update(frustum,new Vector3(100,0,0),30,changed),true);assert.equal(changes.length,1);assert.equal(changes[0].visible,true);assert.equal(changes[0].userData.streamAuxiliary,true);
  changes.length=0;batch.update(frustum,new Vector3(100,0,0),30,changed);assert.equal(changes.length,0);
  batch.dispose();
});
