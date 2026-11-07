import {CpuWorkProfile} from '../src/runtime/cpu-work-profile';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { MapTerrain } from '../src/engine/map-terrain';
import type { ScxModel } from '../src/formats/scx';
import { Box3, Matrix4, Vector3 } from 'three';
import { MapCollision } from '../src/engine/map-collision';

test('map terrain samples original triangle height and slope in metres', () => {
  const model: ScxModel = { version: 3, warnings: [], meshes: [{ name: 'road',
    positions: new Float32Array([0, 0, 0, 1000, 0, 0, 0, 100, 1000]),
    normals: new Float32Array(9), uv: new Float32Array(6), indices: new Uint32Array([0, 1, 2]), diffuse: [1, 1, 1, 1], textureIndex: 0,
  }] };
  const terrain = new MapTerrain(); terrain.add(model, ['maps/textures/fu.dds']);
  assert.equal(terrain.faces, 1);
  assert.ok(Math.abs(terrain.height(2, 3) - 0.3) < 1e-6);
  assert.ok(terrain.normal(2, 3).y > 0.99);
  assert.equal(terrain.sample(2, 3)?.surface, 'grass');
  assert.equal(terrain.height(9, 9), -1000);
});

test('overlapping ground meshes support a ramp above the road without lifting a body below it', () => {
  const mesh = (name: string, positions: number[]) => ({ name,
    positions: new Float32Array(positions), normals: new Float32Array(9), uv: new Float32Array(6),
    indices: new Uint32Array([0, 1, 2]), diffuse: [1, 1, 1, 1], textureIndex: 0,
  });
  const terrain = new MapTerrain();
  terrain.add({ version: 3, warnings: [], meshes: [
    mesh('road', [0, 0, 0, 1000, 0, 0, 0, 0, 1000]),
    mesh('ramp', [0, 100, 0, 1000, 100, 0, 0, 200, 1000]),
  ] });
  assert.ok(Math.abs(terrain.height(2, 3, 2) - 1.3) < 1e-6);
  assert.equal(terrain.height(2, 3, 0.1), 0);
  assert.ok(terrain.normal(2, 3, 2).y < 1);
});

test('terrain BVH agrees with exhaustive triangle sampling and invalidates after adding geometry', () => {
  const positions: number[] = [], indices: number[] = [];
  for (let x = -8; x < 8; x++) for (let z = -8; z < 8; z++) for (const deck of [-3, 1]) {
    const start = positions.length / 3;
    for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) positions.push((x + dx) * 100, deck * 100 + (x + dx) * 2 + (z + dz) * 3, (z + dz) * 100);
    indices.push(start, start + 1, start + 2, start + 1, start + 3, start + 2);
  }
  const mesh = { name: 'overlapping decks', positions: new Float32Array(positions), indices: new Uint32Array(indices), normals: new Float32Array(positions.length), uv: new Float32Array(positions.length / 3 * 2), diffuse: [1, 1, 1, 1], textureIndex: 0 };
  const terrain = new MapTerrain(); terrain.add({ version: 3, warnings: [], meshes: [mesh] }); terrain.prepare();
  const exhaustive = (x: number, z: number, fromY: number) => {
    let best = -1000;
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3, p = mesh.positions;
      const ax = p[a] * 0.01, az = p[a + 2] * 0.01, bx = p[b] * 0.01, bz = p[b + 2] * 0.01, cx = p[c] * 0.01, cz = p[c + 2] * 0.01;
      const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / denominator;
      const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / denominator;
      if (u < -1e-5 || v < -1e-5 || u + v > 1.00001) continue;
      const h = (u * p[a + 1] + v * p[b + 1] + (1 - u - v) * p[c + 1]) * 0.01;
      if (h <= fromY + 0.5) best = Math.max(best, h);
    }
    return best;
  };
  for (let query = 0; query < 500; query++) {
    const x = ((query * 0.137) % 15.8) - 7.9, z = ((query * 0.291) % 15.8) - 7.9, fromY = query % 3 - 1;
    assert.ok(Math.abs(terrain.height(x, z, fromY) - exhaustive(x, z, fromY)) < 1e-8);
    const height = terrain.height(x, z, fromY);
    // A rejection must never suppress a real node contact, including lower decks.
    const bounds = new Box3(new Vector3(x, height + 0.02, z), new Vector3(x + 0.001, height + 0.02, z + 0.001));
    assert.equal(terrain.mayReach(bounds), true);
  }
  terrain.add({ version: 3, warnings: [], meshes: [{ ...mesh, positions: new Float32Array([-800, 500, -800, 800, 500, -800, -800, 500, 800]), indices: new Uint32Array([0, 1, 2]) }] });
  assert.equal(terrain.height(-2, -2, 6), 5, 'new geometry invalidates the prepared cell tree');
});

test('panel terrain broad phase rejects clear space but retains slopes, CFG supports and fallback floor', () => {
  const collision = new MapCollision(), terrain = new MapTerrain(collision);
  const box = (x: number, y: number, z: number) => new Box3(new Vector3(x, y, z), new Vector3(x + 0.1, y + 0.1, z + 0.1));
  terrain.add({ version: 3, warnings: [], meshes: [{ name: 'negative slope crossing cells',
    positions: new Float32Array([-3200, -300, -3200, 0, -300, -3200, -3200, -100, 0]),
    indices: new Uint32Array([0, 1, 2]), normals: new Float32Array(9), uv: new Float32Array(6), diffuse: [1, 1, 1, 1], textureIndex: 0,
  }] });
  assert.equal(terrain.mayReach(box(-24, 1, -24)), false, 'ground is below the entire cage');
  assert.equal(terrain.mayReach(box(-24, -6, -24)), false, 'overhead deck is unreachable by height rays');
  assert.equal(terrain.mayReach(box(24, -2, 24)), false, 'no geometry nearby');
  assert.equal(terrain.mayReach(box(-24, -2.48, -24)), true, 'slope is close enough for a node contact');
  assert.equal(terrain.mayReach(box(100, -1000, 100)), true, 'height fallback stays consistent');
  collision.addBox(new Matrix4().makeRotationY(0.7).setPosition(24, -3, 24), new Vector3(2, 1, 2));
  assert.equal(terrain.mayReach(box(24, -1.98, 24)), true, 'rotated CFG box can support a panel');
  assert.equal(terrain.mayReach(box(24, 1, 24)), false);
});


test('terrain work counters identify lazy build and triangle queries without changing support',()=>{
  const terrain=new MapTerrain();terrain.add({version:3,warnings:[],meshes:[{name:'road',positions:new Float32Array([0,0,0,1000,0,0,0,0,1000]),normals:new Float32Array(9),uv:new Float32Array(6),indices:new Uint32Array([0,1,2]),diffuse:[1,1,1,1],textureIndex:0}]});
  const profile=new CpuWorkProfile();profile.setEnabled(true);terrain.queryProfile=profile;
  assert.equal(terrain.height(2,2,1),0);let row=profile.drain();
  assert.equal(row.map_samples_count,1);assert.equal(row.map_lazy_builds_count,1);assert.equal(row.map_branches_count,1);assert.equal(row.map_triangle_tests_count,1);
  assert.equal(terrain.height(2,2,1),0);row=profile.drain();assert.equal(row.map_lazy_builds_count,undefined);
  terrain.queryProfile=undefined;terrain.height(2,2,1);assert.deepEqual(profile.drain(),{});
});
