import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Color, Frustum, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, Texture, Vector3 } from 'three';
import { MapObjectStream } from '../src/render/map-object-stream';

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
  assert.equal(stream.visible, 2, 'nearby off-screen casters remain available to the shadow pass');
  stream.setShadowRange(0); stream.update(focus, camera);
  assert.equal(stream.visible, 1, 'disabling shadows restores normal camera culling');
  stream.dispose();
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
