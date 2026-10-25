import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { BufferGeometry, Mesh, MeshBasicMaterial, Points, Texture, Vector3 } from 'three';
import { tireSurfaceForTexture } from '../src/engine/map-terrain';
import { TireEffects, tireScrub, tireSmoke } from '../src/render/tire-effects';
import type { TireContactState } from '../src/engine/suspension-3d';

const contact = (changes: Partial<TireContactState> = {}): TireContactState => ({
  contact: true, force: 3600, contactPoint: new Vector3(0, 0.012, 0), contactNormal: new Vector3(0, 1, 0),
  forward: new Vector3(0, 0, -1), slipSpeed: 5, lateralSpeed: 0, slip: 0.5, surface: 'road', ...changes,
});

test('tyre visual effects require supported scrub and keep marks on the selected surface', () => {
  assert.equal(tireScrub(contact({ contact: false })), 0);
  assert.equal(tireScrub(contact({ slipSpeed: 0.4, lateralSpeed: 0.2 })), 0);
  assert.equal(tireScrub(contact({ slipSpeed: 2, lateralSpeed: 0 })), 0);
  assert.equal(tireScrub(contact({ slipSpeed: 0, lateralSpeed: 5 })), 0);
  assert.ok(tireScrub(contact({ slipSpeed: 0, lateralSpeed: 6 })) > 0);
  // Stock Baiern launches with ~0.72 rear-wheel slip at 5.5 m/s, while the fronts roll freely.
  assert.ok(tireScrub(contact({ slip: 0.72, slipSpeed: 5.5 })) > 0);
  assert.ok(tireSmoke(contact({ slip: 0.72, slipSpeed: 5.5 })) > 0);
  assert.equal(tireSmoke(contact({ slip: 0.01, slipSpeed: 0 })), 0);
  assert.equal(tireSmoke(contact({ slip: 0.12, slipSpeed: 5.5 })), 0);
  assert.equal(tireSmoke(contact({ slipSpeed: 0, lateralSpeed: 9 })), 0);
  const effects = new TireEffects();
  const road = effects.group.children[0] as Mesh, grass = effects.group.children[1] as Mesh;
  const smoke = effects.group.children[3] as Points;
  const looseGround = new Texture(); effects.setLooseGroundTexture(looseGround);
  assert.equal((road.material as MeshBasicMaterial).map, null);
  assert.equal((grass.material as MeshBasicMaterial).map, null);
  effects.update(0.05, [contact({ contact: false })]);
  assert.equal((road.geometry as BufferGeometry).drawRange.count, 0);
  assert.equal((smoke.geometry as BufferGeometry).drawRange.count, 0);
  effects.update(0.05, [contact({ surface: 'grass', slipSpeed: 3 })]);
  effects.update(0.05, [contact({ surface: 'grass', slipSpeed: 3, contactPoint: new Vector3(0, 0.012, -0.56) })]);
  assert.ok((grass.geometry as BufferGeometry).drawRange.count > 0);
  assert.equal((road.geometry as BufferGeometry).drawRange.count, 0);
  assert.equal((smoke.geometry as BufferGeometry).drawRange.count, 0);
  const marks = (grass.geometry as BufferGeometry).getAttribute('position');
  assert.deepEqual([marks.getX(2), marks.getY(2), marks.getZ(2)], [marks.getX(4), marks.getY(4), marks.getZ(4)]);
  effects.update(0.05, [contact({ slipSpeed: 10, slip: 0.9 })]);
  assert.ok((smoke.geometry as BufferGeometry).drawRange.count > 0);
  effects.reset();
  assert.equal((grass.geometry as BufferGeometry).drawRange.count, 0);
  assert.equal((smoke.geometry as BufferGeometry).drawRange.count, 0);
  effects.dispose();
});

test('surface presets distinguish named grass and loose ground without mistaking asphalt', () => {
  assert.equal(tireSurfaceForTexture('maps\\textures\\fu.dds'), 'grass');
  assert.equal(tireSurfaceForTexture('maps\\textures\\GrassySand.dds'), 'dirt');
  assert.equal(tireSurfaceForTexture('maps\\textures\\asphalt02.dds'), 'road');
  assert.equal(tireSurfaceForTexture('maps\\textures\\sand.dds'), 'dirt');
});

test('stock launch leaves rear marks and smoke without marking freely rolling fronts', () => {
  const effects = new TireEffects();
  const front = contact({ slip: 0.01, slipSpeed: 0 });
  const rear = contact({ slip: 0.72, slipSpeed: 5.5 });
  const road = effects.group.children[0] as Mesh, smoke = effects.group.children[3] as Points;
  effects.update(1 / 60, [front, front, rear, rear]);
  assert.equal((smoke.geometry as BufferGeometry).drawRange.count, 10);
  assert.equal((road.geometry as BufferGeometry).drawRange.count, 0);
  const movedRear = contact({ slip: 0.67, slipSpeed: 6.3, contactPoint: new Vector3(0, 0.012, -0.12) });
  effects.update(1 / 60, [front, front, movedRear, movedRear]);
  assert.equal((road.geometry as BufferGeometry).drawRange.count, 12);
  effects.dispose();
});

test('brake-held rear wheelspin marks the stationary contact patch', () => {
  const effects = new TireEffects();
  const front = contact({ slip: 0, slipSpeed: 0 });
  const rear = contact({ slip: 0.75, slipSpeed: 6 });
  const road = effects.group.children[0] as Mesh;
  const smoke = effects.group.children[3] as Points;
  effects.update(1 / 60, [front, front, rear, rear]);
  effects.update(1 / 60, [front, front, rear, rear]);
  assert.equal((road.geometry as BufferGeometry).drawRange.count, 12);
  assert.ok((smoke.geometry as BufferGeometry).drawRange.count > 0);
  const rolling = contact({ slip: 0, slipSpeed: 0 });
  for (let i = 0; i < 20; i++) effects.update(1 / 60, [rolling, rolling, rolling, rolling]);
  assert.equal((road.geometry as BufferGeometry).drawRange.count, 12);
  effects.dispose();
});

test('slow burnout accumulates sub-frame wheel movement into a continuous mark', () => {
  const effects = new TireEffects();
  const road = effects.group.children[0] as Mesh;
  for (const z of [0, -0.02, -0.04, -0.06, -0.08, -0.1]) {
    effects.update(1 / 60, [contact({ slip: 0.7, slipSpeed: 4, contactPoint: new Vector3(0, 0.012, z) })]);
  }
  assert.ok((road.geometry as BufferGeometry).drawRange.count >= 12);
  const vertices = (road.geometry as BufferGeometry).getAttribute('position');
  assert.ok(vertices.getZ(6) < -0.075);
  effects.dispose();
});

test('skid mark fades in at the start and fades out when wheelspin ends', () => {
  const effects = new TireEffects();
  const road = effects.group.children[0] as Mesh;
  for (const z of [0, -0.25, -0.5, -0.75]) {
    effects.update(1 / 60, [contact({ contactPoint: new Vector3(0, 0.012, z) })]);
  }
  const colors = (road.geometry as BufferGeometry).getAttribute('color');
  assert.equal(colors.itemSize, 4);
  assert.equal(colors.getW(0), 0);
  assert.equal(colors.getW(11), 1);
  effects.update(1 / 60, [contact({ contact: false })]);
  assert.equal(colors.getW(11), 0);
  assert.ok(colors.getW(8) > 0 && colors.getW(8) < 1);
  effects.dispose();
});

test('smoke grows into a wider plume as it leaves the tire', () => {
  const effects = new TireEffects();
  const smoke = effects.group.children[3] as Points;
  effects.update(1 / 60, [contact({ slip: 0.8, slipSpeed: 7 })]);
  const sizes = (smoke.geometry as BufferGeometry).getAttribute('aSize');
  const fresh = sizes.getX(0);
  effects.update(0.5, [contact({ contact: false })]);
  assert.ok(sizes.getX(0) > fresh * 2);
  effects.dispose();
});
