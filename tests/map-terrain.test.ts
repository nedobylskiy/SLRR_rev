import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { MapTerrain } from '../src/engine/map-terrain';
import type { ScxModel } from '../src/formats/scx';

test('map terrain samples original triangle height and slope in metres', () => {
  const model: ScxModel = { version: 3, warnings: [], meshes: [{ name: 'road',
    positions: new Float32Array([0, 0, 0, 1000, 0, 0, 0, 100, 1000]),
    normals: new Float32Array(9), uv: new Float32Array(6), indices: new Uint32Array([0, 1, 2]), diffuse: [1, 1, 1, 1], textureIndex: 0,
  }] };
  const terrain = new MapTerrain(); terrain.add(model);
  assert.equal(terrain.faces, 1);
  assert.ok(Math.abs(terrain.height(2, 3) - 0.3) < 1e-6);
  assert.ok(terrain.normal(2, 3).y > 0.99);
  assert.equal(terrain.height(9, 9), -1000);
});
