/** Read-only PE cursor resources. Based on sl-remastered cursor_resource.cpp
 * and platform.cpp (7aa574d26098e288367a3707f0b7ac7bb892ebbe). No executable code runs. */
export function stockCursorIndex(glyph: string): number {
  return ({ G:1, M:2, W:3, A:4, D:5, '1':1, '2':2, '3':3, '4':4, '5':5,
    '6':6, '7':7, '8':8, '9':9 } as Record<string, number>)[glyph] ?? 0;
}
export function readExeCursor(bytes: Uint8Array, index: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const range = (p: number, n: number) => { if (p < 0 || p + n > bytes.length) throw new Error('Truncated PE cursor resource'); };
  const u16 = (p: number) => { range(p, 2); return view.getUint16(p, true); };
  const u32 = (p: number) => { range(p, 4); return view.getUint32(p, true); };
  const pe = u32(0x3c), size = u16(pe + 20);
  if (u32(pe) !== 0x4550 || u16(pe + 24) !== 0x10b || size < 116) throw new Error('Unsupported cursor PE');
  const rva = u32(pe + 136), sections = u16(pe + 6);
  let base = -1;
  for (let i = 0; i < sections; i++) {
    const s = pe + 24 + size + i * 40, va = u32(s + 12), length = u32(s + 16);
    if (rva >= va && rva - va < length) { base = u32(s + 20) + rva - va; break; }
  }
  if (base < 0) throw new Error('PE cursor resource section missing');
  const entry = (directory: number, id: number) => {
    const count = u16(base + directory + 12) + u16(base + directory + 14);
    for (let i = 0; i < count; i++) {
      const p = base + directory + 16 + i * 8;
      if (u32(p) === id) return u32(p + 4);
    }
    throw new Error(`PE cursor resource ${id} missing`);
  };
  const resource = (type: number, id: number) => {
    const typeDir = entry(0, type), idDir = entry(typeDir & 0x7fffffff, id);
    if (!(typeDir >>> 31) || !(idDir >>> 31)) throw new Error('Invalid PE cursor directory');
    const language = base + (idDir & 0x7fffffff);
    if (u16(language + 14) < 1) throw new Error('PE cursor language missing');
    const data = u32(language + 20);
    if (data >>> 31) throw new Error('Invalid PE cursor data');
    const offset = base + u32(base + data) - rva, length = u32(base + data + 4);
    range(offset, length); return { offset, length };
  };
  const groups = [0x74,0x75,0x76,0x77,0x78,0x79,0x7b,0x7c,0x7d,0x7e];
  const group = resource(12, groups[index] ?? groups[0]);
  if (group.length < 20 || u16(group.offset + 2) !== 2) throw new Error('Unsupported PE cursor group');
  const image = resource(1, u16(group.offset + 18)), p = image.offset;
  const hotspotX = u16(p), hotspotY = u16(p + 2), width = u32(p + 8), doubledHeight = u32(p + 12);
  if (u32(p + 4) !== 40 || u16(p + 18) !== 4 || u32(p + 20) !== 0
    || width < 1 || width > 256 || doubledHeight < 2 || doubledHeight > 512 || doubledHeight % 2)
    throw new Error('Unsupported PE cursor bitmap');
  const height = doubledHeight / 2, xorStride = Math.ceil(width * 4 / 32) * 4, andStride = Math.ceil(width / 32) * 4;
  if (hotspotX >= width || hotspotY >= height || 108 + (xorStride + andStride) * height > image.length)
    throw new Error('Invalid PE cursor bitmap');
  const rgba = new Uint8ClampedArray(width * height * 4), xor = p + 108, and = xor + xorStride * height;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const row = height - y - 1, packed = bytes[xor + row * xorStride + (x >> 1)];
    const color = p + 44 + (x % 2 ? packed & 15 : packed >> 4) * 4;
    const d = (y * width + x) * 4;
    rgba.set([bytes[color + 2], bytes[color + 1], bytes[color],
      bytes[and + row * andStride + (x >> 3)] & (0x80 >> (x % 8)) ? 0 : 255], d);
  }
  return { width, height, hotspotX, hotspotY, rgba };
}
