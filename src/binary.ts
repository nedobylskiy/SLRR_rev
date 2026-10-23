/** Bounds-checked little-endian reader. Offsets are relative to the supplied view. */
export class BinaryReader {
  readonly view: DataView;
  offset = 0;
  constructor(readonly bytes: Uint8Array, readonly label = 'binary') {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  get remaining() { return this.bytes.length - this.offset; }
  require(size: number, at = this.offset) {
    if (!Number.isSafeInteger(size) || size < 0 || at < 0 || at + size > this.bytes.length)
      throw new Error(`${this.label}: out of bounds at 0x${at.toString(16)} (+${size}, length ${this.bytes.length})`);
  }
  seek(at: number) { this.require(0, at); this.offset = at; }
  skip(size: number) { this.require(size); this.offset += size; }
  u8() { this.require(1); return this.view.getUint8(this.offset++); }
  u16() { this.require(2); const v = this.view.getUint16(this.offset, true); this.offset += 2; return v; }
  u32() { this.require(4); const v = this.view.getUint32(this.offset, true); this.offset += 4; return v; }
  f32() { this.require(4); const v = this.view.getFloat32(this.offset, true); this.offset += 4; return v; }
  take(size: number) { this.require(size); const b = this.bytes.subarray(this.offset, this.offset + size); this.offset += size; return b; }
  text(size: number) { return new TextDecoder('windows-1252').decode(this.take(size)); }
  cstring(size: number) { return this.text(size).split('\0')[0]; }
  count(n: number, minimumBytes: number) {
    if (n > 10_000_000 || n * minimumBytes > this.remaining) throw new Error(`${this.label}: impossible count ${n} at ${this.offset}`);
    return n;
  }
}
