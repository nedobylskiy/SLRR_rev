import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineWorld, type PartDefinition } from '../src/engine/world';
import { parsePartConfig } from '../src/formats/cfg';
import { applyDisplaySteering } from '../src/engine/display-steering';

const definition = (id: number, source: string): PartDefinition => ({
  key: { pack: 'test.rpk', id }, alias: String(id), cfgPath: `${id}.cfg`, config: parsePartConfig(source),
});

test('display steering uses each CFG wheel and leaves nonsteering rear wheels and arms unchanged', () => {
  const world = new EngineWorld();
  const root = world.create(definition(1, `maxsteer 0.5 2.7
wheel -0.7 -0.6 -1.2 0 0 0 1 1 1 0
wheel 0.7 -0.6 -1.2 0 0 0 1 1 1 0
wheel -0.7 -0.6 1.2 0 0 0 0 0 1 1
slot 0 0 0 0 0 0 101
slottype 101
slot 0 0 0 3.141592653589793 0 0 102
slottype 102
slot 0 0 0 0 0 0 103
slottype 103
slot 0 0 0 0 0 0 121
slottype 201
slot 0.1 0 0 0 0 0 301
slottype 301`));
  for (const [index, slot] of [101, 102, 103, 121, 301].entries()) {
    const part = world.create(definition(index + 2, 'slot 0.02 0 0 0 0 0 1'));
    world.install(root, slot, part, 1);
  }
  const neutral = new Map([...root.children].map(([id, part]) => [id, part.local.clone()]));
  applyDisplaySteering(root, 0.7);
  assert.notDeepEqual(root.children.get(101)!.local, neutral.get(101));
  assert.notDeepEqual(root.children.get(102)!.local, neutral.get(102));
  assert.notDeepEqual(root.children.get(121)!.local, neutral.get(121));
  assert.deepEqual(root.children.get(103)!.local, neutral.get(103));
  assert.deepEqual(root.children.get(301)!.local, neutral.get(301));
  applyDisplaySteering(root, 0);
  for (const [id, part] of root.children) assert.deepEqual(part.local, neutral.get(id));
  world.dispose();
});
