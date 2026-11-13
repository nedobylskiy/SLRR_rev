import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RpkPack } from '../src/formats/rpk';
import { packedResourceId, instanceResourceIdentity } from '../src/runtime/resource-ids';

test('resource literals use the source pack dependency slot', () => {
  const frontend: RpkPack = { version: 0x200, entries: [], warnings: [],
    dependencies: [{ id: 0x30000, path: 'cars.rpk', trailer: 0 }] };
  assert.equal(packedResourceId(frontend, { pack: 'cars', id: 0x2a }), 196650);
  assert.equal(packedResourceId(frontend, { pack: 'unknown', id: 0x2a }), undefined);
  assert.equal(packedResourceId(frontend, { pack: 'cars', id: 0x1002a }), undefined);
});

test('live part compatibility uses its own pack and local ID despite ambiguous dependency slots', () => {
  const node={resourcePack:'parts.engines.MC_Prime_SuperDuty',typeId:0x7000a};
  assert.deepEqual(instanceResourceIdentity(node,()=>undefined),{pack:'parts/engines/mc_prime_superduty.rpk',id:0xa});
  assert.deepEqual(instanceResourceIdentity(node,()=>({pack:'other.rpk',id:0xa})),{pack:'parts/engines/mc_prime_superduty.rpk',id:0xa});
  assert.deepEqual(instanceResourceIdentity({...node,resourcePack:null},()=>({pack:'parts.engines.MC_Prime_SuperDuty',id:0xa})),{pack:'parts/engines/mc_prime_superduty.rpk',id:0xa});
});
