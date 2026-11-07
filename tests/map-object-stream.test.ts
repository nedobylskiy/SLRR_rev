import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Color, Frustum, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Texture, Vector3 } from 'three';
import { MapObjectStream, isMapTreeAlias } from '../src/render/map-object-stream';

test('repeated tree parts share one instanced batch per geometry/material',async()=>{
  const parent=new Group(),stream=new MapObjectStream(parent,500);
  const trunk=new Mesh(new BoxGeometry(),new MeshBasicMaterial()),leaves=new Mesh(new BoxGeometry(),new MeshBasicMaterial());
  trunk.name='map object tree: trunk';leaves.name='map object tree: leaves';
  const placements=Array.from({length:50},(_,i)=>({position:new Vector3(i,0,-20),matrix:new Matrix4().makeTranslation(i,0,-20)}));
  stream.add(placements,async()=>[trunk,leaves]);
  stream.update(new Vector3());await Promise.resolve();stream.update(new Vector3());stream.update(new Vector3());
  assert.equal(parent.children.length,2);
  for(const mesh of parent.children as InstancedMesh[]) {
    assert.ok(mesh.isInstancedMesh);assert.equal(mesh.count,50);
    assert.ok(mesh.geometry===trunk.geometry||mesh.geometry===leaves.geometry);
    const matrix=new Matrix4();mesh.getMatrixAt(49,matrix);assert.equal(matrix.elements[12],49);
  }
  stream.dispose();
});

test('large static surfaces submit nearby cells and restore the intact mesh when cutoff is disabled',async()=>{
  const parent=new Group(),stream=new MapObjectStream(parent,100),geometry=new PlaneGeometry(512,512,32,32);
  geometry.rotateX(-Math.PI/2);const originalIndices=Array.from(geometry.index!.array),texture=new Texture(),material=new MeshBasicMaterial({map:texture});
  let textureDisposals=0;texture.addEventListener('dispose',()=>textureDisposals++);
  stream.add([{position:new Vector3(),matrix:new Matrix4(),bounds:{minX:-256,maxX:256,minZ:-256,maxZ:256}}],async()=>[new Mesh(geometry,material)]);
  stream.update(new Vector3());await Promise.resolve();stream.update(new Vector3());
  const original=parent.children[0];stream.setGeometryCutoff(true);stream.update(new Vector3());
  const selected=parent.children.filter((m:any)=>m.visible) as InstancedMesh[];
  assert.ok(parent.children.length>selected.length);assert.ok(selected.length>1);
  const triangles=selected.reduce((n,m)=>n+m.geometry.index!.count/3*m.count,0);
  assert.ok(triangles<geometry.index!.count/3,'far cell indices never enter the draw');
  for(const mesh of selected)assert.equal(mesh.material,material);
  assert.deepEqual(Array.from(geometry.index!.array),originalIndices);
  stream.setInspectResident(true);stream.update(new Vector3());assert.ok(parent.children.every((m:any)=>m.visible));
  stream.setInspectResident(false);stream.setGeometryCutoff(false);stream.update(new Vector3());
  assert.equal(parent.children.length,1);assert.equal(parent.children[0],original);assert.ok(original.visible);
  stream.setGeometryCutoff(true);stream.update(new Vector3());assert.ok(parent.children.length>1,'cached cells can upload again');
  assert.equal(textureDisposals,0,'switching representations must retain shared textures');
  stream.dispose();assert.equal(parent.children.length,0);assert.equal(textureDisposals,1);
});

test('chunk instance compaction preserves the selected placement matrix and palette',async()=>{
  const parent=new Group(),stream=new MapObjectStream(parent,100),geometry=new PlaneGeometry(512,512,16,16);
  geometry.rotateX(-Math.PI/2);
  stream.add([0,180].map((x,i)=>({position:new Vector3(x,0,0),matrix:new Matrix4().makeTranslation(x,0,0),
    bounds:{minX:x-256,maxX:x+256,minZ:-256,maxZ:256},paintColor:i?0x0000ff:0xff0000})),async()=>[new Mesh(geometry,new MeshBasicMaterial())]);
  stream.update(new Vector3());await Promise.resolve();stream.update(new Vector3());
  stream.setGeometryCutoff(true);stream.update(new Vector3());
  const chunk=parent.children.find((m:any)=>m.visible&&m.geometry.boundingBox.max.x<=-192&&m.geometry.boundingBox.min.z===0) as InstancedMesh;
  assert.ok(chunk);assert.equal(chunk.count,1);
  const matrix=new Matrix4(),color=new Color();chunk.getMatrixAt(0,matrix);chunk.getColorAt(0,color);
  assert.equal(matrix.elements[12],180);assert.equal(color.getHex(),0x0000ff);stream.dispose();
});

test('resident inspection reveals off-screen instances without loading around the observer',async()=>{
  const parent=new Group(),stream=new MapObjectStream(parent,100),focus=new Vector3();
  const primary=new PerspectiveCamera(60,1,.1,200);primary.lookAt(0,0,-1);
  let nearLoads=0,farLoads=0;
  stream.add([-20,20].map(z=>({position:new Vector3(0,0,z),matrix:new Matrix4().makeTranslation(0,0,z)})),async()=>{
    nearLoads++;return [new Mesh(new BoxGeometry(),new MeshBasicMaterial())];
  });
  stream.add([{position:new Vector3(1000,0,0),matrix:new Matrix4().makeTranslation(1000,0,0)}],async()=>{
    farLoads++;return [new Mesh(new BoxGeometry(),new MeshBasicMaterial())];
  });
  stream.update(focus,primary);await Promise.resolve();stream.update(focus,primary);
  assert.equal(stream.active,2);assert.equal(stream.visible,1);assert.equal(stream.primaryVisible,1);
  stream.setInspectResident(true);stream.update(focus,primary);
  assert.equal(stream.visible,2);assert.equal(stream.primaryVisible,1);assert.equal(stream.active,2);
  assert.equal(nearLoads,1);assert.equal(farLoads,0);
  stream.setInspectResident(false);stream.update(focus,primary);assert.equal(stream.visible,1);
  stream.dispose();
});

for (const cancelled of [false,true]) test(`stream releases shared baked maps once (${cancelled ? 'cancelled load' : 'loaded model'})`, async () => {
  const stream = new MapObjectStream(new Group(),100), texture = new Texture();
  let disposals = 0;
  texture.addEventListener('dispose', () => disposals++);
  stream.add([{position:new Vector3(),matrix:new Matrix4()}],async () => [0,1].map(() => {
    const material = new MeshBasicMaterial();material.userData.bakedLightmapTexture = texture;
    return new Mesh(new BoxGeometry(),material);
  }));
  stream.update(new Vector3());
  if (cancelled) stream.dispose();
  await Promise.resolve();
  if (!cancelled) { stream.update(new Vector3()); stream.dispose(); }
  assert.equal(disposals,1);
});

test('finishing a model load does not rescan distant placements until the focus changes', async () => {
  const parent = new Group(), stream = new MapObjectStream(parent, 100), focus = new Vector3();
  let distantChecks = 0;
  stream.add([{ position: new Vector3(), matrix: new Matrix4() }], async () => [new Mesh(new BoxGeometry(), new MeshBasicMaterial())]);
  stream.add([{ position: new Vector3(1000, 0, 0), matrix: new Matrix4().makeTranslation(1000, 0, 0),
    get radius() { distantChecks++; return 0; } }], async () => [new Mesh(new BoxGeometry(), new MeshBasicMaterial())]);
  stream.update(focus); const initial = distantChecks;
  assert.ok(initial > 0);
  await Promise.resolve(); stream.update(focus);
  assert.equal(stream.visible, 1, 'completed model becomes visible without rebuilding the index query');
  assert.equal(distantChecks, initial, 'a load completion does not revisit unrelated far objects');
  stream.update(new Vector3(1000, 0, 0)); await Promise.resolve(); stream.update(new Vector3(1000, 0, 0));
  assert.ok(distantChecks > initial);
  assert.equal(stream.visible, 1, 'teleport still requests the destination model');
  stream.dispose();
});

test('palette colors share one model and follow instances when the camera compacts the batch', async () => {
  const parent = new Group(), stream = new MapObjectStream(parent, 100), focus = new Vector3();
  const camera = new PerspectiveCamera(60, 1, 0.1, 200); camera.lookAt(0, 0, -1);
  let loads = 0;
  stream.add([-20, 20].map((z, i) => ({ matrix: new Matrix4().makeTranslation(0, 0, z), position: new Vector3(0, 0, z), paintColor: i ? 0x336699 : 0xff0000 })), async () => {
    loads++; return [new Mesh(new BoxGeometry(), new MeshBasicMaterial())];
  });
  stream.update(focus, camera); await Promise.resolve(); stream.update(focus, camera);
  const mesh = parent.children[0] as InstancedMesh, color = new Color();
  assert.equal(parent.children.length, 1); assert.equal(mesh.count, 1);
  mesh.getColorAt(0, color); assert.equal(color.getHex(), 0xff0000);
  camera.lookAt(0, 0, 1); stream.update(focus, camera);
  mesh.getColorAt(0, color); assert.equal(color.getHex(), 0x336699);
  assert.equal(loads, 1); assert.equal(mesh.instanceColor!.count, 2);
  stream.dispose();
});

test('instances of one model are culled independently without unloading and camera rotation reuses the model', async () => {
  const parent = new Group(), stream = new MapObjectStream(parent, 100), focus = new Vector3();
  const camera = new PerspectiveCamera(60, 1, 0.1, 200); camera.lookAt(0, 0, -1);
  let loads = 0;
  stream.add([-20, 20].map(z => ({ matrix: new Matrix4().makeTranslation(0, 0, z), position: new Vector3(0, 0, z) })), async () => {
    loads++; return [new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial())];
  });
  stream.update(focus, camera); await Promise.resolve(); stream.update(focus, camera);
  const mesh = parent.children[0] as InstancedMesh, matrix = new Matrix4();
  assert.equal(stream.active, 2); assert.equal(stream.visible, 1); assert.equal(mesh.count, 1);
  mesh.getMatrixAt(0, matrix); assert.equal(matrix.elements[14], -20);
  const version = mesh.instanceMatrix.version;
  stream.update(focus, camera); assert.equal(mesh.instanceMatrix.version, version, 'stationary view does not reupload matrices');
  camera.lookAt(0, 0, 1); stream.update(focus, camera);
  mesh.getMatrixAt(0, matrix); assert.equal(matrix.elements[14], 20);
  assert.equal(stream.active, 2); assert.equal(loads, 1);
  stream.setRange(10); stream.update(focus, camera);
  assert.equal(stream.active, 2, 'hysteresis keeps models resident');
  assert.equal(stream.visible, 0); assert.equal(mesh.visible, false, 'draw range changes immediately');
  stream.setRange(100); stream.update(focus, camera);
  assert.equal(stream.visible, 1); assert.equal(loads, 1);
  stream.setShadowRange(30); stream.update(focus, camera);
  assert.equal(stream.visible, 1, 'shadow support does not expand the main color list');
  assert.equal(stream.auxiliaryVisible,1,'nearby off-screen instances remain available separately');
  stream.setShadowRange(0); stream.update(focus, camera);
  assert.equal(stream.visible, 1, 'disabling shadows restores normal camera culling');
  assert.equal(stream.auxiliaryVisible,0);
  stream.dispose();
});

test('auxiliary caster batches preserve palettes, swap with the view and release without disposing shared geometry',async()=>{
  const parent=new Group(),stream=new MapObjectStream(parent,100),focus=new Vector3(),camera=new PerspectiveCamera(60,1,.1,200);
  camera.lookAt(0,0,-1);stream.setShadowRange(30);
  const geometry=new BoxGeometry(),material=new MeshBasicMaterial();let disposed=0;geometry.addEventListener('dispose',()=>disposed++);
  stream.add([-20,20,80].map((z,i)=>({position:new Vector3(0,0,z),matrix:new Matrix4().makeTranslation(0,0,z),paintColor:[0xff0000,0x0000ff,0x00ff00][i]})),async()=>{
    const mesh=new Mesh(geometry,material);mesh.castShadow=true;return [mesh];
  });
  stream.update(focus,camera);await Promise.resolve();stream.update(focus,camera);
  const main=parent.children.find(m=>!m.userData.streamAuxiliary) as InstancedMesh;
  const auxiliary=parent.children.find(m=>m.userData.streamAuxiliary) as InstancedMesh;
  assert.equal(main.count,1);assert.equal(auxiliary.count,1);assert.equal(auxiliary.castShadow,true);
  assert.equal(auxiliary.geometry,main.geometry);assert.equal(auxiliary.material,main.material);
  const matrix=new Matrix4(),color=new Color();auxiliary.getMatrixAt(0,matrix);auxiliary.getColorAt(0,color);
  assert.equal(matrix.elements[14],20);assert.equal(color.getHex(),0x0000ff);
  const version=auxiliary.instanceMatrix.version;stream.update(focus,camera);assert.equal(auxiliary.instanceMatrix.version,version);
  camera.lookAt(0,0,1);stream.update(focus,camera);
  assert.equal(main.count,2);assert.equal(auxiliary.count,1);auxiliary.getMatrixAt(0,matrix);assert.equal(matrix.elements[14],-20);
  stream.setInspectResident(true);stream.update(focus,camera);assert.equal(main.count,3);assert.equal(auxiliary.count,0,'inspection does not duplicate casters');
  assert.equal(disposed,0);stream.dispose();assert.equal(disposed,1);assert.equal(parent.children.length,0);
});

test('chunk shadow reserve stays separate and is released when switching representations',async()=>{
  const parent=new Group(),stream=new MapObjectStream(parent,100),focus=new Vector3(),camera=new PerspectiveCamera(60,1,.1,100);
  camera.position.set(0,5,0);camera.lookAt(0,0,-30);
  const geometry=new PlaneGeometry(512,512,16,16);geometry.rotateX(-Math.PI/2);
  stream.add([{position:new Vector3(),matrix:new Matrix4(),bounds:{minX:-256,maxX:256,minZ:-256,maxZ:256}}],async()=>{
    const mesh=new Mesh(geometry,new MeshBasicMaterial());mesh.castShadow=false;mesh.userData.staticMapCaster=true;return [mesh];
  });
  stream.setGeometryCutoff(true);stream.setShadowRange(100);
  stream.update(focus,camera);await Promise.resolve();stream.update(focus,camera);
  const auxiliary=parent.children.filter(m=>m.userData.streamAuxiliary) as InstancedMesh[];
  assert.ok(auxiliary.some(m=>m.count>0));
  for(const extra of auxiliary.filter(m=>m.count>0)){
    assert.equal(extra.castShadow,false);assert.equal(extra.userData.staticMapCaster,true);
    const main=parent.children.find((m:any)=>!m.userData.streamAuxiliary&&m.geometry===extra.geometry) as InstancedMesh;
    assert.ok(main);assert.equal(main.userData.staticMapCaster,true);assert.equal(main.castShadow,false);
    assert.equal(main.count,0,'the same chunk instance cannot enter both passes');
  }
  stream.setGeometryCutoff(false);stream.update(focus,camera);
  assert.equal(parent.children.length,1);assert.ok(auxiliary.every(m=>m.parent===null));
  stream.dispose();assert.equal(parent.children.length,0);
});

test('instance frustum tests include parent transforms and mesh bounds away from their origin', async () => {
  const parent = new Group(); parent.position.x = 100;
  const stream = new MapObjectStream(parent, 100), focus = new Vector3();
  const camera = new PerspectiveCamera(30, 1, 0.1, 200); camera.position.x = 100; camera.lookAt(125, 0, -10);
  stream.add([{ matrix: new Matrix4().makeTranslation(0, 0, -10), position: new Vector3(0, 0, -10) }], async () => {
    const geometry = new BoxGeometry(2, 2, 2); geometry.translate(25, 0, 0);
    return [new Mesh(geometry, new MeshBasicMaterial())];
  });
  stream.update(focus, camera); await Promise.resolve(); stream.update(focus, camera);
  assert.equal(stream.visible, 1);
  camera.lookAt(75, 0, 10); stream.update(focus, camera); assert.equal(stream.visible, 0);
  stream.dispose();
});

test('camera culling follows streamed instance bounds after additions, removals and teleport', async () => {
  const parent = new Group(), stream = new MapObjectStream(parent, 100, 1);
  stream.add([0, 30, 500].map(x => ({ matrix: new Matrix4().makeTranslation(x, 0, 0), position: new Vector3(x, 0, 0) })), async () => {
    const part = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
    part.renderOrder = 1; return [part];
  });
  const camera = new PerspectiveCamera(60, 1, 0.1, 100), frustum = new Frustum();
  const sees = (x: number, forward: number) => {
    camera.position.set(x, 0, 10); camera.lookAt(x, 0, 10 + forward); camera.updateMatrixWorld(); parent.updateMatrixWorld();
    frustum.setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    return frustum.intersectsObject(parent.children[0]);
  };
  stream.update(new Vector3()); await Promise.resolve(); stream.update(new Vector3());
  const mesh = parent.children[0] as InstancedMesh;
  assert.equal(mesh.frustumCulled, true); assert.equal(mesh.renderOrder, 1);
  assert.equal(sees(0, -1), true); assert.equal(sees(0, 1), false, 'objects behind the camera can be culled');
  stream.update(new Vector3());
  assert.ok(mesh.boundingSphere!.containsPoint(new Vector3(30, 0, 0)), 'new active instance expands bounds');
  stream.update(new Vector3(500, 0, 0));
  assert.equal(mesh.count, 1);
  assert.ok(mesh.boundingSphere!.containsPoint(new Vector3(500, 0, 0)));
  assert.equal(mesh.boundingSphere!.containsPoint(new Vector3()), false, 'removed instances no longer inflate bounds');
  assert.equal(sees(500, -1), true, 'teleported-to instance remains visible');
  stream.update(new Vector3(1000, 0, 0)); assert.equal(mesh.visible, false);
  stream.update(new Vector3(500, 0, 0)); assert.equal(mesh.visible, true);
  assert.equal(sees(500, -1), true, 'empty batches can become visible again');
  stream.dispose();
});

test('loading prioritizes nearby placements over resource-table order', () => {
  const stream = new MapObjectStream(new Group(), 1000), started: number[] = [];
  for (const x of [900, 800, 700, 600, 10, 20]) stream.add([
    { matrix: new Matrix4(), position: new Vector3(x, 0, 0) },
  ], () => { started.push(x); return new Promise(() => {}); });
  stream.update(new Vector3());
  assert.deepEqual(started, [10, 20, 600, 700]);
  stream.dispose();
});

test('teleport makes old requests irrelevant and rectangular bounds exclude distant chunks', async () => {
  const parent = new Group(), stream = new MapObjectStream(parent, 100);
  let wanted: (() => boolean) | undefined, finish!: (parts: Mesh[]) => void, distantLoads = 0;
  stream.add([{ matrix: new Matrix4(), position: new Vector3() }], relevant => {
    wanted = relevant; return new Promise(resolve => { finish = resolve; });
  });
  stream.add([{ matrix: new Matrix4(), position: new Vector3(),
    bounds: { minX: 1000, maxX: 3000, minZ: 1000, maxZ: 1001 } }], async () => { distantLoads++; return []; });
  stream.update(new Vector3());
  assert.equal(wanted!(), true);
  assert.equal(distantLoads, 0);
  stream.update(new Vector3(-500, 0, 0));
  assert.equal(wanted!(), false);
  let disposed = false;
  const geometry = new BoxGeometry(); geometry.addEventListener('dispose', () => { disposed = true; });
  finish([new Mesh(geometry, new MeshBasicMaterial())]); await Promise.resolve();
  assert.equal(parent.children.length, 0);
  assert.equal(disposed, true);
  stream.dispose();
});

test('unused model resources are disposed and loaded again on return', async context => {
  let now = 0, loads = 0, released = 0;
  context.mock.method(performance, 'now', () => now);
  const parent = new Group(), stream = new MapObjectStream(parent, 100);
  stream.add([{ matrix: new Matrix4(), position: new Vector3() }], async () => {
    loads++;
    const geometry = new BoxGeometry();
    geometry.addEventListener('dispose', () => released++);
    return [new Mesh(geometry, new MeshBasicMaterial())];
  });
  stream.update(new Vector3()); await Promise.resolve(); stream.update(new Vector3());
  assert.equal(stream.active, 1);
  stream.update(new Vector3(500, 0, 0));
  now = 6000; stream.update(new Vector3(500, 0, 0));
  assert.equal(parent.children.length, 0);
  assert.equal(released, 1);
  stream.update(new Vector3()); await Promise.resolve(); stream.update(new Vector3());
  assert.equal(loads, 2);
  assert.equal(stream.active, 1);
  stream.dispose();
});

test('map objects load near the camera, enter over successive frames and leave beyond the fog range', async () => {
  const parent = new Group(), stream = new MapObjectStream(parent, 100, 1);
  const placements = [0, 20, 200].map(x => ({ matrix: new Matrix4().makeTranslation(x, 0, 0), position: new Vector3(x, 0, 0) }));
  let loads = 0;
  stream.add(placements, async () => { loads++; return [new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())]; });
  let distantLoads = 0;
  stream.add([{ matrix: new Matrix4().makeTranslation(500, 0, 0), position: new Vector3(500, 0, 0) }], async () => { distantLoads++; return [new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())]; });
  stream.update(new Vector3(0, 0, 0));
  assert.equal(stream.active, 0);
  assert.equal(distantLoads, 0, 'distant model bytes are not requested at startup');
  await Promise.resolve();
  stream.update(new Vector3(0, 0, 0));
  assert.equal(stream.active, 1);
  stream.update(new Vector3(0, 0, 0));
  assert.equal(stream.active, 2);
  assert.equal(loads, 1);
  assert.equal(stream.total, 4);
  stream.update(new Vector3(250, 0, 0));
  assert.equal(stream.active, 1);
  assert.equal((parent.children[0] as import('three').InstancedMesh).count, 1);
  stream.update(new Vector3(500, 0, 0));
  assert.equal(distantLoads, 1);
  stream.dispose();
  stream.update(new Vector3(0, 0, 0));
  assert.equal(stream.active, 0);
  parent.traverse(object => { if (object instanceof Mesh) { object.geometry.dispose(); (object.material as MeshBasicMaterial).dispose(); } });
});

test('per-part frustum drops only the off-screen component and retains its shadow reserve',async()=>{
  const parent=new Group(),stream=new MapObjectStream(parent,200),camera=new PerspectiveCamera(60,1,.1,500);
  camera.updateMatrixWorld();
  const near=new Mesh(new BoxGeometry(2,2,2),new MeshBasicMaterial()),far=new Mesh(new BoxGeometry(2,2,2),new MeshBasicMaterial());
  near.name='near component';far.name='off-screen component';far.geometry.translate(100,0,0);
  stream.setShadowRange(150);stream.add([{position:new Vector3(0,0,-10),matrix:new Matrix4().makeTranslation(0,0,-10)}],async()=>[near,far]);
  stream.update(new Vector3(),camera);await Promise.resolve();stream.update(new Vector3(),camera);
  const part=parent.children.find(m=>m.name===far.name) as InstancedMesh;
  assert.equal(part.count,0);assert.equal((parent.children.find(m=>m.name===near.name) as InstancedMesh).count,1);
  const reserve=parent.children.find(m=>m.name===`${far.name} / auxiliary casters`) as InstancedMesh;
  assert.equal(reserve.count,1);assert.ok(reserve.userData.streamAuxiliary);
  stream.setTightFrustum(false);stream.update(new Vector3(),camera);assert.equal(part.count,1);assert.equal(reserve.count,0);
  stream.setTightFrustum(true);stream.setInspectResident(true);stream.update(new Vector3(),camera);assert.equal(part.count,1);
  stream.dispose();
});

test('all nearby object types load after the concurrent-load slots are freed', async () => {
  const parent = new Group(), stream = new MapObjectStream(parent, 100);
  const loads = Array(6).fill(0);
  for (let index = 0; index < loads.length; index++) {
    stream.add([{ matrix: new Matrix4(), position: new Vector3() }], async () => {
      loads[index]++;
      return [new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())];
    });
  }

  const camera = new Vector3();
  stream.update(camera);
  assert.deepEqual(loads, [1, 1, 1, 1, 0, 0]);
  await Promise.resolve();
  stream.update(camera);
  assert.deepEqual(loads, [1, 1, 1, 1, 1, 1]);
  await Promise.resolve();
  stream.update(camera);
  assert.equal(stream.active, 6);
  assert.equal(parent.children.length, 6);

  stream.dispose();
  parent.traverse(object => { if (object instanceof Mesh) { object.geometry.dispose(); (object.material as MeshBasicMaterial).dispose(); } });
});

test('tree toggle hides trunks, foliage and auxiliary casters, then restores resident instances',async()=>{
  const parent=new Group(),stream=new MapObjectStream(parent,200),camera=new PerspectiveCamera(60,1,.1,500);
  camera.updateMatrixWorld();stream.setShadowRange(150);
  const placement={position:new Vector3(0,0,-10),matrix:new Matrix4().makeTranslation(0,0,-10)};
  const trunk=new Mesh(new BoxGeometry(),new MeshBasicMaterial());trunk.name='trunk';
  const leaves=new Mesh(new BoxGeometry(),new MeshBasicMaterial());leaves.name='leaves';leaves.geometry.translate(100,0,0);
  stream.add([placement],async()=>[trunk,leaves],true);
  stream.add([placement],async()=>{const mesh=new Mesh(new BoxGeometry(),new MeshBasicMaterial());mesh.name='building';return [mesh];});
  stream.update(new Vector3(),camera);await Promise.resolve();stream.update(new Vector3(),camera);
  const count=(name:string)=>(parent.children.find(m=>m.name===name) as InstancedMesh).count;
  assert.equal(count('trunk'),1);assert.equal(count('leaves / auxiliary casters'),1);
  stream.setTreesHidden(true);stream.setInspectResident(true);stream.update(new Vector3(),camera);
  for(const mesh of parent.children as InstancedMesh[])if(mesh.name!=='building'){assert.equal(mesh.count,0);assert.equal(mesh.visible,false);}
  assert.equal(count('building'),1);assert.equal(stream.active,2,'toggle preserves residency');
  stream.setTreesHidden(false);stream.update(new Vector3(),camera);
  assert.equal(count('trunk'),1);assert.equal(count('leaves'),1);stream.dispose();
  assert.ok(isMapTreeAlias('fa06a'));assert.ok(isMapTreeAlias('fa12a'));assert.ok(isMapTreeAlias('tree_obj'));
  assert.equal(isMapTreeAlias('lamp_base'),false);assert.equal(isMapTreeAlias('facade'),false);
});

test('street furniture categories toggle independently, including late loads and shadow reserves',async()=>{
  const parent=new Group(),stream=new MapObjectStream(parent,200),camera=new PerspectiveCamera(60,1,.1,500);
  camera.updateMatrixWorld();stream.setShadowRange(150);
  const placement={position:new Vector3(0,0,-10),matrix:new Matrix4().makeTranslation(0,0,-10)};
  for(const category of ['streetlights','bins','small-props',undefined] as const){
    stream.add([placement],async()=>{
      const mesh=new Mesh(new BoxGeometry(),new MeshBasicMaterial());mesh.name=category??'building';
      if(category==='streetlights')mesh.geometry.translate(100,0,0);
      return [mesh];
    },category);
  }
  stream.setCategoryHidden('bins',true); // Set before async model load completes.
  stream.update(new Vector3(),camera);await Promise.resolve();stream.update(new Vector3(),camera);
  const count=(name:string)=>(parent.children.find(m=>m.name===name) as InstancedMesh).count;
  assert.equal(count('bins'),0);assert.equal(count('small-props'),1);assert.equal(count('building'),1);
  assert.equal(count('streetlights / auxiliary casters'),1);
  stream.setCategoryHidden('streetlights',true);stream.setInspectResident(true);stream.update(new Vector3(),camera);
  assert.equal(count('streetlights'),0);assert.equal(count('streetlights / auxiliary casters'),0);
  stream.setCategoryHidden('bins',false);stream.setCategoryHidden('small-props',true);stream.update(new Vector3(),camera);
  assert.equal(count('bins'),1);assert.equal(count('small-props'),0);assert.equal(count('building'),1);
  assert.equal(stream.active,4);stream.dispose();
});

test('pinned prepared models load before playback and retain resources outside the streaming radius',async context=>{
  let now=0,loads=0,disposed=0;context.mock.method(performance,'now',()=>now);
  const parent=new Group(),stream=new MapObjectStream(parent,100);
  stream.add([{position:new Vector3(1000,0,0),matrix:new Matrix4().makeTranslation(1000,0,0)}],async wanted=>{
    assert.equal(wanted(),true);loads++;const geometry=new BoxGeometry();geometry.addEventListener('dispose',()=>disposed++);return [new Mesh(geometry,new MeshBasicMaterial())];
  },false,true);
  await stream.preparePinnedModels();assert.equal(loads,1);stream.update(new Vector3());now=10000;stream.update(new Vector3());assert.equal(disposed,0);
  stream.update(new Vector3(1000,0,0));assert.equal(stream.visible,1);assert.equal(loads,1);stream.dispose();assert.equal(disposed,1);
});


test('stream CPU trace separates async finalization and residency/draw work',async()=>{
  const root=new Group(),stream=new MapObjectStream(root,100);stream.workProfile.setEnabled(true);
  stream.add([{matrix:new Matrix4(),position:new Vector3()}],async()=>[new Mesh(new BoxGeometry(),new MeshBasicMaterial())]);
  stream.update(new Vector3());await Promise.resolve();await Promise.resolve();stream.update(new Vector3());
  const row=stream.workProfile.drain();
  assert.equal(row.loads_started_count,1);assert.equal(row.loads_completed_count,1);assert.equal(row.updates_count,2);
  assert.ok(row.async_finalize_ms>=0&&row.residency_scan_sort_ms>=0&&row.draw_batches_ms>=0);
  assert.ok(row.matrices_written_count>=1);stream.dispose();
});


test('stream placements receive unique numeric IDs shared by their parts and retained across cached cell rebuilds',async()=>{
  const root=new Group(),stream=new MapObjectStream(root,100);
  const placement={matrix:new Matrix4(),position:new Vector3()};
  stream.add([placement,placement],async()=>[new Mesh(new BoxGeometry(),new MeshBasicMaterial()),new Mesh(new BoxGeometry(),new MeshBasicMaterial())],'trees');
  stream.update(new Vector3());await Promise.resolve();await Promise.resolve();stream.update(new Vector3());
  const meshes=root.children.filter(m=>m instanceof InstancedMesh&&m.visible) as InstancedMesh[];
  assert.equal(meshes.length,2);const ids=meshes[0].userData.mapPlacementIds;
  assert.equal(ids.length,2);assert.notEqual(ids[0],ids[1],'even repeated placement references represent distinct map entries');
  assert.deepEqual(meshes[1].userData.mapPlacementIds,ids);
  await stream.setCachedCells(true,64);stream.update(new Vector3());
  const cached=root.children.filter(m=>m instanceof InstancedMesh&&m.visible&&m.userData.cachedMapCell);
  assert.equal(cached.length,2);for(const mesh of cached)assert.deepEqual(mesh.userData.mapPlacementIds,ids);
  await stream.setCachedCells(true,128);stream.update(new Vector3());
  for(const mesh of root.children.filter(m=>m.visible&&m.userData.cachedMapCell))assert.deepEqual(mesh.userData.mapPlacementIds,ids);
  stream.dispose();
});


test('budgeted draw queue keeps old batches until atomic commit and uses the newest camera without starving groups',async()=>{
  let elapsed=0;
  const root=new Group(),stream=new MapObjectStream(root,100,48,()=>elapsed);
  for(let i=0;i<3;i++)stream.add([{matrix:new Matrix4().makeTranslation(i-1,0,-10),position:new Vector3(i-1,0,-10)}],async()=>[new Mesh(new BoxGeometry(),new MeshBasicMaterial())]);
  stream.update(new Vector3());await Promise.resolve();await Promise.resolve();stream.update(new Vector3());
  const meshes=root.children.filter(m=>m instanceof InstancedMesh) as InstancedMesh[];assert.equal(meshes.length,3);
  const before=meshes.map(mesh=>({version:mesh.instanceMatrix.version,ids:mesh.userData.mapPlacementIds}));
  const api=stream as any,draw=api.draw.bind(stream),visited=new Set<unknown>();
  api.draw=(type:unknown,focus:Vector3,cull:boolean)=>{visited.add(type);draw(type,focus,cull);elapsed+=1.2;};
  stream.frameBudgetMs=2;stream.workProfile.setEnabled(true);
  const camera=new PerspectiveCamera(60,1,.1,100);camera.rotation.y=Math.PI;camera.updateMatrixWorld();
  stream.update(new Vector3(),camera);
  assert.equal(visited.size,2);assert.equal(stream.hasPendingWork,true);
  assert.equal(meshes.filter(mesh=>mesh.count===1).length,1,'unprocessed batch stays drawable');
  meshes.forEach((mesh,i)=>{if(mesh.count===1){assert.equal(mesh.instanceMatrix.version,before[i].version);assert.equal(mesh.userData.mapPlacementIds,before[i].ids);}else assert.equal(mesh.userData.mapPlacementIds.length,mesh.count);});
  camera.rotation.y=0;camera.updateMatrixWorld();stream.update(new Vector3(),camera,true);
  assert.equal(visited.size,3);assert.equal(stream.hasPendingWork,false);assert.equal(meshes.filter(mesh=>mesh.count===1).length,1,'deferred group uses current camera instead of the queued camera');
  stream.update(new Vector3(),camera);while(stream.hasPendingWork)stream.update(new Vector3(),camera,true);
  assert.equal(meshes.filter(mesh=>mesh.count===1).length,3);
  for(const mesh of meshes)assert.equal(mesh.userData.mapPlacementIds.length,mesh.count);
  assert.ok(stream.workProfile.drain().budget_yields_count>=1);
  stream.dispose();assert.equal(stream.hasPendingWork,false);
});

test('residency scan queue spans frames fairly and evaluates deferred groups at the latest focus',()=>{
  let elapsed=0;
  const stream=new MapObjectStream(new Group(),100,48,()=>elapsed),api=stream as any;
  for(let i=0;i<6;i++)stream.add([{matrix:new Matrix4(),position:new Vector3()}],async()=>[]);
  const scan=api.scanType.bind(stream),seen:{type:unknown;x:number}[]=[];
  api.scanType=(type:unknown,focus:Vector3)=>{seen.push({type,x:focus.x});scan(type,focus);elapsed+=.45;};
  stream.frameBudgetMs=2;stream.update(new Vector3());assert.equal(seen.length,2);assert.equal(stream.hasPendingWork,true);
  for(let i=0;i<10&&stream.hasPendingWork;i++)stream.update(new Vector3(10,0,0),undefined,true);
  assert.equal(stream.hasPendingWork,false);assert.equal(seen.length,6);assert.equal(new Set(seen.map(s=>s.type)).size,6);
  assert.ok(seen.slice(2).every(s=>s.x===10));stream.dispose();
});


test('stream change feed publishes only changed batches with contiguous revisions and explicit representation invalidations',async()=>{
  const root=new Group(),stream=new MapObjectStream(root,100),camera=new PerspectiveCamera(60,1,.1,100);
  camera.updateMatrixWorld();assert.equal(stream.consumeOcclusionChanges().full,true);
  for(let i=0;i<2;i++)stream.add([{matrix:new Matrix4().makeTranslation(i,0,-10),position:new Vector3(i,0,-10)}],async()=>[new Mesh(new BoxGeometry(),new MeshBasicMaterial())],'trees');
  stream.update(new Vector3(),camera);await Promise.resolve();await Promise.resolve();stream.update(new Vector3(),camera);
  const delta=stream.consumeOcclusionChanges();assert.equal(delta.full,false);assert.equal(delta.meshes.length,2);assert.equal(delta.fromRevision,0);assert.equal(delta.revision,stream.revision);
  stream.update(new Vector3(),camera);const empty=stream.consumeOcclusionChanges();assert.equal(empty.meshes.length,0);assert.equal(empty.fromRevision,delta.revision);
  camera.rotation.y=Math.PI;camera.updateMatrixWorld();stream.update(new Vector3(),camera);
  const hidden=stream.consumeOcclusionChanges();assert.equal(hidden.meshes.length,2);assert.ok(hidden.meshes.every(mesh=>!mesh.visible));assert.equal(hidden.fromRevision,empty.revision);
  await stream.setCachedCells(true,64);assert.equal(stream.consumeOcclusionChanges().full,true);
  stream.update(new Vector3(),camera);stream.consumeOcclusionChanges();
  camera.rotation.y=0;camera.updateMatrixWorld();stream.update(new Vector3(),camera);
  const shownCells=stream.consumeOcclusionChanges();assert.equal(shownCells.full,false);assert.equal(shownCells.meshes.length,2);assert.ok(shownCells.meshes.every(mesh=>mesh.userData.cachedMapCell&&mesh.visible));
  stream.setTreesHidden(true);stream.update(new Vector3(),camera);const hiddenCells=stream.consumeOcclusionChanges();assert.equal(hiddenCells.full,false);assert.equal(hiddenCells.meshes.length,2);assert.ok(hiddenCells.meshes.every(mesh=>!mesh.visible));stream.dispose();
});


for(const cachedCells of [false,true])test(`static shadow revision ignores camera-only batch swaps (${cachedCells?'cached cells':'regular instances'})`,async()=>{
  const root=new Group(),stream=new MapObjectStream(root,500),camera=new PerspectiveCamera(60,1,.1,1000);
  camera.updateMatrixWorld();stream.setShadowRange(150);
  stream.add([{matrix:new Matrix4().makeTranslation(0,0,-10),position:new Vector3(0,0,-10)},{matrix:new Matrix4().makeTranslation(200,0,-10),position:new Vector3(200,0,-10)}],async()=>{
    const mesh=new Mesh(new BoxGeometry(),new MeshBasicMaterial());mesh.userData.staticMapCaster=true;return [mesh];
  },'trees');
  if(cachedCells)await stream.setCachedCells(true,64);
  stream.update(new Vector3(),camera);await Promise.resolve();await Promise.resolve();stream.update(new Vector3(),camera);
  const shadow=stream.shadowRevision,revision=stream.revision;assert.ok(shadow>0);
  for(let i=0;i<6;i++){camera.rotation.y=i%2?0:Math.PI;camera.updateMatrixWorld();stream.update(new Vector3(),camera);assert.equal(stream.shadowRevision,shadow,'primary/caster-reserve swaps retain the cached projection');}
  assert.ok(stream.revision>revision,'normal streaming/Hi-Z revisions still follow visibility');
  stream.setTreesHidden(true);stream.update(new Vector3(),camera);assert.ok(stream.shadowRevision>shadow,'removing actual nearby casters invalidates shadows');
  const hidden=stream.shadowRevision;stream.setTreesHidden(false);stream.update(new Vector3(),camera);assert.ok(stream.shadowRevision>hidden);
  const shown=stream.shadowRevision;stream.update(new Vector3(300,0,0),camera);assert.ok(stream.shadowRevision>shown,'moving the reserve changes real caster membership');
  stream.dispose();
});
