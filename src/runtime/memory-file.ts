import { BinaryReader } from '../binary';

/** File-like primitive stream for future Java File natives, backed only by owned JS memory. */
export class MemoryFile {
  private buffer: Uint8Array;
  private length: number;
  position = 0;
  constructor(bytes?: Uint8Array, readonly limit = 64 * 1024 * 1024) {
    if (bytes && bytes.length > limit) throw new Error('MemoryFile exceeds limit');
    this.buffer = bytes ? Uint8Array.from(bytes) : new Uint8Array(Math.min(256, limit)); this.length = bytes?.length ?? 0;
  }
  get size() { return this.length; }
  private ensure(size: number) {
    if (this.position + size > this.limit) throw new Error('MemoryFile exceeds limit');
    if (this.position + size > this.buffer.length) {
      const next = new Uint8Array(Math.min(this.limit, Math.max(this.position + size, this.buffer.length * 2)));
      next.set(this.buffer); this.buffer = next;
    }
    this.length = Math.max(this.length, this.position + size);
  }
  writeBytes(bytes: Uint8Array) { this.ensure(bytes.length); this.buffer.set(bytes, this.position); this.position += bytes.length; }
  writeInt(value: number) { this.ensure(4); new DataView(this.buffer.buffer).setInt32(this.position, value, true); this.position += 4; }
  writeFloat(value: number) { this.ensure(4); new DataView(this.buffer.buffer).setFloat32(this.position, value, true); this.position += 4; }
  writeString(value: string | null) {
    if (value === null) { this.writeInt(0); return; }
    const bytes = encodeLegacyString(value); this.writeInt(bytes.length + 1); this.writeBytes(bytes); this.writeBytes(new Uint8Array([0]));
  }
  private reader() { const r = new BinaryReader(this.buffer.subarray(0, this.length), 'MemoryFile'); r.seek(this.position); return r; }
  readInt() { const r = this.reader(); const value = r.u32() | 0; this.position = r.offset; return value; }
  readFloat() { const r = this.reader(); const value = r.f32(); this.position = r.offset; return value; }
  readString() {
    const r = this.reader(), length = r.u32();
    if (!length) { this.position = r.offset; return null; }
    const b = r.take(length); if (b.at(-1) !== 0) throw new Error('MemoryFile string missing NUL');
    this.position = r.offset; return new TextDecoder('windows-1252').decode(b.subarray(0, -1));
  }
  toBytes() { return Uint8Array.from(this.buffer.subarray(0, this.length)); }
}

const legacyEncoder = new Map<string, number>();
const decoder = new TextDecoder('windows-1252');
for (let i = 0; i < 256; i++) legacyEncoder.set(decoder.decode(new Uint8Array([i])), i);
function encodeLegacyString(text: string) {
  if (text.includes('\0')) throw new Error('Embedded NUL is not supported by legacy strings');
  return Uint8Array.from([...text].map(c => { const n = legacyEncoder.get(c); if (n === undefined) throw new Error(`Character not representable in legacy encoding: ${c}`); return n; }));
}
