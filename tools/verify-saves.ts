import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { walk, gameRoot, relativeGamePath } from './game-files';
import { parseSdat, inspectSavedVehicle, serializeSdat } from '../src/formats/sdat';

const result = { sdat: 0, vehicles: 0, embeddedResources: 0, failed: [] as { path: string; error: string }[] };
for (const f of await walk(`${gameRoot}/save`)) {
  const b = await readFile(f);
  if (b.subarray(0, 4).toString('ascii') !== 'SDAT') continue;
  try {
    const sdat = parseSdat(b);
    assert.deepEqual(serializeSdat(sdat), new Uint8Array(b), 'SDAT bytes must survive in-memory decode/encode exactly');
    result.sdat++; result.embeddedResources += sdat.unsaved.length;
    if (sdat.payload.length >= 4 && new DataView(sdat.payload.buffer, sdat.payload.byteOffset, sdat.payload.byteLength).getUint32(0, true) === 0x88664422) { inspectSavedVehicle(b); result.vehicles++; }
  } catch (e) { result.failed.push({ path: relativeGamePath(f), error: String(e) }); }
}
await mkdir('local', { recursive: true });
await writeFile('local/save-verification.json', JSON.stringify(result, null, 2));
console.log(result);
if (result.failed.length) process.exitCode = 1;
