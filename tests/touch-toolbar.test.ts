import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAMERA_VIEWS, clampOpacity, imeEdit, VOLUME_GEAR_KEYS } from '../src/render/touch-toolbar';

test('the hidden IME field turns each edit into typed characters or Backspace', () => {
  assert.deepEqual(imeEdit(' a'), { backspace: false, characters: [97] }, 'one typed letter');
  assert.deepEqual(imeEdit(' Max 7'), { backspace: false, characters: [77, 97, 120, 32, 55] }, 'a committed word');
  assert.deepEqual(imeEdit(''), { backspace: true, characters: [] }, 'the sentinel deleted: Backspace');
  assert.deepEqual(imeEdit(' '), { backspace: false, characters: [] }, 'no change');
  assert.deepEqual(imeEdit(' ab😀\u0001'), { backspace: false, characters: [97, 98] }, "Java's lastKey carries 8-bit characters only");
});

test('mobile settings clamp the control opacity and map cameras and volume keys to game keys', () => {
  assert.equal(clampOpacity(.05), .2, 'never fully invisible');
  assert.equal(clampOpacity(1.5), 1);
  assert.equal(clampOpacity(Number.NaN), .8);
  assert.deepEqual(CAMERA_VIEWS.map(view => view.code), ['F4', 'F1', 'F3', 'F2'], 'Track.java camera hotkeys');
  assert.deepEqual(VOLUME_GEAR_KEYS, { VolumeUp: 'KeyA', VolumeDown: 'KeyZ' }, 'ControlSet.defaults gear up/down');
});
