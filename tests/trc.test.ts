import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseTrc, sampleRoadSegment } from '../src/formats/trc';
import { Assets } from '../src/assets';
import { loadMapRoads } from '../src/engine/map-roads';

function fixture() {
  const data: number[] = [];
  const u32 = (value: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(value); data.push(...b); };
  const f32 = (value: number) => { const b = Buffer.alloc(4); b.writeFloatLE(value); data.push(...b); };
  const segment = () => { for (const n of [0, 1, 0, 10, 1, 0, 10, 0, 0, 10, 0, 0, 10]) f32(n); u32(0xffffffff); data.push(1); };
  [1, 1, 0, 1, 1].forEach(u32); // version, two node counts, paths, others
  u32(1); u32(3); data.push(1); // link to other record
  u32(1); data.push(...new Array(12).fill(0)); segment();
  [2, 1, 3].forEach(f32); u32(0);
  [3, 1, 0].forEach(u32); new Array(7).fill(0).forEach(u32); u32(1); segment();
  [1, 0].forEach(u32); data.push(1); new Array(12).fill(0).forEach(u32);
  [0, 0, 0, 0].forEach(u32); [13.888889, .9].forEach(f32); u32(0xffffffff); u32(1); segment();
  return Uint8Array.from(data);
}

test('TRC preserves one-based references, Hermite geometry and unknown metadata', () => {
  const network = parseTrc(fixture());
  assert.deepEqual(network.nodes[0].position, [2, 1, 3]);
  assert.equal(network.nodes[0].links[0].target, 3);
  assert.deepEqual(network.paths[0].refs, [3, 1, 0]);
  assert.equal(network.paths[0].id, 2); assert.equal(network.others[0].id, 3);
  assert.equal(network.others[0].tail[2], 0xffffffff);
  const segment = network.paths[0].segments[0];
  assert.deepEqual(sampleRoadSegment(segment, 0), [0, 1, 0]);
  assert.deepEqual(sampleRoadSegment(segment, 1), [10, 1, 0]);
  assert.deepEqual(sampleRoadSegment(segment, .5), [5, 1, 0]);
  segment.startTangent[1] = 8; segment.endTangent[1] = -8;
  assert.deepEqual(sampleRoadSegment(segment, .5), [5, 3, 0]);
});

test('TRC rejects truncation, invalid references, unsupported versions and trailing data', () => {
  const bytes = fixture();
  for (const offset of [0, 19, 40, bytes.length - 1]) assert.throws(() => parseTrc(bytes.slice(0, offset)), /TRC/);
  const bad = bytes.slice(); new DataView(bad.buffer).setUint32(24, 99, true);
  assert.throws(() => parseTrc(bad), /reference/);
  const version = bytes.slice(); version[0] = 2; assert.throws(() => parseTrc(version), /version/);
  assert.throws(() => parseTrc(Uint8Array.from([...bytes, 0])), /trailing/);
  const coordinates = bytes.slice(); new DataView(coordinates.buffer).setFloat32(53, Infinity, true);
  assert.throws(() => parseTrc(coordinates), /geometry/);
});

test('map road loads cache data, do not borrow the city graph for another map, and retry errors', async () => {
  let reads = 0, broken = false;
  const path = 'maps/city/ai/city.trc';
  const assets = new Assets([{ path, size: 1 }], async () => { reads++; if (broken) throw Error('failed read'); return fixture(); });
  assets.pack = async () => ({ version: 1, entries: [], dependencies: [], warnings: [] });
  assert.equal(await loadMapRoads(assets, 'maps/test_track.rpk'), undefined);
  const [a, b] = await Promise.all([loadMapRoads(assets, 'maps/city.rpk'), loadMapRoads(assets, 'maps/city.rpk')]);
  assert.equal(a?.network, b?.network); assert.equal(reads, 1);
  const retry = new Assets([{ path, size: 1 }], async () => { if (broken) throw Error('failed read'); return fixture(); }); retry.pack = assets.pack;
  broken = true; await assert.rejects(loadMapRoads(retry, 'maps/city.rpk'), /failed read/);
  broken = false; assert.ok(await loadMapRoads(retry, 'maps/city.rpk'));
});

test('selected grounds use explicit TRC paths and do not fall back to map directory guesses', async () => {
  const path = 'maps/custom/ai/special.trc', bytes = new TextEncoder().encode(`params 0x1,0,0,0,0,0,0,materials.cfg,maps\\custom\\ai\\special.trc\0`);
  const assets = new Assets([{ path, size: 1 }], async () => fixture());
  assets.pack = async () => ({ version: 1, dependencies: [], warnings: [], entries: [{ type: 1, typeId: 7, superId: 0, compatibility: 0, flags: 0, alias: '', offset: 0, size: bytes.length, data: bytes }] });
  assert.equal((await loadMapRoads(assets, 'maps/custom.rpk', 7))?.path, path);
  assert.equal(await loadMapRoads(assets, 'maps/custom.rpk', 9), undefined);
});
