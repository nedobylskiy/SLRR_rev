import { readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

export const defaultGameRoot = 'C:/Program Files (x86)/Steam/steamapps/common/Street Legal Racing Redline';
export const gameRoot = path.resolve(process.env.SLRR_GAME_ROOT ?? defaultGameRoot);

export async function walk(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) files.push(...await walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files.sort();
}

export function relativeGamePath(file: string) { return path.relative(gameRoot, file).replaceAll('\\', '/'); }

export async function safeGamePath(requested: string) {
  const base = await realpath(gameRoot);
  const target = await realpath(path.resolve(base, requested.replaceAll('\\', '/')));
  const relative = path.relative(base, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Path outside game root');
  return target;
}
