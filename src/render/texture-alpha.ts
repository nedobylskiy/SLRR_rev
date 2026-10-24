export type AlphaMode = 'opaque' | 'cutout' | 'blend';

/** Inspect source alpha before uploading a compressed DDS to WebGL. */
export function textureAlphaMode(bytes: Uint8Array, path: string): AlphaMode {
  const suffix = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (suffix === 'png') {
    if (bytes.length < 26 || ascii(bytes, 1, 3) !== 'PNG') return 'opaque';
    const colorType = bytes[25];
    if (colorType === 4 || colorType === 6) return 'blend';
    const chunks = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const size = chunks.getUint32(offset);
      if (size > bytes.length - offset - 12) break;
      const type = ascii(bytes, offset + 4, 4);
      if (type === 'tRNS') return 'blend';
      if (type === 'IDAT') break;
      offset += size + 12;
    }
    return 'opaque';
  }
  if (suffix === 'tga') return bytes.length >= 18 && bytes[16] === 32 ? 'blend' : 'opaque';
  if (suffix !== 'dds' || bytes.length < 128 || ascii(bytes, 0, 4) !== 'DDS ') return 'opaque';
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, true), height = view.getUint32(12, true), fourcc = ascii(bytes, 84, 4);
  if (!width || !height || width > 16384 || height > 16384) return 'opaque';
  const blockSize = fourcc === 'DXT1' ? 8 : fourcc === 'DXT3' || fourcc === 'DXT5' ? 16 : 0;
  if (!blockSize) return view.getUint32(104, true) ? 'blend' : 'opaque';
  const blocks = Math.ceil(width / 4) * Math.ceil(height / 4), available = Math.min(blocks, Math.floor((bytes.length - 128) / blockSize));
  if (!available) return 'opaque';
  const stride = Math.max(1, Math.floor(available / 4096));
  let zero = 0, middle = 0, full = 0;
  const add = (alpha: number) => { if (alpha === 0) zero++; else if (alpha === 255) full++; else middle++; };
  for (let block = 0; block < available; block += stride) {
    const start = 128 + block * blockSize;
    if (fourcc === 'DXT3') {
      for (let i = 0; i < 8; i++) { add((bytes[start + i] & 15) * 17); add((bytes[start + i] >> 4) * 17); }
    } else if (fourcc === 'DXT5') {
      const a = bytes[start], b = bytes[start + 1], palette = [a, b];
      if (a > b) for (let i = 1; i <= 6; i++) palette.push(Math.round(((7 - i) * a + i * b) / 7));
      else { for (let i = 1; i <= 4; i++) palette.push(Math.round(((5 - i) * a + i * b) / 5)); palette.push(0, 255); }
      let indices = 0n;
      for (let i = 0; i < 6; i++) indices |= BigInt(bytes[start + 2 + i]) << BigInt(i * 8);
      for (let i = 0; i < 16; i++) add(palette[Number((indices >> BigInt(i * 3)) & 7n)]);
    } else {
      const color0 = view.getUint16(start, true), color1 = view.getUint16(start + 2, true);
      if (color0 > color1) { full += 16; continue; }
      const indices = view.getUint32(start + 4, true);
      for (let i = 0; i < 16; i++) add((indices >>> (i * 2) & 3) === 3 ? 0 : 255);
    }
  }
  const total = zero + middle + full;
  if (zero > total * 0.02 && full > total * 0.05) return 'cutout';
  return zero || middle ? 'blend' : 'opaque';
}

function ascii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}
