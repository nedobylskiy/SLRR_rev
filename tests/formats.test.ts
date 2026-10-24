import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConstants, parseTufa, parseTrees } from '../src/formats/tufa';
import { parseScx, scxDiffuseUsesAlpha } from '../src/formats/scx';
import { parseRpk, parseProperties, parseRdb } from '../src/formats/rpk';
import { normalizePath } from '../src/assets';

function u32(...n: number[]) { const b = Buffer.alloc(n.length * 4); n.forEach((v, i) => b.writeUInt32LE(v >>> 0, i * 4)); return b; }
function chunk(tag: string, data: Uint8Array) { return Buffer.concat([Buffer.from(tag), u32(data.length), data]); }
function str(s: string) { return Buffer.concat([u32(0, s.length), Buffer.from(s), Buffer.from([0])]); }
function fixtureClass() {
  const cons = Buffer.concat([u32(2), str('test.Probe'), u32(4, 0)]);
  return Buffer.concat([chunk('TUFA', u32(151453)), chunk('CONS', cons), chunk('CLSS', u32(0xffffffff, 0, 1, 0xffffffff, 0)), chunk('MTHD', u32(0, 0)), chunk('TREE', u32(0))]);
}

test('typed CONS handles short strings without consuming the next type tag', () => {
  const b = Buffer.concat([u32(5), str('I'), str('log'), u32(4, 0), u32(3, 1, 0x123), u32(7, 0, 1)]);
  assert.deepEqual(parseConstants(b), [{ kind: 0, value: 'I' }, { kind: 0, value: 'log' }, { kind: 4, value: 0 }, { kind: 3, a: 1, b: 0x123 }, { kind: 7, a: 0, b: 1 }]);
});
test('TUFA supports concatenated classes and rejects all truncated prefixes', () => {
  const b = fixtureClass(); assert.equal(parseTufa(Buffer.concat([b, b])).length, 2);
  assert.equal(parseTufa(b)[0].name, 'test.Probe');
  // Complete prefix at a section boundary can be another valid TUFA; truncate inside the CONS payload.
  for (let i = 1; i < 25; i++) assert.throws(() => parseTufa(b.subarray(0, i)));
});
test('TREE consumes short and wide nodes, rejects count overflows and leftovers', () => {
  const b = Buffer.concat([u32(1, 2), Buffer.from([0x0b, 7, 0]), u32(42), Buffer.from([0x2b, 7, 0])]);
  assert.deepEqual(parseTrees(b)[0].map(n => [n.op, n.operand]), [[11, 42], [43, undefined]]);
  assert.throws(() => parseTrees(u32(0xffffffff)));
  assert.throws(() => parseTrees(Buffer.concat([b, Buffer.from([0])])));
});
test('RPAK follows variable aliases and preserves the exact payload range', () => {
  const text = Buffer.from('sourcefile model.scx\r\n');
  const row = Buffer.concat([u32(0x10003, 7), Buffer.from([5, 0]), u32(0x3f800000, 57, text.length), Buffer.from([2, 120, 0])]);
  const b = Buffer.concat([Buffer.from('RPAK'), u32(512, 0, 0, row.length, 1, 0, 1), row, text]);
  const pack = parseRpk(b); assert.equal(pack.entries[0].alias, 'x'); assert.equal(Buffer.from(pack.entries[0].data).toString(), text.toString());
  assert.throws(() => parseRpk(b.subarray(0, b.length - 1)));
});
test('SCX valid empty placeholders are distinct from missing/invalid files', () => {
  for (const version of [3, 4]) assert.equal(parseScx(Buffer.concat([Buffer.from('INVO'), u32(version, 0)])).meshes.length, 0);
  assert.throws(() => parseScx(Buffer.alloc(0))); assert.throws(() => parseScx(Buffer.concat([Buffer.from('INVO'), u32(999)])));
});
test('SCX v3 preserves layer2 texture index and all three UV channels', () => {
  const material = Buffer.alloc(56);
  material.writeUInt32LE(56, 0);
  material.writeUInt16LE(2, 44);
  material.writeUInt16LE(5, 52);
  const vertex = Buffer.alloc(44);
  vertex.writeFloatLE(0.25, 24); vertex.writeFloatLE(0.5, 28);
  vertex.writeFloatLE(0.75, 32); vertex.writeFloatLE(0.875, 36);
  const data = Buffer.concat([Buffer.from('INVO'), u32(3), material, u32(1), vertex, u32(0), u32(0)]);
  const mesh = parseScx(data).meshes[0];
  assert.equal(mesh.textureIndex, 2);
  assert.equal(mesh.layer2Index, 5);
  assert.deepEqual(Array.from(mesh.uv), [0.25, 0.5]);
  assert.deepEqual(Array.from(mesh.uv2!), [0.75, 0.875]);
  const extended = Buffer.alloc(136);
  extended.writeUInt32LE(136, 0); extended.writeUInt16LE(2, 44); extended.writeUInt16LE(5, 52);
  extended.writeUInt32LE(0x40, 40); extended.writeUInt16LE(2, 70); extended.writeUInt16LE(0, 72);
  const wideVertex = Buffer.alloc(64);
  wideVertex.writeFloatLE(0.25, 24); wideVertex.writeFloatLE(0.5, 28);
  wideVertex.writeFloatLE(12.5, 52); wideVertex.writeFloatLE(-7.5, 56);
  const wide = parseScx(Buffer.concat([Buffer.from('INVO'), u32(3), extended, u32(1), wideVertex, u32(0), u32(0)])).meshes[0];
  assert.deepEqual(Array.from(wide.uv3!), [12.5, -7.5]);
  assert.equal(wide.materialFlags, 0x40);
  assert.equal(wide.textureChannel, 2);
  assert.equal(wide.layer2Channel, 0);
});
test('SCX v3 alphaOpacity flag keeps RGB road base opaque while allowing cutout fences', () => {
  assert.equal(scxDiffuseUsesAlpha(3, 0x40), false);
  assert.equal(scxDiffuseUsesAlpha(3, 0), false);
  assert.equal(scxDiffuseUsesAlpha(3, 0x101), true);
  assert.equal(scxDiffuseUsesAlpha(4, 0), true);
});
test('SCX v4 uses the secondary diffuse map only when the primary map is absent', () => {
  const fixture = (properties: Array<[number, number]>) => {
    const material = Buffer.concat([u32(0, 0), u32(properties.length), ...properties.map(([type, index]) => Buffer.concat([u32(type, index), Buffer.alloc(24)]))]);
    const chunks = [Buffer.concat([u32(0, material.length + 8), material]), u32(4, 16, 0, 1), u32(5, 12, 0)];
    let offset = 12 + chunks.length * 8;
    const directory = chunks.map((part, i) => { const entry = u32([0, 4, 5][i], offset); offset += part.length; return entry; });
    return Buffer.concat([Buffer.from('INVO'), u32(4, chunks.length), ...directory, ...chunks]);
  };
  assert.equal(parseScx(fixture([[0x06000001, 3]])).meshes[0].textureIndex, 3);
  assert.equal(parseScx(fixture([[0x06000001, 3], [0x06000000, 1]])).meshes[0].textureIndex, 1);
  assert.equal(parseScx(fixture([[0x06000000, 1], [0x06000001, 3]])).meshes[0].textureIndex, 1);
});
test('SCX v4 preserves diffuse UV channel and atlas scale/offset across a vertex group', () => {
  const textureProperty = (type: number, index: number, channel: number, scaleU: number, scaleV: number, offsetU: number, offsetV: number) => {
    const bytes = Buffer.alloc(32);
    bytes.writeUInt32LE(type, 0); bytes.writeUInt32LE(index, 4); bytes.writeUInt32LE(channel, 8); bytes.writeUInt32LE(3, 12);
    [scaleU, scaleV, offsetU, offsetV].forEach((value, i) => bytes.writeFloatLE(value, 16 + i * 4));
    return bytes;
  };
  const material = Buffer.concat([u32(0, 0, 2),
    textureProperty(0x06000001, 3, 0, 1, 1, 0, 0),
    textureProperty(0x06000000, 1, 1, 1, 0.125, 0, 0.5)]);
  const vertex = Buffer.alloc(48);
  [1, 2, 3].forEach((value, i) => vertex.writeFloatLE(value, i * 4));
  [0.1, 0.2, 0.3, 0.4, 0.5, 0.6].forEach((value, i) => vertex.writeFloatLE(value, 24 + i * 4));
  const chunks = [Buffer.concat([u32(0, material.length + 8), material]),
    Buffer.concat([u32(4, 64, 1, 0xe41), vertex]), u32(5, 12, 0)];
  let offset = 12 + chunks.length * 8;
  const directory = chunks.map((part, i) => { const entry = u32([0, 4, 5][i], offset); offset += part.length; return entry; });
  const mesh = parseScx(Buffer.concat([Buffer.from('INVO'), u32(4, chunks.length), ...directory, ...chunks])).meshes[0];
  assert.equal(mesh.textureIndex, 1);
  assert.deepEqual(mesh.textureMap, { channel: 1, tiling: 3, scaleU: 1, scaleV: 0.125, offsetU: 0, offsetV: 0.5 });
  assert.deepEqual(Array.from(mesh.uv).map(x => Number(x.toFixed(3))), [0.1, 0.2]);
  assert.deepEqual(Array.from(mesh.uv2!).map(x => Number(x.toFixed(3))), [0.3, 0.4]);
  assert.deepEqual(Array.from(mesh.uv3!).map(x => Number(x.toFixed(3))), [0.5, 0.6]);
});
test('properties and RDB preserve duplicate texture/slot rows', () => {
  assert.deepEqual(parseProperties('texture 0x01\r\ntexture 0x02 ; note').map(p => p.value), ['0x01', '0x02']);
  assert.equal(parseRdb('<FILE 01.rsd >\ntexture 1\ntexture 2\n</FILE>')[0].properties.length, 2);
});
test('virtual paths are case-insensitive without accepting traversal', () => {
  assert.equal(normalizePath('Cars\\Foo.SCX'), 'cars/foo.scx');
  for (const p of ['../x', '/x', 'C:/x', 'a/../x']) assert.throws(() => normalizePath(p));
});
