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
  assert.equal(tireScrub(contact({ slipSpeed: 3, lateralSpeed: 0 })), 0);
  assert.ok(tireScrub(contact({ slipSpeed: 0, lateralSpeed: 5 })) > 0);
  assert.equal(tireSmoke(contact()), 0);
  assert.equal(tireSmoke(contact({ slipSpeed: 0, lateralSpeed: 9 })), 0);
  assert.equal(tireSmoke(contact({ slipSpeed: 10 })), 0);
  assert.ok(tireSmoke(contact({ slipSpeed: 10, slip: 0.9 })) > 0);
  const effects = new TireEffects();
  const road = effects.group.children[0] as Mesh, grass = effects.group.children[1] as Mesh;
  const smoke = effects.group.children[3] as Points;
  const looseGround = new Texture(); effects.setLooseGroundTexture(looseGround);
  assert.equal((road.material as MeshBasicMaterial).map, null);
  assert.equal((grass.material as MeshBasicMaterial).map, null);
  effects.update(0.05, [contact({ contact: false })]);
  assert.equal((road.geometry as BufferGeometry).drawRange.count, 0);
  assert.equal((smoke.geometry as BufferGeometry).drawRange.count, 0);
  effects.update(0.05, [contact({ surface: 'grass' })]);
  effects.update(0.05, [contact({ surface: 'grass', contactPoint: new Vector3(0, 0.012, -0.56) })]);
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
