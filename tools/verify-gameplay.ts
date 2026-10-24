import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Assets } from '../src/assets';
import { PartFactory } from '../src/engine/world';
import { PART_CLASS, PART_TOPOLOGY_NATIVES, PartHost } from '../src/engine/part-host';
import { parseTufa } from '../src/formats/tufa';
import type { ScriptObject } from '../src/runtime/native-registry';
import { gameRoot, walk, relativeGamePath, safeGamePath } from './game-files';

const paths = ['parts/scripts/Part.class', 'parts/scripts/WheelRef.class', 'parts/scripts/bodypart/Chassis.class', 'system/scripts/util/resource/GameRef.class', 'system/scripts/io/Controller.class'];
const classes = [];
for (const path of paths) {
  const bytes = await readFile(await safeGamePath(path)), cls = parseTufa(bytes)[0];
  const nativeMethods = cls.methods.filter(m => m.flags & 0x40).map(m => ({ name: m.name, descriptor: m.signature }));
  classes.push({ path, sha256: createHash('sha256').update(bytes).digest('hex'), className: cls.name, superName: cls.superName, nativeMethods });
}
const declared = classes.find(c => c.className === PART_CLASS)!;
for (const [name, descriptor] of PART_TOPOLOGY_NATIVES) assert.ok(declared.nativeMethods.some(m => m.name === name && m.descriptor === descriptor), `Installed native declaration missing: ${name}${descriptor}`);
const files = (await walk(gameRoot)).map(file => ({ path: relativeGamePath(file), size: 0 }));
const assets = new Assets(files, async path => new Uint8Array(await readFile(await safeGamePath(path))));
const { world, root } = await new PartFactory(assets).stock({ pack: 'cars/racers/Baiern.rpk', id: 6 });
const host = new PartHost(world), visited = new Set<ScriptObject>();
const call = (name: string, descriptor: string, object: ScriptObject, args: number[] = []) => host.natives.invoke(PART_CLASS, name, descriptor, object, args);
function visit(object: ScriptObject) {
  assert.ok(!visited.has(object), 'Repeated instance in native traversal'); visited.add(object);
  const ownSlot = call('getSlotID', '(I)I', object, [-1]);
  const count = call('getSlots', '()I', object) as number;
  for (let i = 0; i < count; i++) {
    const slot = call('getSlotID', '(I)I', object, [i]) as number;
    if (slot === ownSlot) continue;
    const child = call('partOnSlot', '(I)Ljava.game.parts.Part;', object, [slot]) as ScriptObject | null;
    if (!child) { assert.equal(call('slotIDOnSlot', '(I)I', object, [slot]), 0); continue; }
    const back = call('slotIDOnSlot', '(I)I', object, [slot]) as number;
    assert.equal(call('partOnSlot', '(I)Ljava.game.parts.Part;', child, [back]), object);
    assert.equal(call('slotIDOnSlot', '(I)I', child, [back]), slot);
    visit(child);
  }
}
visit(host.bind(root)); assert.equal(visited.size, world.parts.size);
const report = { scope: 'Direct descriptor-aware native calls on the real CFG world; no general TUFA execution or physics', traversedWorldParts: visited.size, implementedWorldNatives: host.natives.signatures, classes };
await mkdir('local', { recursive: true }); await writeFile('local/gameplay-contracts.json', JSON.stringify(report, null, 2));
host.dispose(); world.dispose();
console.log(JSON.stringify({ traversedWorldParts: visited.size, implementedWorldNatives: report.implementedWorldNatives, declarations: classes.map(c => ({ className: c.className, nativeCount: c.nativeMethods.length })), report: 'local/gameplay-contracts.json' }, null, 2));
