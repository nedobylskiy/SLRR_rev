import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { gameRoot } from './game-files';
import { PartAssemblyRuntime } from '../src/runtime/part-assembly';
import { createPartDemo, describeAssembly, partSourcePaths } from '../src/runtime/part-demo';
import { parseSdat, serializeSdat } from '../src/formats/sdat';

const runtime = new PartAssemblyRuntime();
const sources = partSourcePaths;
const provenance = [];
for (const path of sources) {
  const bytes = await readFile(`${gameRoot}/${path}`), cls = runtime.registerSource(bytes.toString('latin1'));
  provenance.push({ path, sha256: createHash('sha256').update(bytes).digest('hex'), methods: cls.methods.map(m => m.name) });
}
const original = createPartDemo(runtime), root = original.root!;
const bytes = runtime.serialize(root), saveTrace = [...runtime.trace];
const restored = runtime.restore(bytes), loadTrace = [...runtime.trace];
assert.equal(restored.parts.size, 10);
assert.deepEqual(describeAssembly(restored.root!), describeAssembly(root));
assert.equal(restored.root!.mileage, root.mileage);
assert.equal(restored.root!.fields.get('brake_balance')!.value, root.fields.get('brake_balance')!.value);
assert.deepEqual(restored.root!.wheelDamage, root.wheelDamage);
assert.deepEqual(runtime.serialize(restored.root!), bytes);
assert.ok(saveTrace.includes('Part.save') && saveTrace.includes('Chassis.save') && saveTrace.includes('Tyre.save') && saveTrace.includes('ShockAbsorber.save'));
assert.ok(loadTrace.includes('Part.createFromFile') && loadTrace.includes('Part.load') && loadTrace.includes('Chassis.load') && loadTrace.includes('Tyre.load') && loadTrace.includes('ShockAbsorber.load'));
const baseline = { ...runtime.liveCounts };
for (let i = 0; i < 1000; i++) { const copy = runtime.restore(bytes); assert.deepEqual(runtime.serialize(copy.root!), bytes); copy.dispose(); }
assert.deepEqual(runtime.liveCounts, baseline);
const corrupted = parseSdat(bytes); new DataView(corrupted.payload.buffer).setFloat32(corrupted.payload.length - 4, NaN, true);
assert.throws(() => runtime.restore(serializeSdat(corrupted), original), /finite/i);
assert.equal(original.disposed, false); assert.deepEqual(runtime.liveCounts, baseline); assert.deepEqual(runtime.serialize(root), bytes);
const shock = root.slots.find(s => s.id === 201)!.child!; shock.setFloat('damping', -5);
const clamped = runtime.restore(runtime.serialize(root));
assert.equal(clamped.root!.slots.find(s => s.id === 201)!.child!.fields.get('damping')!.value, 100); clamped.dispose(); shock.setFloat('damping', 1500);
restored.root!.setFloat('brake_balance', 0.2); assert.notEqual(restored.root!.fields.get('brake_balance')!.value, root.fields.get('brake_balance')!.value);
restored.dispose(); original.dispose(); assert.deepEqual(runtime.liveCounts, { worlds: 0, parts: 0, resources: 0 });
const report = { sources: provenance, bytes: bytes.length, parts: 10, repeatedRoundTrips: 1000, lateFailureRollback: true, originalShockClamp: true, saveTrace, loadTrace, finalLiveCounts: runtime.liveCounts };
await mkdir('local', { recursive: true }); await writeFile('local/parts-verification.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
