import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RpkPack } from '../src/formats/rpk';
import { packedResourceId } from '../src/runtime/resource-ids';

test('resource literals use the source pack dependency slot', () => {
  const frontend: RpkPack = { version: 0x200, entries: [], warnings: [],
    dependencies: [{ id: 0x30000, path: 'cars.rpk', trailer: 0 }] };
  assert.equal(packedResourceId(frontend, { pack: 'cars', id: 0x2a }), 196650);
  assert.equal(packedResourceId(frontend, { pack: 'unknown', id: 0x2a }), undefined);
  assert.equal(packedResourceId(frontend, { pack: 'cars', id: 0x1002a }), undefined);
});
