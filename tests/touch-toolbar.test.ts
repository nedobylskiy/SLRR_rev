import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAMERA_VIEWS, clampOpacity, DEFAULT_PLACEMENT, imeEdit, parsePlacement, placementAt, placementOffset, VOLUME_GEAR_KEYS } from '../src/render/touch-toolbar';

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

test('the button bar placement survives resizes, round-trips a drag and docks collapsed at the nearer edge', () => {
  assert.deepEqual(parsePlacement(null), DEFAULT_PLACEMENT, 'top right by default');
  assert.deepEqual(parsePlacement('{"x":-3,"y":0.5,"collapsed":true}'), { x: 0, y: .5, collapsed: true });
  assert.deepEqual(parsePlacement('nonsense'), DEFAULT_PLACEMENT);
  const screen = { width: 1000, height: 500 }, bar = { width: 200, height: 50 };
  assert.deepEqual(placementOffset(DEFAULT_PLACEMENT, screen, bar), { left: 794, top: 6 });
  const dragged = placementAt(300, 200, screen, bar, false);
  assert.deepEqual(placementOffset(dragged, screen, bar), { left: 300, top: 200 }, 'a drag lands where it was dropped');
  assert.deepEqual(placementOffset(dragged, { width: 2000, height: 1000 }, bar).left > 300, true, 'it scales with the window');
  const grip = { width: 30, height: 50 };
  assert.deepEqual(placementOffset({ x: .3, y: 0, collapsed: true }, screen, grip), { left: 0, top: 6 }, 'collapsed left of centre: left edge');
  assert.deepEqual(placementOffset({ x: .7, y: 0, collapsed: true }, screen, grip), { left: 970, top: 6 }, 'collapsed right of centre: right edge');
  assert.equal(placementAt(800, 100, screen, grip, true).x, 1, 'a collapsed grip dropped on the right docks right');
  assert.equal(placementAt(100, 100, screen, grip, true).x, 0);
});
