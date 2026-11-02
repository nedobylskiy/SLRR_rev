import { jv, type JavaObject, type JavaValue, type SlrrJvm } from 'slrr-jvm';
import { normalizePath, type Assets } from '../assets';
import type { VirtualFileSystem } from './virtual-file-system';

interface Found { name: string; directory: boolean }
interface Search { matches: Found[]; nextIndex: number }

/** The server adapter has already supplied this catalog through /api/game/index. */
export interface FileCatalogAdapter { paths(): readonly string[] }
export class AssetCatalogAdapter implements FileCatalogAdapter {
  constructor(private readonly assets: Assets) {}
  paths(): readonly string[] { return this.assets.files.map(file => file.path); }
}

function matcher(pattern: string): RegExp {
  const glob = pattern === '*.*' ? '*' : pattern;
  const escaped = [...glob].map(char => char === '*' ? '.*' : char === '?' ? '.'
    : /[\\^$+?.()|{}\[\]]/.test(char) ? `\\${char}` : char).join('');
  return new RegExp(`^${escaped}$`, 'i');
}

/** FindFirst/FindNext snapshot with virtual files taking precedence over installation files. */
export class FindFileNative {
  private readonly searches = new WeakMap<JavaObject, Search>();

  constructor(jvm: SlrrJvm, private readonly fs: VirtualFileSystem,
    private readonly catalog: FileCatalogAdapter) {
    const owner = 'java.io.FindFile';
    const voidValue = () => jv('void', undefined);
    jvm.natives.register(owner, 'first', ['String', 'int'], ({ receiver, args }) => {
      const pattern = String(args[0].value ?? '');
      const flags = Number(args[1].value);
      const matches = this.search(pattern, flags);
      this.searches.set(this.object(receiver), { matches, nextIndex: 1 });
      jvm.set(receiver, 'flags', jv('int', flags));
      jvm.set(receiver, 'handle', jv('int', matches.length ? 1 : -1));
      return jv('String', matches[0]?.name ?? null);
    });
    jvm.natives.register(owner, 'next', [], ({ receiver }) => {
      const search = this.searches.get(this.object(receiver));
      if (!search) return jv('String', null);
      const item = search.matches[search.nextIndex++];
      return jv('String', item?.name ?? null);
    });
    jvm.natives.register(owner, 'close', [], ({ receiver }) => {
      this.searches.delete(this.object(receiver));
      jvm.set(receiver, 'handle', jv('int', -1));
      return voidValue();
    });
  }

  search(pattern: string, flags: number): Found[] {
    if (flags < 0 || flags > 2 || !pattern) return [];
    const normalized = normalizePath(pattern);
    const slash = normalized.lastIndexOf('/');
    const parent = slash < 0 ? '' : normalized.slice(0, slash + 1);
    const namePattern = normalized.slice(slash + 1);
    if (!namePattern) return [];
    const matches = matcher(namePattern);
    const seen = new Set<string>();
    const output: Found[] = [];
    const add = (path: string, isOverlay: boolean) => {
      const key = normalizePath(path);
      if (!key.startsWith(parent)) return;
      const rest = key.slice(parent.length);
      if (!rest) return;
      const separator = rest.indexOf('/');
      const name = separator < 0 ? rest : rest.slice(0, separator);
      const originalRest = path.replaceAll('\\', '/').slice(parent.length);
      const originalName = separator < 0 ? originalRest : originalRest.slice(0, separator);
      const directory = separator >= 0;
      if (!directory && !isOverlay && this.fs.shadows(key)) return;
      if (flags === 1 && directory || flags === 2 && !directory || !matches.test(name)) return;
      const identity = `${directory ? 'd' : 'f'}:${name}`;
      if (seen.has(identity)) return;
      seen.add(identity);
      output.push({ name: originalName, directory });
    };
    for (const [path, present] of this.fs.overlayEntries()) if (present) add(path, true);
    for (const path of this.fs.originalPaths()) add(path, false);
    for (const path of this.catalog.paths()) add(path, false);
    return output;
  }

  private object(receiver: JavaValue): JavaObject {
    const object = receiver.value as JavaObject | null;
    if (!object || !(object.fields instanceof Map) || !object.className)
      throw new Error(`FindFile receiver is not a Java object: ${receiver.type}`);
    return object;
  }
}
