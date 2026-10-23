import { readFile } from 'node:fs/promises';
import { parseTufa } from '../src/formats/tufa';
if (!process.argv[2]) throw new Error('Usage: npm run inspect:class -- path/to/file.class');
for (const c of parseTufa(await readFile(process.argv[2]))) console.log(JSON.stringify({ name: c.name, superName: c.superName, version: `0x${c.version.toString(16)}`, methods: c.methods.map(m => ({ ...m, nodeCount: c.trees[m.tree]?.length ?? 0 })) }, null, 2));
