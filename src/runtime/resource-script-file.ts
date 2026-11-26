import { Assets, normalizePath, type Asset } from '../assets';
import { tufaClassName } from '../formats/tufa-class-name';

/** RPKs store script filenames; saved parts can store qualified Java class names. */
export async function resourceScriptFile(assets: Assets, script: string,
  sources: ReadonlyMap<string, readonly string[]>, classes: ReadonlyMap<string, readonly string[]>): Promise<Asset> {
  const normalized = normalizePath(script);
  if (/^java(?:\.[\w$]+)+$/i.test(script)) {
    const name = `${script.split('.').at(-1)!.toLowerCase()}`;
    for (const path of sources.get(`${name}.java`) ?? []) {
      const source = new TextDecoder().decode(await assets.read(path));
      const pkg = /\bpackage\s+([\w.]+)\s*;/.exec(source)?.[1];
      const declared = [...source.matchAll(/\bclass\s+([\w$]+)/g)];
      if (declared.some(match => `${pkg}.${match[1]}`.toLowerCase() === normalized))
        return assets.byPath.get(normalizePath(path))!;
    }
    for (const path of classes.get(`${name}.class`) ?? []) {
      if (tufaClassName(await assets.read(path)).toLowerCase() === normalized)
        return assets.byPath.get(normalizePath(path))!;
    }
  } else {
    const source = normalized.endsWith('.class') ? normalized.replace(/\/([^/]+)\.class$/, '/src/$1.java') : normalized;
    const file = assets.byPath.get(source) ?? assets.byPath.get(normalized);
    if (file) return file;
  }
  throw new Error(`Resource Java source missing: ${script}`);
}
