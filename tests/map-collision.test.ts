import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Matrix4, Vector3 } from 'three';
import { MapCollision } from '../src/engine/map-collision';
import { MapTerrain } from '../src/engine/map-terrain';
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

test('original CFG box supplies rotated static contacts without the visual mesh', () => {
  const collision = new MapCollision();
  collision.addBox(new Matrix4().makeRotationY(Math.PI / 2).setPosition(4, 1.5, 2), new Vector3(2, 1.5, 1));
  assert.equal(collision.boxes, 1);
  const hit = collision.contact(new Vector3(5.1, 1.5, 2), 0.2);
  assert.ok(hit && hit.normal.x > 0.99);
  assert.ok(Math.abs(hit.depth - 0.1) < 1e-6);
  assert.equal(collision.contact(new Vector3(8, 1.5, 2)), undefined);
});

test('wheels can stand on the top of an original rotated CFG box without a visual collider', () => {
  const collision = new MapCollision();
  collision.addBox(new Matrix4().makeRotationY(Math.PI / 4).setPosition(4, 1.5, 2), new Vector3(2, 1.5, 1));
  const terrain = new MapTerrain(collision);
  assert.equal(terrain.height(4, 2), -1000);
  assert.ok(Math.abs(terrain.height(4, 2, 4) - 3) < 1e-6);
  assert.ok(terrain.normal(4, 2, 4).distanceTo(new Vector3(0, 1, 0)) < 1e-6);
  assert.equal(collision.support(4, 2, 2), undefined);
  assert.equal(collision.support(8, 2, 4), undefined);
  const slope = new MapCollision();
  slope.addBox(new Matrix4().makeRotationX(Math.PI / 6).setPosition(0, 2, 0), new Vector3(2, 0.2, 1));
  const inclined = slope.support(0, 0, 4);
  assert.ok(inclined && Math.abs(inclined.height - (2 + 0.2 / Math.cos(Math.PI / 6))) < 1e-6);
  assert.ok(Math.abs(inclined.normal.y - Math.cos(Math.PI / 6)) < 1e-6);
});
