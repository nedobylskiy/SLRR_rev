import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { textureAlphaMode } from '../src/render/texture-alpha';

function dds(fourcc: string, block: number[]) {
  const bytes = new Uint8Array(128 + block.length), view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('DDS '));
  view.setUint32(12, 4, true); view.setUint32(16, 4, true);
  bytes.set(new TextEncoder().encode(fourcc), 84); bytes.set(block, 128);
  return bytes;
}

test('DXT3 leaf mask uses depth-writing alpha cutout while an opaque texture stays opaque', () => {
  assert.equal(textureAlphaMode(dds('DXT3', [0, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0]), 'leaf.dds'), 'cutout');
  assert.equal(textureAlphaMode(dds('DXT3', [255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0]), 'paint.dds'), 'opaque');
});

test('DXT1 one-bit mask and DXT5 smooth alpha are distinguished', () => {
  assert.equal(textureAlphaMode(dds('DXT1', [0, 0, 0, 0, 255, 255, 0, 0]), 'fence.dds'), 'cutout');
  assert.equal(textureAlphaMode(dds('DXT5', [128, 128, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 'glass.dds'), 'blend');
});

test('uncompressed 32-bit DDS masks distinguish cutouts, solid surfaces and smooth blending', () => {
  const raw = (alphas: number[], mask = 0xff000000) => {
    const bytes = new Uint8Array(128 + alphas.length * 4), view = new DataView(bytes.buffer);
    bytes.set(new TextEncoder().encode('DDS '));
    view.setUint32(12, 1, true); view.setUint32(16, alphas.length, true);
    view.setUint32(88, 32, true); view.setUint32(104, mask, true);
    alphas.forEach((alpha, i) => view.setUint32(128 + i * 4, ((alpha << 24) | 0x808080) >>> 0, true));
    return bytes;
  };
  assert.equal(textureAlphaMode(raw([0, 0, 18, 68, 255, 255]), 'bridge.dds'), 'cutout');
  assert.equal(textureAlphaMode(raw([255, 255]), 'wall.dds'), 'opaque');
  assert.equal(textureAlphaMode(raw([96, 128]), 'glass.dds'), 'blend');
  assert.equal(textureAlphaMode(raw([0, 0], 0), 'unused-alpha.dds'), 'opaque');
});

test('PNG and TGA alpha-bearing headers request blending', () => {
  const png = new Uint8Array(26); png.set(new TextEncoder().encode('PNG'), 1); png[25] = 6;
  const tga = new Uint8Array(18); tga[16] = 32;
  assert.equal(textureAlphaMode(png, 'window.png'), 'blend');
  assert.equal(textureAlphaMode(tga, 'window.tga'), 'blend');
  const image = (alpha: number[]) => ({ width: alpha.length, height: 1, data: Uint8Array.from(alpha.flatMap(value => [255, 255, 255, value])) });
  assert.equal(textureAlphaMode(png, 'default_white.png', image([255, 255])), 'opaque');
  assert.equal(textureAlphaMode(png, 'foliage.png', image([0, 255])), 'cutout');
  assert.equal(textureAlphaMode(png, 'window.png', image([96, 255])), 'blend');
  assert.equal(textureAlphaMode(tga, 'paint.tga', image([255, 255])), 'opaque');
});
