import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { Assets } from '../src/assets';
import { parsePartConfig } from '../src/formats/cfg';
import { EngineWorld, PartFactory, poseMatrix, type PartDefinition } from '../src/engine/world';
import type { RpkPack } from '../src/formats/rpk';
import { modelMatrix } from '../src/engine/model-transform';

test('SCX centimetres convert to CFG metres without scaling attachment translations or mutating poses', () => {
  const world = new EngineWorld();
  const root = world.create(definition(1, 'slot 0 0 -2 0 0 0 1'));
  const child = world.create(definition(2, 'slot 0 0 0.5 0 0 0 2'));
  world.install(root, 1, child, 2);
  const original = child.matrix(), draw = modelMatrix(original);
  assert.deepEqual(new Vector3(0, 0, 50).applyMatrix4(draw).toArray(), [0, 0, -2]);
  assert.deepEqual(new Vector3().applyMatrix4(draw).toArray(), [0, 0, -2.5]);
  assert.deepEqual(child.matrix(), original);
  root.local.makeRotationY(Math.PI / 2);
  const mount = new Vector3(0, 0, 50).applyMatrix4(modelMatrix(child.matrix()));
  assert.ok(mount.distanceTo(new Vector3(-2, 0, 0)) < 1e-12);
  world.dispose();
});

test('CFG preserves ordered stock, repeated attachments, physical data and unknown commands', () => {
  const cfg = parsePartConfig(`#comment\nslot 1 2 3 0.2 0.4 0.6 7\nattach 0x06 8 ; note\nattach 0x09 10\nstockpart 0x10\n#stockpart 0x11\nstockpart 0x10 // repeated\nbody 0 0 0 0 0 0 12.5 sphere 0.3\nwheel 1 0 2 0 0 0 1 0 1 0\nrender 0x01\ndeformable 0x02\neof`);
  assert.deepEqual(cfg.stock, [16, 16]); assert.equal(cfg.slots[0].attach.length, 2);
  assert.equal(cfg.render, 2); assert.equal(cfg.bodies[0].mass, 12.5); assert.equal(cfg.wheels.length, 1);
  assert.equal(cfg.unknown[0].command, 'eof');
  for (const source of ['slot 0 0 0 0 0 0 1\nslot 0 0 0 0 0 0 1', 'attach 0x01 2', 'body 0 0 0 0 0 0 -1 sphere 1', 'slot NaN 0 0 0 0 0 1', 'stockpart 0x100000000']) assert.throws(() => parsePartConfig(source));
});
const definition = (id: number, cfg: string): PartDefinition => ({ key: { pack: 'test.rpk', id }, alias: String(id), cfgPath: `${id}.cfg`, config: parsePartConfig(cfg) });

test('world aligns both mount frames, moves descendants, detaches in place and rejects broken ownership', () => {
  const world = new EngineWorld();
  const root = world.create(definition(1, 'slot 1 2 3 0.4 0.2 -0.1 7'));
  const child = world.create(definition(2, 'slot 2 3 4 -0.2 0.6 0.5 8\nslot 0 2 0 0 0 0 9'));
  const leaf = world.create(definition(3, 'slot 0 0 1 0 0 0 10'));
  world.install(root, 7, child, 8); world.install(child, 9, leaf, 10);
  const a = root.matrix().multiply(poseMatrix(root.definition.config.slots[0]));
  const b = child.matrix().multiply(poseMatrix(child.definition.config.slots[0]));
  a.elements.forEach((n, i) => assert.ok(Math.abs(n - b.elements[i]) < 1e-12));
  const before = new Vector3().setFromMatrixPosition(leaf.matrix()); root.local.makeTranslation(10, 0, 0);
  assert.ok(Math.abs(new Vector3().setFromMatrixPosition(leaf.matrix()).x - before.x - 10) < 1e-12);
  assert.throws(() => world.install(leaf, 10, root, 7), /cycle/);
  assert.throws(() => world.install(root, 7, leaf, 10), /Occupied/);
  const foreign = new EngineWorld().create(child.definition); assert.throws(() => world.install(root, 7, foreign, 8), /outside/);
  const matrix = child.matrix(); world.detach(child); assert.deepEqual(child.matrix(), matrix);
  assert.equal(root.children.size, 0); world.dispose(); assert.equal(world.parts.size, 0);
  assert.throws(() => world.create(root.definition), /disposed/); assert.throws(() => world.advance(0), /disposed/);
});

test('factory retries out-of-order stock, honors nested stock and resolves dependency namespaces', async () => {
  const configs = new Map([
    ['1.cfg', 'slot 0 0 0 0 0 0 5\nstockpart 0x03\nstockpart 0x02\nstockpart 0x05'],
    ['2.cfg', 'slot 0 0 0 0 0 0 6\nattach 0x01 5\nslot 0 0 0 0 0 0 7\nstockpart 0x04'],
    ['3.cfg', 'slot 0 0 0 0 0 0 8\nattach 0x02 7'],
    ['4.cfg', 'slot 0 0 0 0 0 0 9\nattach 0x03 8'], // Incoming mount cannot accept a second child.
    ['5.cfg', 'slot 0 0 0 0 0 0 10'],
  ]);
  const encoder = new TextEncoder();
  const assets = new Assets([...configs].map(([path]) => ({ path, size: 0 })), async path => encoder.encode(configs.get(path)!));
  const pack: RpkPack = { version: 512, dependencies: [{ id: 0x10000, path: 'test.rpk', trailer: 0 }], warnings: [], entries: [...configs.keys()].map((_, i) => ({ typeId: i + 1, superId: 0, type: 8, flags: 0, compatibility: 1, offset: 0, size: 0, alias: String(i + 1), data: encoder.encode(`native part ${i + 1}.cfg`) })) };
  assets.pack = async () => pack;
  const factory = new PartFactory(assets), built = await factory.stock({ pack: 'test.rpk', id: 0x10001 });
  assert.equal(built.world.parts.size, 3); assert.equal(built.warnings.length, 2);
  const last = [...built.world.parts.values()].find(p => p.definition.key.id === 3)!;
  assert.equal(last.parent!.definition.key.id, 2);
  assert.deepEqual(await assets.resourceLocation('test.rpk', 0x1abcd), { packPath: 'test.rpk', id: 0xabcd });
  assert.throws(() => built.world.install(last, 8, built.root, 5), /cycle/);
  built.world.dispose();
  configs.set('5.cfg', 'slot bad');
  await assert.rejects(() => new PartFactory(assets).stock({ pack: 'test.rpk', id: 1 }), /CFG line/);
});
