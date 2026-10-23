import { BinaryReader } from '../binary';
import { MemoryFile } from '../runtime/memory-file';

export interface SavedResource { pack: string; localId: number }
export interface Sdat {
  type: number; flags: number; payload: Uint8Array;
  packs: Map<number, string>;
  unsaved: { ordinal: number; kind: number; bytes: Uint8Array }[];
}

/** SDAT container; preserves embedded texture bytes instead of invoking the legacy remounter. */
export function parseSdat(bytes: Uint8Array): Sdat {
  const r = new BinaryReader(bytes, 'SDAT');
  if (r.text(4) !== 'SDAT') throw new Error('Not SDAT');
  if (r.u16() !== 0x100) throw new Error('Unsupported SDAT version');
  const type = r.u8(), flags = r.u8();
  const packs = new Map<number, string>(), unsaved: Sdat['unsaved'] = [];
  let start: number, count: number;
  if (type === 2) {
    r.seek(bytes.length - 4); const length = r.u32(); start = bytes.length - 4 - length;
    if (start < 8 || length < 8) throw new Error('Invalid SDAT type 2 trailer');
    r.seek(start); count = r.count(r.u32(), 12);
    for (let i = 0; i < count; i++) {
      const ordinal = r.u32(), kind = r.u32(), size = r.u32();
      if (kind !== 7 && size !== 0) throw new Error(`Unknown non-empty SDAT resource kind ${kind}`);
      unsaved.push({ ordinal, kind, bytes: Uint8Array.from(r.take(size)) });
    }
    count = r.count(r.u32(), 8);
  } else if (type === 1) {
    r.seek(bytes.length - 8); const length = r.u32(); count = r.u32(); start = bytes.length - 8 - length;
    if (start < 8) throw new Error('Invalid SDAT type 1 trailer');
    r.seek(start); r.count(count, 8);
  } else throw new Error(`Unsupported SDAT type ${type}`);
  for (let i = 0; i < count; i++) {
    const ordinal = r.u32(), path = readSavedString(r);
    if (!path || packs.has(ordinal) || ordinal === 0 || ordinal >= 0xffff) throw new Error('Invalid SDAT remount pack');
    packs.set(ordinal, path);
  }
  if (r.offset !== bytes.length - (type === 1 ? 8 : 4)) throw new Error('SDAT trailer size mismatch');
  return { type, flags, payload: Uint8Array.from(bytes.subarray(8, start)), packs, unsaved };
}

/** Re-encode an SDAT envelope losslessly without touching disk or instantiating native resources. */
export function serializeSdat(sdat: Sdat) {
  const out = new MemoryFile();
  out.writeBytes(new Uint8Array([83, 68, 65, 84, 0, 1, sdat.type, sdat.flags])); out.writeBytes(sdat.payload);
  const start = out.position;
  if (sdat.type === 2) {
    out.writeInt(sdat.unsaved.length);
    for (const res of sdat.unsaved) {
      if (res.kind !== 7 && res.bytes.length) throw new Error('Unknown embedded SDAT resource');
      out.writeInt(res.ordinal); out.writeInt(res.kind); out.writeInt(res.bytes.length); out.writeBytes(res.bytes);
    }
    out.writeInt(sdat.packs.size);
  } else if (sdat.type !== 1 || sdat.unsaved.length) throw new Error('Unsupported SDAT type');
  for (const [ordinal, path] of sdat.packs) { out.writeInt(ordinal); out.writeString(path); }
  out.writeInt(out.position - start);
  if (sdat.type === 1) out.writeInt(sdat.packs.size);
  return out.toBytes();
}

export function readSavedString(r: BinaryReader): string | null {
  const length = r.u32();
  if (!length) return null;
  const data = r.take(length);
  if (data.at(-1) !== 0) throw new Error('SDAT string missing NUL');
  return new TextDecoder('windows-1252').decode(data.subarray(0, -1));
}

export function resolveSavedResource(sdat: Sdat, id: number): SavedResource | null {
  if (id === 0) return null;
  const pack = sdat.packs.get(id >>> 16);
  if (!pack) throw new Error(`Saved resource 0x${id.toString(16)} references an unsaved/dynamic or missing pack`);
  return { pack, localId: id & 0xffff };
}

/** Only the confirmed base header. Subclass save tails require their actual Java serializers. */
export function inspectSavedVehicle(bytes: Uint8Array) {
  const sdat = parseSdat(bytes), r = new BinaryReader(sdat.payload, 'Vehicle save');
  if (r.u32() !== 0x88664422) throw new Error('Not a Vehicle save');
  const version = r.u32();
  if (version !== 5) throw new Error(`Unsupported Vehicle save version ${version}`);
  const name = readSavedString(r), chassis = resolveSavedResource(sdat, r.u32()), partVersion = r.u32();
  const textureId = r.u32(), meshId = r.u32(), wear = r.f32(), tear = r.f32();
  const adjustedPosition = partVersion >= 3 ? readSavedString(r) : null;
  const adjustedRotation = partVersion >= 3 ? readSavedString(r) : null;
  return { sdat, version, name, chassis, partVersion, textureId, meshId, wear, tear, adjustedPosition, adjustedRotation, baseHeaderBytes: r.offset };
}
