import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { EngineWorld, type PartDefinition } from '../src/engine/world';
import { parsePartConfig } from '../src/formats/cfg';
import { linkedSuspensionAnchors } from '../src/engine/linked-suspension';

const definition = (id: number, source: string): PartDefinition => ({
  key: { pack: 'test.rpk', id }, alias: String(id), cfgPath: `${id}.cfg`, config: parsePartConfig(source),
});

test('rear linked spring and damper use both chassis slots, independently of bonepos', () => {
  const world = new EngineWorld();
  const root = world.create(definition(1, `
slot -0.500 -0.172 1.220 0 0 0 503
type 10 sphere 0.315
spring 0.290 0.100 0.050
wheel -0.647 -0.660 1.259 0 0 0 0 0 1 1
wheel -0.647 -0.660 1.259 0 0 0 0 0 1 1
wheel -0.647 -0.660 1.259 0 0 0 0 0 1 1
slot 0.176 0 -0.100 0 0 0 303
slottype 303
bonepos 0.213 0.400 0
slot 0.213 0 0 0 0 0 313
slottype 303`));
  for (const [id, slot, ownY] of [[2, 303, 0], [3, 313, -0.4]]) {
    const part = world.create(definition(id, `linked 301 501\nslot 0 ${ownY} 0 0 0 0 1`));
    world.install(root, slot, part, 1);
    const anchors = linkedSuspensionAnchors(root, part)!;
    const lower = anchors.lower.clone().applyMatrix4(part.local);
    const upper = anchors.upper.clone().applyMatrix4(part.local);
    assert.ok(lower.distanceTo(new Vector3(-0.471, -0.660, 1.159)) < 1e-9);
    assert.ok(upper.distanceTo(new Vector3(-0.500, -0.172, 1.220)) < 1e-9);
    // Moving a live upper slot must update the endpoint, not retain a cached bonepos.
    root.slotPositions.set(503, [-0.5, -0.1, 1.22]);
    const changed = linkedSuspensionAnchors(root, part)!;
    assert.ok(changed.upper.clone().applyMatrix4(part.local).distanceTo(new Vector3(-0.5, -0.1, 1.22)) < 1e-9);
    root.slotPositions.delete(503);
  }
  world.dispose();
});
