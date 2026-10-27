import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Assets } from '../src/assets';
import { bootGame } from '../src/runtime/game-boot';

const root = process.argv.slice(2).find(arg => !arg.startsWith('--')) ?? 'C:/Program Files (x86)/Steam/steamapps/common/Street Legal Racing Redline';
const classOnly = process.argv.includes('--class-only');
const names = (await readdir(join(root, 'sl/Scripts/game/src')))
  .filter(name => name.toLowerCase().endsWith('.java')).map(name => `sl/Scripts/game/src/${name}`);
const systemNames = (await readdir(join(root, 'system/scripts'), { recursive: true }))
  .filter(name => (classOnly ? /\.class$/i : /\.(java|class)$/i).test(name))
  .map(name => `system/scripts/${name.replaceAll('\\', '/')}`);
const files = await Promise.all([...names, ...systemNames].map(async path => {
  return { path, size: (await stat(join(root, path))).size };
}));
const assets = new Assets(files, async path => new Uint8Array(await readFile(join(root, path))));
const result = await bootGame(assets, event => process.stdout.write(`${event.level}: ${event.message}\n`));
const expected = 'Java native implementation missing: java.io.Controller.user_Reset()';
if (!result.error?.message.includes(expected)) {
  process.stderr.write(`Expected current implementation boundary: ${expected}\n`);
  process.exitCode = 1;
}
