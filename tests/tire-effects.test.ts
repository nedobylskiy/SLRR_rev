import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { BufferGeometry, Mesh, Points, Vector3 } from 'three';
import { tireSurfaceForTexture } from '../src/engine/map-terrain';
import { TireEffects, tireScrub } from '../src/render/tire-effects';
import type { TireContactState } from '../src/engine/suspension-3d';

const contact = (changes: Partial<TireContactState> = {}): TireContactState => ({
  contact: true, force: 3600, contactPoint: new Vector3(0, 0.012, 0), contactNormal: new Vector3(0, 1, 0),
  forward: new Vector3(0, 0, -1), slipSpeed: 3, lateralSpeed: 0, surface: 'road', ...changes,
});

test('tyre visual effects require supported scrub and keep marks on the selected surface', () => {
  assert.equal(tireScrub(contact({ contact: false })), 0);
  assert.equal(tireScrub(contact({ slipSpeed: 0.4, lateralSpeed: 0.2 })), 0);
  assert.ok(tireScrub(contact({ slipSpeed: 0, lateralSpeed: 3 })) > 0);
  const effects = new TireEffects();
  const road = effects.group.children[0] as Mesh, grass = effects.group.children[1] as Mesh;
  const smoke = effects.group.children[3] as Points;
  effects.update(0.05, [contact({ contact: false })]);
  assert.equal((road.geometry as BufferGeometry).drawRange.count, 0);
  assert.equal((smoke.geometry as BufferGeometry).drawRange.count, 0);
  effects.update(0.05, [contact({ surface: 'grass' })]);
  effects.update(0.05, [contact({ surface: 'grass', contactPoint: new Vector3(0, 0.012, -0.32) })]);
  assert.ok((grass.geometry as BufferGeometry).drawRange.count > 0);
  assert.equal((road.geometry as BufferGeometry).drawRange.count, 0);
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
