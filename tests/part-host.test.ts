import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineWorld, type PartDefinition } from '../src/engine/world';
import { parsePartConfig } from '../src/formats/cfg';
import { PART_CLASS, PartHost } from '../src/engine/part-host';

function definition(id: number, cfg: string): PartDefinition {
  return { key: { pack: 'test.rpk', id }, alias: String(id), cfgPath: `${id}.cfg`, config: parsePartConfig(cfg) };
}

test('Part natives traverse the actual world in both directions and observe detach/install immediately', () => {
  const world = new EngineWorld(), host = new PartHost(world);
  const root = world.create(definition(1, 'slot 1 0 0 0 0 0 12\nslot 0 0 0 0 0 0 13'));
  const child = world.create(definition(2, 'slot 0 0 0 0 0 0 7'));
  world.install(root, 12, child, 7);
  const a = host.bind(root), b = host.bind(child);
  const call = (name: string, signature: string, receiver = a, args: number[] = []) => host.natives.invoke(PART_CLASS, name, signature, receiver, args);
  assert.equal(call('getSlots', '()I'), 2);
  assert.equal(call('getSlotID', '(I)I', a, [0]), 12);
  assert.equal(call('getSlotID', '(I)I', b, [-1]), 7);
  assert.equal(call('partOnSlot', '(I)Ljava.game.parts.Part;', a, [12]), b);
  assert.equal(call('partOnSlot', '(I)Ljava.game.parts.Part;', b, [7]), a);
  assert.equal(call('slotIDOnSlot', '(I)I', a, [12]), 7);
  assert.equal(call('slotIDOnSlot', '(I)I', b, [7]), 12);
  assert.equal(call('partOnSlot', '(I)Ljava.game.parts.Part;', a, [13]), null);
  world.detach(child);
  assert.equal(call('partOnSlot', '(I)Ljava.game.parts.Part;', a, [12]), null);
  assert.equal(call('getSlotID', '(I)I', b, [-1]), 0);
  world.install(root, 13, child, 7);
  assert.equal(call('partOnSlot', '(I)Ljava.game.parts.Part;', a, [13]), b);
  assert.equal(host.bind(child), b);
  world.dispose();
  assert.throws(() => call('getSlots', '()I'), /live world/); host.dispose();
});

test('Part host rejects foreign/stale handles, wrong descriptors and malformed arguments', () => {
  const world = new EngineWorld(), host = new PartHost(world), part = world.create(definition(1, ''));
  const handle = host.bind(part), foreign = new PartHost(world).bind(part);
  assert.throws(() => host.natives.invoke(PART_CLASS, 'getSlots', '()I', foreign, []), /unknown/);
  assert.throws(() => host.natives.invoke(PART_CLASS, 'getSlots', '()F', handle, []), /Missing native/);
  assert.throws(() => host.natives.invoke(PART_CLASS, 'getSlots', '()I', handle, [1]), /arguments/);
  assert.throws(() => host.natives.invoke(PART_CLASS, 'getSlotID', '(I)I', handle, [NaN]), /Java int/);
  assert.throws(() => host.natives.invoke(PART_CLASS, 'getSlotID', '(I)I', handle, [0]), /range/);
  const otherWorld = new EngineWorld(); assert.throws(() => host.bind(otherWorld.create(part.definition)), /live world/);
  host.dispose(); assert.throws(() => host.natives.invoke(PART_CLASS, 'getSlots', '()I', handle, []), /unknown/);
  world.dispose(); otherWorld.dispose();
});
