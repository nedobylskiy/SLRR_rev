import { BinaryReader } from '../binary';

export interface RpkEntry {
  superId: number; typeId: number; type: number; flags: number;
  compatibility: number; offset: number; size: number; alias: string;
  transform?: number[]; data: Uint8Array;
}
export interface RpkPack {
  version: number;
  dependencies: { id: number; path: string; trailer: number }[];
  entries: RpkEntry[]; warnings: string[];
}

/** RPAK v0x200. No decompression: payloads may be text or embedded binary chunks. */
export function parseRpk(bytes: Uint8Array): RpkPack {
  const r = new BinaryReader(bytes, 'RPAK');
  if (r.text(4) !== 'RPAK') throw new Error('Not an RPAK file');
  const version = r.u32();
  if (version !== 0x200) throw new Error(`Unsupported RPAK version 0x${version.toString(16)}`);
  const dependencies: RpkPack['dependencies'] = [];
  const dependencyCount = r.u32() + r.u32();
  r.count(dependencyCount, 64);
  for (let i = 0; i < dependencyCount; i++) dependencies.push({ id: r.u32(), path: r.cstring(56), trailer: r.u32() });
  const tableSize = r.u32(), count = r.u32();
  r.skip(8);
  r.require(tableSize);
  const tableEnd = r.offset + tableSize;
  if (count * 23 > tableSize) throw new Error('RPAK: entry count exceeds TOC');
  const entries: RpkEntry[] = [], warnings: string[] = [];
  for (let i = 0; i < count; i++) {
    const superId = r.u32(), typeId = r.u32(), type = r.u8(), flags = r.u8();
    const compatibility = r.f32(), offset = r.u32(), size = r.u32();
    const alias = r.cstring(r.u8());
    const transform = flags & 1 ? Array.from({ length: 12 }, () => r.f32()) : undefined;
    if (r.offset > tableEnd) throw new Error(`RPAK: entry ${i} exceeds TOC`);
    r.require(size, offset);
    if (size && offset < tableEnd) warnings.push(`Entry 0x${typeId.toString(16)} payload overlaps TOC`);
    entries.push({ superId, typeId, type, flags, compatibility, offset, size, alias, transform, data: bytes.subarray(offset, offset + size) });
  }
  if (r.offset !== tableEnd) throw new Error(`RPAK: TOC consumed ${r.offset}, expected ${tableEnd}`);
  return { version, dependencies, entries, warnings };
}

/** Preserve repeated properties and order (texture, slot and rprop are not single-valued). */
export function parseProperties(text: string): { key: string; value: string; line: number }[] {
  return text.split(/\r?\n/).flatMap((raw, i) => {
    const line = raw.replace(/\s*(?:;|\/\/).*$/, '').trim();
    const match = /^(\S+)(?:\s+|\s*=\s*)(.*)$/.exec(line);
    return match ? [{ key: match[1].toLowerCase(), value: match[2].trim(), line: i + 1 }] : [];
  });
}

export function parseRdb(text: string) {
  return [...text.matchAll(/<FILE\s+([^>]+?)\s*>\s*([\s\S]*?)<\/FILE>/gi)].map(m => ({ name: m[1].trim(), body: m[2], properties: parseProperties(m[2]) }));
}

export function entryProperties(entry: RpkEntry) {
  // Binary RSDs (maps: POLY/PHYS etc.) are not treated as text.
  if (entry.data.some(v => v === 0)) return [];
  return parseProperties(new TextDecoder('windows-1252').decode(entry.data));
}
