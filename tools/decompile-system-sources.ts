import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, parse } from 'node:path';
import { decompileClass, parseTufa } from 'slrr-jvm-decompiler';
import { gameRoot, walk } from './game-files';

const overwrite = process.argv.includes('--overwrite');
const root = process.argv.slice(2).find(arg => !arg.startsWith('--')) ?? gameRoot;
const scripts = join(root, 'system', 'scripts');
const selected = new Map<string, { file: string; cls: ReturnType<typeof parseTufa>[number]; output: string }>();
let duplicates = 0;
for (const file of await walk(scripts)) {
  if (!file.toLowerCase().endsWith('.class')) continue;
  for (const cls of parseTufa(new Uint8Array(await readFile(file)))) {
    const simpleName = cls.name.split('.').at(-1) ?? parse(file).name;
    // Keep recovered Java away from the original game's auto-compiled src folders.
    const output = join(dirname(file), 'decompiled', `${simpleName}.java`);
    const key = output.toLowerCase();
    const previous = selected.get(key);
    if (previous) duplicates++;
    // Some TUFA containers repeat classes also stored in their own files.
    // The dedicated class file is the canonical source when the copies differ.
    if (!previous || (parse(previous.file).name !== simpleName && parse(file).name === simpleName))
      selected.set(key, { file, cls, output });
  }
}
let created = 0, updated = 0, existing = 0;
for (const { file, cls, output } of selected.values()) {
  const { source, diagnostics } = decompileClass(cls);
  if (diagnostics.length) throw new Error(`${file}: ${diagnostics.join('; ')}`);
  await mkdir(dirname(output), { recursive: true });
  if (overwrite) {
    let previous: string | null = null;
    try { previous = await readFile(output, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (previous === source) { existing++; continue; }
    await writeFile(output, source);
    if (previous === null) created++; else updated++;
    continue;
  }
  try { await writeFile(output, source, { flag: 'wx' }); created++; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    existing++;
  }
}
console.log(`System Java sources: ${created} created, ${updated} updated, ${existing} unchanged or already present, ${duplicates} duplicate class entries in ${scripts}`);
