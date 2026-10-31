import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { MapObjectStream } from '../src/render/map-object-stream';

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
