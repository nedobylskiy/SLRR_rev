/** Run a real, self-contained class from the user's SLRR MainMenu.java source. */
import { readFile } from 'node:fs/promises';
import { SlrrJvm, jv } from '../src/index.js';

const path = process.argv[2];
if (!path) throw new Error('Usage: npm run example:game -- PATH_TO_MainMenu.java');

const source = await readFile(path, 'latin1');
const jvm = new SlrrJvm({
  resolveImport: ({ className }) => className === 'java.game.ColorBank' ? { path, source } : null,
});
await jvm.loadClass('java.game.ColorBank');
const bank = jvm.construct('java.game.ColorBank', []);
for (const id of [0, 1, 23, 37]) {
  const color = Number(jvm.invoke(bank, 'getColor', [jv('int', id)]).value) >>> 0;
  console.log(`${id}: 0x${color.toString(16).padStart(8, '0')}`);
}
