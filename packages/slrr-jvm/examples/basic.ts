import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SlrrJvm, jv } from 'slrr-jvm';

const exampleDir = dirname(fileURLToPath(import.meta.url));
const files = new Map([
  ['demo.Main', 'Main.java'],
  ['demo.Helper', 'Helper.java']
]);

const jvm = new SlrrJvm({
  resolveImport: ({ className }) => {
    if (className === 'demo.HostMath') return null; // Supplied by the embedding host.
    const file = files.get(className);
    return file ? { path: join(exampleDir, 'java', file) } : null;
  },
  readSource: path => readFile(path, 'utf8'),
  selectMethods: className => className === 'demo.Main' ? ['run'] : ['twice']
});

jvm.natives.register('demo.HostMath', 'offset', [], () => jv('int', 3));
await jvm.loadClass('demo.Main');
const main = jvm.construct('demo.Main', []);
const result = jvm.invoke(main, 'run', [jv('int', 5)]);
console.log(result.value); // 13: Helper.twice(5) + HostMath.offset()
