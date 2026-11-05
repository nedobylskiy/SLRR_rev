import test from 'node:test';
import assert from 'node:assert/strict';
import { readExeCursor, stockCursorIndex } from '../src/formats/exe-cursor';

test('native cursor modes select EXE groups rather than font glyph artwork', () => {
  assert.equal(stockCursorIndex('G'), 1); assert.equal(stockCursorIndex('B'), 0);
  assert.equal(stockCursorIndex('M'), 2); assert.equal(stockCursorIndex('A'), 4);
});
test('PE cursor decoder preserves hotspot, palette, bottom-up rows and transparency mask', () => {
  const bytes = new Uint8Array(1024), v = new DataView(bytes.buffer);
  const w = (p: number, n: number) => v.setUint16(p, n, true);
  const d = (p: number, n: number) => v.setUint32(p, n, true);
  d(0x3c, 0x40); d(0x40, 0x4550); w(0x46, 1); w(0x54, 224); w(0x58, 0x10b); d(0xc8, 0x1000);
  d(0x138 + 12, 0x1000); d(0x138 + 16, 512); d(0x138 + 20, 512);
  const directory = (offset: number, entries: number[][]) => {
    w(512 + offset + 14, entries.length);
    entries.forEach(([id, value], i) => { d(512 + offset + 16 + i * 8, id); d(512 + offset + 20 + i * 8, value); });
  };
  directory(0, [[12, 0x80000020], [1, 0x80000040]]);
  directory(0x20, [[0x75, 0x80000060]]); directory(0x40, [[7, 0x80000080]]);
  directory(0x60, [[1033, 0xa0]]); directory(0x80, [[1033, 0xb0]]);
  d(512 + 0xa0, 0x10c0); d(512 + 0xa4, 20);
  d(512 + 0xb0, 0x1100); d(512 + 0xb4, 124);
  w(512 + 0xc2, 2); w(512 + 0xc4, 1); w(512 + 0xd2, 7);
  const p = 768; w(p, 1); w(p + 2, 0); d(p + 4, 40); d(p + 8, 2); d(p + 12, 4);
  w(p + 16, 1); w(p + 18, 4);
  bytes.set([0, 0, 255, 0], p + 48); // palette index 1 is red
  bytes[p + 108] = 0x10; bytes[p + 112] = 0x11; bytes[p + 120] = 0x40;
  const cursor = readExeCursor(bytes, 1);
  assert.equal(cursor.width, 2); assert.equal(cursor.hotspotX, 1);
  assert.deepEqual([...cursor.rgba], [255,0,0,255,255,0,0,0,255,0,0,255,0,0,0,255]);
  assert.throws(() => readExeCursor(bytes.slice(0, 800), 1), /Truncated/);
});

