import { DDSLoader } from 'three/addons/loaders/DDSLoader.js';
import { RGBAFormat, RGB_S3TC_DXT1_Format, RGBA_S3TC_DXT3_Format, RGBA_S3TC_DXT5_Format } from 'three';

/** Decode the top DDS mip to straight RGBA for HTML images, without a WebGL context. */
export function decodeDdsImage(bytes: Uint8Array): { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> } {
  const dds = new DDSLoader().parse(bytes.slice().buffer, false);
  const { width, height, format } = dds;
  if (!width || !height || dds.isCubemap || !dds.mipmaps.length) throw new Error('Unsupported DDS image');
  const source = dds.mipmaps[0].data;
  const data = new Uint8ClampedArray(width * height * 4);
  if (format === RGBAFormat) { data.set(source); return { width, height, data }; }
  const dxt1 = format === RGB_S3TC_DXT1_Format;
  if (!dxt1 && format !== RGBA_S3TC_DXT3_Format && format !== RGBA_S3TC_DXT5_Format)
    throw new Error('Unsupported DDS image compression');
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const rgb = (word: number) => [Math.round((word >>> 11) * 255 / 31),
    Math.round(((word >>> 5) & 63) * 255 / 63), Math.round((word & 31) * 255 / 31), 255];
  let offset = 0;
  for (let by = 0; by < height; by += 4) for (let bx = 0; bx < width; bx += 4) {
    const colorOffset = offset + (dxt1 ? 0 : 8);
    const c0 = view.getUint16(colorOffset, true), c1 = view.getUint16(colorOffset + 2, true);
    const colors = [rgb(c0), rgb(c1), [0, 0, 0, 255], [0, 0, 0, 255]];
    for (let channel = 0; channel < 3; channel++) {
      const a = colors[0][channel], b = colors[1][channel];
      colors[2][channel] = dxt1 && c0 <= c1 ? (a + b) / 2 : (2 * a + b) / 3;
      colors[3][channel] = dxt1 && c0 <= c1 ? 0 : (a + 2 * b) / 3;
    }
    if (dxt1 && c0 <= c1) colors[3][3] = 0;
    const indices = view.getUint32(colorOffset + 4, true);
    const alpha = [source[offset], source[offset + 1]];
    if (format === RGBA_S3TC_DXT5_Format) {
      if (alpha[0] > alpha[1]) for (let i = 1; i <= 6; i++) alpha.push(((7 - i) * alpha[0] + i * alpha[1]) / 7);
      else {
        for (let i = 1; i <= 4; i++) alpha.push(((5 - i) * alpha[0] + i * alpha[1]) / 5);
        alpha.push(0, 255);
      }
    }
    for (let pixel = 0; pixel < 16; pixel++) {
      const x = bx + pixel % 4, y = by + Math.floor(pixel / 4);
      if (x >= width || y >= height) continue;
      const target = (y * width + x) * 4;
      data.set(colors[(indices >>> (pixel * 2)) & 3], target);
      if (format === RGBA_S3TC_DXT3_Format)
        data[target + 3] = ((source[offset + (pixel >>> 1)] >>> ((pixel & 1) * 4)) & 15) * 17;
      else if (format === RGBA_S3TC_DXT5_Format) {
        const bit = pixel * 3, byte = offset + 2 + (bit >>> 3), shift = bit & 7;
        const index = ((source[byte] | ((source[byte + 1] ?? 0) << 8)) >>> shift) & 7;
        data[target + 3] = alpha[index];
      }
    }
    offset += dxt1 ? 8 : 16;
  }
  return { width, height, data };
}
