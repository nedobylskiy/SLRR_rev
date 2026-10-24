import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Vector3 } from 'three';
import { MapCollision } from '../src/engine/map-collision';
import type { ScxModel } from '../src/formats/scx';

test('static map wall pushes from either side and ignores distant points', () => {
  const model: ScxModel = { version: 3, warnings: [], meshes: [{ name: 'barrier',
    positions: new Float32Array([0, 0, 0, 0, 300, 0, 0, 0, 300]),
    normals: new Float32Array(9), uv: new Float32Array(6), indices: new Uint32Array([0, 1, 2]), diffuse: [1, 1, 1, 1], textureIndex: 0,
  }] };
  const collision = new MapCollision(); collision.add(model);
  assert.equal(collision.walls, 1);
  const front = collision.contact(new Vector3(0.1, 1, 1));
  const back = collision.contact(new Vector3(-0.1, 1, 1));
  assert.ok(front && back);
  assert.ok(front.normal.x > 0 && back.normal.x < 0);
  assert.ok(Math.abs(front.depth - 0.1) < 1e-6);
  assert.equal(collision.contact(new Vector3(2, 1, 1)), undefined);
});
