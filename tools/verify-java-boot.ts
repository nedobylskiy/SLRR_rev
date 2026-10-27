import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Assets } from '../src/assets';
import { bootGame } from '../src/runtime/game-boot';

const root = process.argv[2] ?? 'C:/Program Files (x86)/Steam/steamapps/common/Street Legal Racing Redline';
const names = (await readdir(join(root, 'sl/Scripts/game/src'))).filter(name => name.toLowerCase().endsWith('.java'));
const files = await Promise.all(names.map(async name => {
  const path = `sl/Scripts/game/src/${name}`;
  return { path, size: (await stat(join(root, path))).size };
}));
const assets = new Assets(files, async path => new Uint8Array(await readFile(join(root, path))));
const result = await bootGame(assets, event => process.stdout.write(`${event.level}: ${event.message}\n`));
const expected = 'Scene.<fields> (source line 30): Java constructor/native missing: Vector3()';
if (!result.error?.message.includes(expected)) {
  process.stderr.write(`Expected current implementation boundary: ${expected}\n`);
  process.exitCode = 1;
}
