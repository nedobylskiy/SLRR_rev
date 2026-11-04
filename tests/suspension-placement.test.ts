import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Vector3 } from 'three';
import { EngineWorld } from '../src/engine/world';
import { parsePartConfig } from '../src/formats/cfg';
import { RigidBody3D } from '../src/engine/rigid-body-3d';
import { Suspension3D, TestTerrain } from '../src/engine/suspension-3d';

test('suspension placement shifts installation and physical wheel hardpoints together without changing CFG', () => {
  const world = new EngineWorld();
  const cfg = parsePartConfig([0, 1, 2, 3].map(i => `type 10 sphere 0.3\nwheel ${i % 2 ? 0.7 : -0.7} -0.6 ${i < 2 ? -1.3 : 1.3} 0 0 0 0 0 1 0\nslot 0 0 0 0 0 0 ${101 + i}\nslottype ${101 + i}`).join('\n') + '\nslot 0 0 0 0 0 0 123\nslottype 203\nslot 0 0 0 0 0 0 303\nslottype 303');
  const root = world.create({ key: { pack: 'test.rpk', id: 1 }, alias: 'car', cfgPath: '', config: cfg });
  root.wheelFrameOffsetY = 0.165;
  for (const id of [101, 102, 103, 104, 123, 303]) {
    const part = world.create({ key: { pack: 'test.rpk', id }, alias: String(id), cfgPath: '', config: parsePartConfig('slot 0 0 0 0 0 0 1') });
    world.install(root, id, part, 1);
    assert.ok(Math.abs(part.local.elements[13] + 0.435) < 1e-10);
    world.refreshAttachment(part);
    assert.ok(Math.abs(part.local.elements[13] + 0.435) < 1e-10, 'refresh must not add the offset twice');
  }
  const body = new RigidBody3D(1000, new Box3(new Vector3(-1, -0.5, -2), new Vector3(1, 0.5, 2)));
  const suspension = new Suspension3D(root, body, new TestTerrain());
  for (const wheel of suspension.wheels) {
    assert.ok(Math.abs(wheel.center.y + 0.435) < 1e-10);
    assert.ok(Math.abs(wheel.hardpoint.y - (wheel.center.y + wheel.rest)) < 1e-10);
  }
  assert.equal(cfg.wheels[0].position[1], -0.6, 'original configuration remains unchanged');
});
