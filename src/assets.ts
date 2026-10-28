import { parseRpk, entryProperties, type RpkEntry, type RpkPack } from './formats/rpk';

export interface Asset { path: string; size: number }
export function isSavedVehiclePath(path: string) {
  const p = path.replaceAll('\\', '/').toLowerCase();
  return !/\.[^/]+$/.test(p) && (p.startsWith('save/cars/') || /^save\/career\/[^/]+\/playercar[^/]*$/.test(p));
}
export function normalizePath(path: string) {
  const parts = path.replaceAll('\\', '/').split('/').filter(p => p && p !== '.');
  if (parts.some(p => p === '..') || /^[a-z]:/i.test(path) || path.startsWith('/')) throw new Error('Invalid relative asset path');
  return parts.join('/').toLowerCase();
}

/** Accept both filesystem paths and Java resource namespaces for RPK files. */
export function normalizeResourcePackPath(pack: string) {
  const name = pack.replace(/\.rpk$/i, '');
  return normalizePath(`${/[\\/]/.test(name) ? name : name.replaceAll('.', '/')}.rpk`);
}

/** Browser-side virtual filesystem: source files are read lazily. */
export class Assets {
  readonly byPath = new Map<string, Asset>();
  private packs = new Map<string, Promise<RpkPack>>();
  constructor(readonly files: Asset[], private reader: (path: string) => Promise<Uint8Array>) {
    for (const file of files) this.byPath.set(normalizePath(file.path), file);
  }
  async read(path: string) {
    const asset = this.byPath.get(normalizePath(path));
    if (!asset) throw new Error(`Asset missing: ${path}`);
    return this.reader(asset.path);
  }
  async pack(path: string) {
    const key = normalizeResourcePackPath(path);
    if (!this.packs.has(key)) this.packs.set(key, this.read(key).then(parseRpk));
    return this.packs.get(key)!;
  }
  /** Resolve a RID's namespace without requiring a concrete resource (CFG may name abstract compatibility types). */
  async resourceLocation(packPath: string, id: number): Promise<{ packPath: string; id: number }> {
    packPath = normalizeResourcePackPath(packPath);
    const pack = await this.pack(packPath), slot = id >>> 16;
    if (slot) {
      const dep = pack.dependencies.find(d => d.id >>> 16 === slot);
      if (!dep) throw new Error(`Resource dependency slot ${slot} missing in ${packPath}`);
      return { packPath: dep.path, id: id & 0xffff };
    }
    return { packPath, id };
  }
  async resource(packPath: string, id: number): Promise<{ packPath: string; entry: RpkEntry }> {
    const location = await this.resourceLocation(packPath, id);
    packPath = location.packPath; id = location.id;
    const pack = await this.pack(packPath);
    const entry = pack.entries.find(e => e.typeId === id);
    if (!entry) throw new Error(`Resource 0x${id.toString(16)} missing in ${packPath}`);
    return { packPath, entry };
  }
  /** Follow resource → render → mesh → sourcefile. Textures are collected in RSD order. */
  async modelForResource(packPath: string, id: number, visited = new Set<string>()): Promise<{ path: string; textures: string[] }> {
    const resolved = await this.resource(packPath, id);
    const key = `${normalizePath(resolved.packPath)}:${resolved.entry.typeId}`;
    if (visited.has(key)) throw new Error(`Resource cycle: ${key}`);
    visited.add(key);
    const props = entryProperties(resolved.entry);
    const source = props.find(p => p.key === 'sourcefile')?.value;
    const textures: string[] = [];
    for (const prop of props.filter(p => p.key === 'texture')) {
      try {
        const texture = await this.resource(resolved.packPath, parseRid(prop.value));
        const file = entryProperties(texture.entry).find(p => p.key === 'sourcefile')?.value;
        if (file) textures.push(file);
      } catch { textures.push(''); } // Preserve material indices when one texture is missing.
    }
    if (source && /\.sc[xy]$/i.test(source)) {
      const visible = /\.scy$/i.test(source) ? source.replace(/\.scy$/i, '.scx') : source;
      return { path: this.byPath.has(normalizePath(visible)) ? visible : source, textures };
    }
    const next = props.find(p => p.key === 'mesh') ?? props.find(p => p.key === 'render');
    if (!next) throw new Error(`Resource ${key} has no external SCX/render/mesh; embedded map chunks need a separate decoder`);
    const model = await this.modelForResource(resolved.packPath, parseRid(next.value), visited);
    return { path: model.path, textures: textures.length ? textures : model.textures };
  }
}

function parseRid(value: string) {
  if (!/^0x[0-9a-f]+$/i.test(value)) throw new Error(`Unsupported resource reference: ${value}`);
  return Number.parseInt(value.slice(2), 16) >>> 0;
}
