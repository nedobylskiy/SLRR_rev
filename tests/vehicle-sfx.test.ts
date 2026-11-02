import test from 'node:test';
import assert from 'node:assert/strict';
import { engineBlendWeights, engineSfxLevels, parseEngineSfx } from '../src/audio/vehicle-sfx';

test('engine sample tables follow the selected Java block and retain its RPM ranges', () => {
  const source = `void updatevariables() {
    if (tab = the_car.getSfxTable(0)) {
      tab.clear();
      tab.addItem(new ResourceRef(parts.engines.Test:0x000000A2r), 3500.0, 500.0, 6500.0, 1.02, 1.12);
      tab.addItem(new ResourceRef(parts.engines.Test:0x000000AAr), 5000.0, 3000.0, 18000.0, 1.02, 1.12);
    }
    if (tab = the_car.getSfxTable(2)) {
      tab.clear();
      tab.addItem(new ResourceRef(parts.engines.Test:0x000000ABr), 1500.0, 750.0, 2500.0, 1.9, 2.0);
      the_car.setSfxExhaustMinVol(0.6);
    }
  }`;
  const profile = parseEngineSfx(source);
  assert.deepEqual(profile.items.map(item => [item.table, item.pack, item.id]), [
    [0, 'parts/engines/Test.rpk', 0xa2], [0, 'parts/engines/Test.rpk', 0xaa], [2, 'parts/engines/Test.rpk', 0xab],
  ]);
  assert.equal(profile.exhaustMinVolume, 0.6);
  const weights = engineBlendWeights(profile.items.filter(item => item.table === 0), 4000);
  assert.ok(weights[0] > 0 && weights[1] > 0);
  assert.ok(Math.abs(weights[0] + weights[1] - 1) < 1e-9);
  assert.deepEqual(engineBlendWeights(profile.items.filter(item => item.table === 0), 20000), [0, 1]);
});

test('native SfxTable crossfades overlapping ranges without treating reference RPM as a volume peak', () => {
  const items = [
    { table: 0, pack: '', id: 1, referenceRpm: 1800, minRpm: 500, maxRpm: 4500, minVolume: 0.5, maxVolume: 1 },
    { table: 0, pack: '', id: 2, referenceRpm: 6000, minRpm: 3000, maxRpm: 8500, minVolume: 0.5, maxVolume: 1 },
  ];
  assert.deepEqual(engineBlendWeights(items, 1800), [1, 0]);
  assert.deepEqual(engineBlendWeights(items, 3750), [0.5, 0.5]);
  assert.deepEqual(engineBlendWeights(items, 6000), [0, 1]);
  assert.deepEqual(engineSfxLevels(items, 3750), [0.5 * 0.90625, 0.5 * (0.5 + 0.5 * 750 / 5500)]);
});

test('a gap in an RPM table keeps the nearest available engine sample', () => {
  const items = [
    { table: 2, pack: '', id: 1, referenceRpm: 1500, minRpm: 750, maxRpm: 2500, minVolume: 1, maxVolume: 1 },
    { table: 2, pack: '', id: 2, referenceRpm: 6200, minRpm: 4000, maxRpm: 18000, minVolume: 1, maxVolume: 1 },
  ];
  assert.deepEqual(engineBlendWeights(items, 3000), [1, 0]);
  assert.deepEqual(engineBlendWeights(items, 3250), [0.5, 0.5]);
  assert.deepEqual(engineBlendWeights(items, 3750), [0, 1]);
  assert.deepEqual(engineBlendWeights(items, 1000), [1, 0]);
});
