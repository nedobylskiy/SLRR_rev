import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseRpk } from '../src/formats/rpk';
import { parseScx } from '../src/formats/scx';
import { parseTufa } from '../src/formats/tufa';
import { gameRoot, walk, relativeGamePath } from './game-files';

const parsers = { '.rpk': parseRpk, '.scx': parseScx, '.class': parseTufa };
const result: Record<string, { passed: number; expectedInvalid: string[]; failed: { path: string; error: string }[]; versions: Record<string, number> }> = {};
for (const [ext] of Object.entries(parsers)) result[ext] = { passed: 0, expectedInvalid: [], failed: [], versions: {} };
for (const file of await walk(gameRoot)) {
  const ext = path.extname(file).toLowerCase() as keyof typeof parsers;
  if (!(ext in parsers)) continue;
  const row = result[ext];
  try {
    const bytes = await readFile(file);
    if (relativeGamePath(file) === 'modding_tools/Map tools/maps/sample/meshes/sample.scx' && bytes.length === 0) {
      row.expectedInvalid.push(relativeGamePath(file)); continue;
    }
    const parsed = parsers[ext](bytes);
    row.passed++;
    const version = Array.isArray(parsed) ? parsed.map(c => c.version).join(',') : String(parsed.version);
    row.versions[version] = (row.versions[version] ?? 0) + 1;
  } catch (e) { row.failed.push({ path: relativeGamePath(file), error: String(e) }); }
}
await mkdir('local', { recursive: true });
await writeFile('local/verification.json', JSON.stringify({ generated: new Date().toISOString(), result }, null, 2));
for (const [ext, row] of Object.entries(result)) console.log(ext, 'passed:', row.passed, 'expected-invalid:', row.expectedInvalid.length, 'failed:', row.failed.length, 'versions:', row.versions, '\n', row.failed.slice(0, 8));
if (Object.values(result).some(r => r.failed.length)) process.exitCode = 1;
