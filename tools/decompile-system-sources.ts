import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, parse } from 'node:path';
import { decompileClass, parseTufa } from 'slrr-jvm-decompiler';
import { gameRoot, walk } from './game-files';

const root = process.argv[2] ?? gameRoot;
const scripts = join(root, 'system', 'scripts');
let created = 0, existing = 0;
for (const file of await walk(scripts)) {
  if (!file.toLowerCase().endsWith('.class')) continue;
  for (const cls of parseTufa(new Uint8Array(await readFile(file)))) {
    const { source, diagnostics } = decompileClass(cls);
    if (diagnostics.length) throw new Error(`${file}: ${diagnostics.join('; ')}`);
    const output = join(dirname(file), 'src', `${cls.name.split('.').at(-1) ?? parse(file).name}.java`);
    await mkdir(dirname(output), { recursive: true });
    try { await writeFile(output, source, { flag: 'wx' }); created++; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      existing++;
    }
  }
}
console.log(`System Java sources: ${created} created, ${existing} already present in ${scripts}`);
