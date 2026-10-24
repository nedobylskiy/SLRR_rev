import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { Assets } from '../src/assets';
import { parsePartConfig } from '../src/formats/cfg';
import { PartFactory, poseMatrix } from '../src/engine/world';
import { slotMatrix } from '../src/engine/slot-frames';
import type { RpkPack } from '../src/formats/rpk';

test('typed frames depend on slottype, preserve local offsets and do not inherit the preceding wheel accidentally', () => {
  const cfg = parsePartConfig('steering -0.4 0.2 -0.6 0 -0.5 0\ntype 10 sphere 0.32\nwheel -0.8 -0.6 -1.4 0.1 0 0 1 0 1 0\nwheel 0.8 -0.6 -1.4 0 0 0 1 0 1 0\nslot 0.1 0 0 0 0 0 987\nslottype 101\nslot 0 0 0 3.142 0 0 333\nslottype 102\nslot 0 0 0 0 0 0 444\nslottype 11\nslot 1 2 3 0 0 0 123');
  const position = (i: number) => new Vector3().setFromMatrixPosition(slotMatrix(cfg, cfg.slots[i]));
  assert.ok(position(0).distanceTo(new Vector3(-0.8 + 0.1 * Math.cos(0.1), -0.6, -1.4 - 0.1 * Math.sin(0.1))) < 1e-12);
  assert.deepEqual(position(1).toArray(), [0.8, -0.6, -1.4]);
  assert.deepEqual(position(2).toArray(), [-0.4, 0.2, -0.6]);
  assert.deepEqual(position(3).toArray(), [1, 2, 3]);
  assert.equal(cfg.wheels[0].radius, 0.32);
  assert.ok(new Vector3(1, 0, 0).transformDirection(slotMatrix(cfg, cfg.slots[1])).x < -0.99);
  const render = parsePartConfig('render 0x000001r 0.1 0.2 0.3 3.142 0 0\nstockpart 0x000000002r');
  assert.deepEqual(render.renderPose!.position, [0.1, 0.2, 0.3]); assert.equal(render.stock[0], 2);
  assert.throws(() => slotMatrix(cfg, { ...cfg.slots[0], type: 105 }), /missing/);
  assert.throws(() => slotMatrix(cfg, { ...cfg.slots[0], type: 201 }), /Unsupported/);
});

test('compatible aliases are transitive, cycle safe, pack scoped, slot scoped and cannot create attachments alone', async () => {
  const cfgs = [
    'slot 0 0 0 0 0 0 8\nattach 0x10003 55\nstockpart 0x02',
    'slot 0 0 0 0 0 0 91\ncompatible 0x04 66',
    'slot 0 0 0 0 0 0 55',
    'slot 0 0 0 0 0 0 66\ncompatible 0x10003 55\ncompatible 0x02 91',
  ];
  const encoder = new TextEncoder();
  const pack: RpkPack = { version: 512, warnings: [], dependencies: [{ id: 0x10000, path: 'alias.rpk', trailer: 0 }], entries: cfgs.map((_, i) => ({ typeId: i + 1, superId: 0, type: 8, flags: 0, compatibility: 1, offset: 0, size: 0, alias: String(i + 1), data: encoder.encode(`native part ${i + 1}.cfg`) })) };
  const assets = new Assets(cfgs.map((_, i) => ({ path: `${i + 1}.cfg`, size: 0 })), async path => encoder.encode(cfgs[parseInt(path) - 1]));
  assets.pack = async () => pack;
  const build = () => new PartFactory(assets).stock({ pack: 'car.rpk', id: 1 });
  const first = await build(); assert.equal(first.world.parts.size, 2); assert.equal(first.root.children.get(8)!.ownSlot, 91); first.world.dispose();
  cfgs[0] = cfgs[0].replace('0x10003 55', '0x10003 56');
  const wrongSlot = await build(); assert.equal(wrongSlot.world.parts.size, 1); assert.equal(wrongSlot.warnings.length, 1); wrongSlot.world.dispose();
  cfgs[0] = cfgs[0].replace('0x10003 56', '0x03 55');
  const wrongPack = await build(); assert.equal(wrongPack.world.parts.size, 1); wrongPack.world.dispose();
  cfgs[0] = cfgs[0].replace('attach 0x03 55', 'compatible 0x10003 55');
  const noAttach = await build(); assert.equal(noAttach.world.parts.size, 1); noAttach.world.dispose();
});
