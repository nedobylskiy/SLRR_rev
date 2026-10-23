import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { gameRoot, walk, relativeGamePath } from './game-files';
import { parseTufa } from '../src/formats/tufa';
import { parseRpk, entryProperties } from '../src/formats/rpk';

const files = await walk(gameRoot);
const extensions: Record<string, { count: number; bytes: number }> = {};
const signatures: Record<string, Record<string, number>> = {};
const packages: object[] = [], classes: object[] = [], nativeCandidates: object[] = [], hooks: object[] = [], errors: object[] = [], binaries: object[] = [];
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
for (const file of files) {
  const rel = relativeGamePath(file), ext = path.extname(file).toLowerCase(), size = (await stat(file)).size;
  const counts = extensions[ext || '(none)'] ??= { count: 0, bytes: 0 }; counts.count++; counts.bytes += size;
  if (!['.rpk', '.class', '.scx', '.exe', '.dll', '.java'].includes(ext)) continue;
  const b = await readFile(file);
  if (['.rpk', '.class', '.scx'].includes(ext)) {
    const key = `${b.subarray(0, 4).toString('latin1')}:${b.length >= 12 ? b.readUInt32LE(ext === '.class' ? 8 : 4) : '?'}`;
    const s = signatures[ext] ??= {}; s[key] = (s[key] ?? 0) + 1;
  }
  try {
    if (ext === '.rpk') {
      const p = parseRpk(b);
      packages.push({ path: rel, size, sha256: hash(b), dependencies: p.dependencies, entries: p.entries.length, types: [...new Set(p.entries.map(e => e.type))], warnings: p.warnings });
      for (const e of p.entries) for (const prop of entryProperties(e)) if (prop.key === 'native') nativeCandidates.push({ path: rel, resource: e.typeId, alias: e.alias, binding: prop.value });
    }
    if (ext === '.class') {
      for (const c of parseTufa(b)) {
        classes.push({ path: rel, name: c.name, superName: c.superName, version: c.version, methods: c.methods.length, constants: c.constants.length, trees: c.trees.length, nodes: c.trees.reduce((n, t) => n + t.length, 0) });
        // Empty TREE is not proof of native: flag semantics must be established separately.
        for (const m of c.methods) if (!c.trees[m.tree]?.length) nativeCandidates.push({ path: rel, class: c.name, ...m, evidence: 'empty-or-absent-tree; native/abstract/declaration candidate, not confirmed native' });
      }
    }
    if (ext === '.java') {
      const text = b.toString('latin1');
      for (const [i, line] of text.split(/\r?\n/).entries()) {
        if (/\bnative\s+(?:\w+\s+){1,3}\w+\s*\(/.test(line)) nativeCandidates.push({ path: rel, line: i + 1, declaration: line.trim() });
        const terms = line.match(/\b(runDLL|runMethod|libcall|libffi|loadlibrary|winsock|socket|httpRequest|GM_MULTIPLAYER|CMD_MULTIPLAYER)\b/gi);
        if (terms && !/^\s*\/\//.test(line) && !/description\s*=/.test(line)) hooks.push({ path: rel, line: i + 1, terms: [...new Set(terms)] });
      }
    }
    if (ext === '.exe' || ext === '.dll') {
      const pe = b.readUInt32LE(0x3c), machine = b.readUInt16LE(pe + 4), optional = pe + 24;
      binaries.push({ path: rel, size, sha256: hash(b), machine: `0x${machine.toString(16)}`, imageBase: `0x${b.readUInt32LE(optional + 28).toString(16)}` });
    }
  } catch (e) { errors.push({ path: rel, error: String(e) }); }
}
await mkdir('docs/reports', { recursive: true });
await writeFile('docs/reports/inventory.json', JSON.stringify({ generated: new Date().toISOString(), totalFiles: files.length, extensions, signatures, packages, binaries, errors }, null, 2));
await writeFile('docs/reports/classes.json', JSON.stringify(classes, null, 2));
await writeFile('docs/reports/native-candidates.json', JSON.stringify(nativeCandidates, null, 2));
await writeFile('docs/reports/integration-clues.json', JSON.stringify(hooks, null, 2));
console.log(JSON.stringify({ files: files.length, extensions, signatures, packages: packages.length, classes: classes.length, nativeCandidates: nativeCandidates.length, integrationClues: hooks.length, errors }, null, 2));
