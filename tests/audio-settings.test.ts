import test from 'node:test';
import assert from 'node:assert/strict';
import { skidLoudness } from '../src/audio/audio-settings';

test('stationary burnout stays louder than a high-speed slide', () => {
  assert.equal(skidLoudness(0), 1);
  assert.equal(skidLoudness(8), 1);
  assert.ok(skidLoudness(20) < 1);
  assert.ok(skidLoudness(30) < skidLoudness(20));
  assert.ok(Math.abs(skidLoudness(30) - 0.45) < 1e-12);
});
