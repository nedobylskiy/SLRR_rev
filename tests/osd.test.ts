import assert from 'node:assert/strict';
import test from 'node:test';
import { osdBounds } from '../src/osd/osd-layer';
import { MAIN_MENU_ITEMS } from '../src/osd/main-menu';

test('OSD maps the original screen coordinates to the 16:9 stage', () => {
  assert.deepEqual(osdBounds(0, 0, 2, 2), { left: 0, top: 0, width: 100, height: 100 });
  assert.deepEqual(osdBounds(0, 0, 0.5, 0.5), { left: 37.5, top: 37.5, width: 25, height: 25 });
  assert.deepEqual(osdBounds(-1, -1), { left: 0, top: 0, width: 0, height: 0 });
  assert.deepEqual(osdBounds(1, 1), { left: 100, top: 100, width: 0, height: 0 });
});

test('main menu retains the installed Java menu order and command IDs', () => {
  assert.equal(MAIN_MENU_ITEMS[3].label, 'NEW CAREER');
  assert.deepEqual(MAIN_MENU_ITEMS.map(item => item.command),
    [0xa001, 0xa003, 0xa005, 0xa006, 0xa008, 0xa009, 0xb002, 0xb003, 0xb004]);
  assert.equal(new Set(MAIN_MENU_ITEMS.map(item => item.command)).size, MAIN_MENU_ITEMS.length);
});
