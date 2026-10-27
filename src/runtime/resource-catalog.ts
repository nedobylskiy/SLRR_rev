import { normalizePath } from '../assets';
import { entryProperties, type RpkPack } from '../formats/rpk';

export interface CatalogResource { pack: string; id: number; type: number; alias: string; script?: string }

/** Resolves RPK super IDs, including links through another pack's dependency slot. */
export class ResourceCatalog {
  private readonly children = new Map<string, CatalogResource[]>();
  private readonly loaded = new Set<string>();

  constructor(packs: Iterable<readonly [string, RpkPack]>) {
    for (const [rawPath, pack] of packs) this.addPack(rawPath, pack);
  }

  addPack(rawPath: string, pack: RpkPack): void {
    const path = normalizePath(rawPath);
    if (this.loaded.has(path)) return;
    this.loaded.add(path);
    for (const entry of pack.entries) {
      if (!entry.superId) continue;
      const slot = entry.superId >>> 16;
      const parentPack = slot ? pack.dependencies.find(dep => dep.id >>> 16 === slot)?.path : path;
      if (!parentPack) continue;
      const key = ResourceCatalog.key(parentPack, entry.superId & 0xffff);
      const siblings = this.children.get(key) ?? [];
      const script = entry.type === 8 ? entryProperties(entry).find(prop => prop.key === 'script')?.value : undefined;
      siblings.push({ pack: path, id: entry.typeId, type: entry.type, alias: entry.alias, ...(script ? { script } : {}) });
      this.children.set(key, siblings);
    }
  }

  childrenOf(pack: string, id: number): readonly CatalogResource[] {
    return this.children.get(ResourceCatalog.key(pack, id)) ?? [];
  }

  private static key(pack: string, id: number): string {
    const path = normalizePath(pack.endsWith('.rpk') ? pack : pack.replaceAll('.', '/'));
    return `${path.endsWith('.rpk') ? path : `${path}.rpk`}:${id & 0xffff}`;
  }
}
