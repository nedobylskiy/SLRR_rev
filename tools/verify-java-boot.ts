import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Assets } from '../src/assets';
import { jv } from 'slrr-jvm';
import { bootGame } from '../src/runtime/game-boot';

const root = process.argv.slice(2).find(arg => !arg.startsWith('--')) ?? 'C:/Program Files (x86)/Steam/steamapps/common/Street Legal Racing Redline';
const classOnly = process.argv.includes('--class-only');
const names = (await readdir(join(root, 'sl/Scripts/game/src')))
  .filter(name => name.toLowerCase().endsWith('.java')).map(name => `sl/Scripts/game/src/${name}`);
const systemNames = (await readdir(join(root, 'system/scripts'), { recursive: true }))
  .filter(name => (classOnly ? /\.class$/i : /\.(java|class)$/i).test(name))
  .map(name => `system/scripts/${name.replaceAll('\\', '/')}`);
const carNames = ['cars.rpk', ...(await readdir(join(root, 'cars'), { recursive: true }))
  .filter(name => /\.(rpk|java|cfg)$/i.test(name)).map(name => `cars/${name.replaceAll('\\', '/')}`)];
const eventNames = (await readdir(join(root, 'sl/Scripts/game/CareerEvents'), { recursive: true }))
  .filter(name => /\.(rpk|java)$/i.test(name))
  .map(name => `sl/Scripts/game/CareerEvents/${name.replaceAll('\\', '/')}`);
const trackNames = (await readdir(join(root, 'multibot/maps'), { recursive: true }))
  .filter(name => /(?:^|[\\/])t_data\.rpk$|[\\/]data[\\/]src[\\/][^\\/]+\.java$/i.test(name))
  .map(name => `multibot/maps/${name.replaceAll('\\', '/')}`);
const gamemodeNames = (await readdir(join(root, 'sl/Scripts/game/Gamemodes'), { recursive: true }))
  .filter(name => /\.(rpk|java)$/i.test(name))
  .map(name => `sl/Scripts/game/Gamemodes/${name.replaceAll('\\', '/')}`);
const partNames = ['parts.rpk', ...(await readdir(join(root, 'parts'), { recursive: true }))
  .filter(name => /\.(rpk|java)$/i.test(name)).map(name => `parts/${name.replaceAll('\\', '/')}`)];
const files = await Promise.all([...names, ...systemNames, ...carNames, ...eventNames, ...trackNames, ...gamemodeNames, ...partNames, 'system.rpk'].map(async path => {
  return { path, size: (await stat(join(root, path))).size };
}));
const assets = new Assets(files, async path => new Uint8Array(await readFile(join(root, path))));
const result = await bootGame(assets, event => process.stdout.write(`${event.level}: ${event.message}\n`));
const expected = 'Java native implementation missing: java.game.parts.Part.setWear(float)';
if (!result.error?.message.includes(expected)) {
  process.stderr.write(`Expected current implementation boundary: ${expected}\n`);
  process.exitCode = 1;
}
if (result.input.registeredHotkeys() < 5) {
  process.stderr.write('GameLogic did not register its global hotkeys\n');
  process.exitCode = 1;
}
const mounted = result.gameTypes.roots();
const vehicles = mounted.filter(node => /_VT\.class$/i.test(node.resourceScript ?? '')).length;
const events = mounted.filter(node => /CareerEvents[\\/]\w+\.class$/i.test(node.resourceScript ?? '')).length;
if (vehicles < 25 || events < 59) {
  process.stderr.write(`Scripted resource factories incomplete: ${vehicles} vehicle types, ${events} career events\n`);
  process.exitCode = 1;
}
const trackData = mounted.filter(node => /[\\/]track_data\.class$/i.test(node.resourceScript ?? ''));
if (trackData.length < 5 || new Set(trackData.map(node => node.className)).size < 5) {
  process.stderr.write(`Pack-scoped track scripts incomplete: ${trackData.length} instances, ${new Set(trackData.map(node => node.className)).size} classes\n`);
  process.exitCode = 1;
}
const nodes = mounted.flatMap(function visit(node: (typeof mounted)[number]): typeof mounted {
  return [node, ...[...node.children].flatMap(visit)];
});
if (!nodes.some(node => /[\\/]seat_Torino\.class$/i.test(node.resourceScript ?? '')
  && node.className === 'java.game.parts.interior.seat_Torino')) {
  process.stderr.write('Prize part did not resolve to its Java class\n');
  process.exitCode = 1;
}
const tracks = result.jvm.get(jv('class', 'java.game.GameLogic'), 'mapStack').value;
if (!Array.isArray(tracks) || tracks.length < 19) {
  process.stderr.write(`Track metadata catalog incomplete: ${Array.isArray(tracks) ? tracks.length : 0} tracks\n`);
  process.exitCode = 1;
}
result.input.poll();
if (process.argv.includes('--hotkey-smoke')) {
  result.input.setPhysicalAxis(0, 88, 1);
  try { result.input.poll(); process.stdout.write('Hotkey smoke: no Java callback\n'); }
  catch (error) { process.stdout.write(`Hotkey smoke: ${String(error)}\n`); }
}
