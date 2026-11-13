import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeDdsImage } from '../src/formats/dds-image';

function fixture(compression: 'DXT1' | 'DXT3' | 'DXT5') {
  const bytes = Buffer.alloc(128 + (compression === 'DXT1' ? 8 : 16));
  bytes.write('DDS '); bytes.writeUInt32LE(124, 4); bytes.writeUInt32LE(0x1007, 8);
  bytes.writeUInt32LE(4, 12); bytes.writeUInt32LE(4, 16);
  bytes.writeUInt32LE(32, 76); bytes.writeUInt32LE(4, 80); bytes.write(compression, 84);
  bytes.writeUInt32LE(0x1000, 108);
  const offset = compression === 'DXT1' ? 128 : 136;
  bytes.writeUInt16LE(0xf800, offset); bytes.writeUInt16LE(0x07e0, offset + 2);
  bytes.writeUInt32LE(0xe4e4e4e4, offset + 4);
  return bytes;
}

test('DDS avatars decode DXT1 colors and transparent pixels without WebGL', () => {
  const bytes = fixture('DXT1');
  const image = decodeDdsImage(bytes);
  assert.deepEqual([image.width, image.height], [4, 4]);
  assert.deepEqual(Array.from(image.data.slice(0, 16)),
    [255,0,0,255, 0,255,0,255, 170,85,0,255, 85,170,0,255]);
  bytes.writeUInt16LE(0, 128); bytes.writeUInt16LE(0xffff, 130);
  assert.deepEqual(Array.from(decodeDdsImage(bytes).data.slice(12,16)), [0,0,0,0]);
});

test('DDS DXT3 and DXT5 preserve alpha masks', () => {
  const dxt3 = fixture('DXT3'); dxt3.fill(0x88,128,136);
  assert.equal(decodeDdsImage(dxt3).data[3],136);
  const dxt5 = fixture('DXT5'); dxt5[128]=255; dxt5[129]=0;
  dxt5[130]=2; // First pixel uses the first interpolated alpha.
  const image = decodeDdsImage(dxt5);
  assert.equal(image.data[3],219); assert.equal(image.data[7],255);
});
