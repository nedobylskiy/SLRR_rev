import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeVehicle, deserializeVehicle, type VehicleState } from '../src/runtime/vehicle-state';
import { parseSdat, inspectSavedVehicle } from '../src/formats/sdat';

function vehicle(): VehicleState {
  return { vehicleId: 'car-1', tick: 812, contentHash: 'test-manifest-hash', rootPartId: 'chassis',
    position: [10, 0, -4], rotation: [0, 0, 0, 1], linearVelocity: [12, 0, 0], angularVelocity: [0, 0.1, 0], rpm: 3200, gear: 3,
    parts: [
      { id: 'chassis', parentId: null, parentSlot: 0, ownSlot: 0, resource: { pack: 'cars/test.rpk', localId: 6 }, texture: null, mesh: null, position: [0, 0, 0], rotation: [0, 0, 0, 1], wear: 0.8, tear: 0.9, scriptVersion: 3, script: { mileage: 1234, brakeBalance: 0.6, wheelDamage: ['0', '1', '0', '0'] } },
      { id: 'wheel-fl', parentId: 'chassis', parentSlot: 101, ownSlot: 1, resource: { pack: 'parts/wheels.rpk', localId: 33 }, texture: null, mesh: null, position: [-1, 0, 1], rotation: [0, 0, 0, 1], wear: 0.7, tear: 1, scriptVersion: 1, script: { pressure: 2.3 } }
    ] };
}

test('vehicle bytes round-trip graph, tuning, damage and both velocities entirely in memory', () => {
  const original = vehicle(), bytes = serializeVehicle(original), restored = deserializeVehicle(bytes, original.contentHash);
  assert.deepEqual(restored, original);
  restored.parts[0].script.mileage = 9000; restored.position[0] = 1000;
  assert.equal(original.parts[0].script.mileage, 1234); assert.equal(original.position[0], 10);
  assert.equal(deserializeVehicle(bytes).position[0], 10);
});
test('repeated snapshots do not accumulate serializer state or require disk writes', () => {
  const original = vehicle(), expected = serializeVehicle(original);
  for (let i = 0; i < 1000; i++) assert.deepEqual(serializeVehicle(deserializeVehicle(expected)), expected);
});
test('reject corrupted, truncated, wrong-version and mismatched-content snapshots', () => {
  const bytes = serializeVehicle(vehicle());
  for (const length of [0, 5, 15, bytes.length - 1]) assert.throws(() => deserializeVehicle(bytes.subarray(0, length)));
  const bad = bytes.slice(); bad[20] ^= 1; assert.throws(() => deserializeVehicle(bad));
  const version = bytes.slice(); version[4] = 2; assert.throws(() => deserializeVehicle(version));
  assert.throws(() => deserializeVehicle(bytes, 'different-content'));
});
test('reject cyclic/missing attachments, duplicate IDs, invalid physics and unserializable fields', () => {
  const checks = [
    (v: VehicleState) => { v.parts[1].parentId = 'missing'; },
    (v: VehicleState) => { v.parts[1].parentId = 'wheel-fl'; },
    (v: VehicleState) => { v.parts[1].id = 'chassis'; },
    (v: VehicleState) => { v.rpm = NaN; },
    (v: VehicleState) => { v.rotation = [0, 0, 0, 0]; },
    (v: VehicleState) => { const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic; v.parts[0].script = cyclic as never; }
  ];
  for (const mutate of checks) { const v = vehicle(); mutate(v); assert.throws(() => serializeVehicle(v)); }
});

function u32(...nums: number[]) { const b = Buffer.alloc(nums.length * 4); nums.forEach((v, i) => b.writeUInt32LE(v >>> 0, i * 4)); return b; }
test('SDAT trailer remaps resource IDs by pack path, independent of engine load order', () => {
  const name = Buffer.from('cars/test.rpk\0'), trailer = Buffer.concat([u32(0, 1, 7, name.length), name]);
  const payload = u32(0x12345678);
  const bytes = Buffer.concat([Buffer.from([83, 68, 65, 84, 0, 1, 2, 0]), payload, trailer, u32(trailer.length)]);
  const parsed = parseSdat(bytes); assert.equal(parsed.packs.get(7), 'cars/test.rpk'); assert.deepEqual(parsed.payload, new Uint8Array(payload));
  assert.throws(() => inspectSavedVehicle(bytes));
  assert.throws(() => parseSdat(bytes.subarray(0, bytes.length - 1)));
});
