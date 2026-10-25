import assert from 'node:assert/strict';
import test from 'node:test';
import { osdBounds } from '../src/osd/osd-layer';
import { MainMenuRuntime } from '../src/runtime/main-menu-runtime';

test('OSD maps the original screen coordinates to the 16:9 stage', () => {
  assert.deepEqual(osdBounds(0, 0, 2, 2), { left: 0, top: 0, width: 100, height: 100 });
  assert.deepEqual(osdBounds(0, 0, 0.5, 0.5), { left: 37.5, top: 37.5, width: 25, height: 25 });
  assert.deepEqual(osdBounds(-1, -1), { left: 0, top: 0, width: 0, height: 0 });
  assert.deepEqual(osdBounds(1, 1), { left: 100, top: 100, width: 0, height: 0 });
});

const source = `class MainMenu {
  Gates window;
  public void enter(GameState previous) { window = new Gates(); window.myPrevState = previous; window.show(); }
  public void exit(GameState next) { window.hide(); window = null; }
}
class Gates extends Dialog {
  final static int CMD_START = 0xA006;
  final static int CMD_DRIVE = 0xA008;
  final static int CMD_SAVE = 0xA002;
  public void buildSlidingMenu() {
    slider = osd.createSlidingMenu(3.57, 0, 0.475, 1.0, 1, 1, SlidingMenu.STYLE_HORIZONTAL);
    slider.addItem(0.2, 0.35, 2, frontend:0xC107r, frontend:0xC207r, CMD_START, "NEW CAREER");
    if ((GameLogic.gameMode == GameLogic.GM_CARREER || GameLogic.gameMode == GameLogic.GM_SINGLECAR) && player.car)
      slider.addItem(0.2, 0.35, 2, frontend:0xC109r, frontend:0xC209r, CMD_SAVE, "SAVE CAR");
    slider.addItem(0.2, 0.35, 2, frontend:0xC104r, frontend:0xC204r, CMD_DRIVE, "FREERIDE");
    slider.activate(1); slider.setSpeed(0.5); slider.active = 0;
  }
}`;

test('parsed MainMenu.enter executes Gates.buildSlidingMenu and exit', () => {
  const runtime = new MainMenuRuntime(source);
  const built = runtime.enter();
  assert.deepEqual(built, { selected: 1, items: [
    { label: 'NEW CAREER', active: 0xc107, disabled: 0xc207, command: 0xa006 },
    { label: 'FREERIDE', active: 0xc104, disabled: 0xc204, command: 0xa008 },
  ] });
  assert.deepEqual(runtime.trace, ['MainMenu.enter', 'Gates.buildSlidingMenu']);
  runtime.exit();
  assert.deepEqual(runtime.trace, ['MainMenu.enter', 'Gates.buildSlidingMenu', 'MainMenu.exit']);
});

test('game state and source edits change the executed menu', () => {
  const career = new MainMenuRuntime(source, { gameMode: 1, played: false, debugMode: false, hasCar: true }).enter();
  assert.deepEqual(career.items.map(item => item.label), ['NEW CAREER', 'SAVE CAR', 'FREERIDE']);
  const single = new MainMenuRuntime(source, { gameMode: 4, played: false, debugMode: false, hasCar: true }).enter();
  assert.deepEqual(single.items.map(item => item.label), ['NEW CAREER', 'SAVE CAR', 'FREERIDE']);
  const edited = new MainMenuRuntime(source.replace('"FREERIDE"', '"TEST DRIVE"').replace('0xA008', '0xA099')).enter();
  assert.equal(edited.items[1].label, 'TEST DRIVE');
  assert.equal(edited.items[1].command, 0xa099);
  assert.throws(() => new MainMenuRuntime(source.replace('buildSlidingMenu', 'buildSomethingElse')), /buildSlidingMenu missing/);
});
