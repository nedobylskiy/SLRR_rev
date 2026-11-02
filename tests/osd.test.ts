import assert from 'node:assert/strict';
import test from 'node:test';
import { osdBounds, osdMotionInterval } from '../src/osd/osd-layer';
import { MainMenuRuntime } from '../src/runtime/main-menu-runtime';
import { SoundJavaBridge } from '../src/audio/sound-java';
import type { MusicEngine } from '../src/audio/music-engine';

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
  final static int CMD_MENU_LEFT = 0xB005;
  final static int CMD_MENU_RIGHT = 0xB006;
  final static int CMD_MENU_SELECT = 0xB007;
  public void buildSlidingMenu() {
    slider = osd.createSlidingMenu(3.57, 0, 0.475, 1.0, 1, 1, SlidingMenu.STYLE_HORIZONTAL);
    slider.addItem(0.2, 0.35, 2, frontend:0xC107r, frontend:0xC207r, CMD_START, "NEW CAREER");
    if ((GameLogic.gameMode == GameLogic.GM_CARREER || GameLogic.gameMode == GameLogic.GM_SINGLECAR) && player.car)
      slider.addItem(0.2, 0.35, 2, frontend:0xC109r, frontend:0xC209r, CMD_SAVE, "SAVE CAR");
    slider.addItem(0.2, 0.35, 2, frontend:0xC104r, frontend:0xC204r, CMD_DRIVE, "FREERIDE");
    slider.activate(1); slider.setSpeed(0.5); slider.active = 0;
  }
  public void osdCommand(int cmd) {
    switch(cmd) {
      case(CMD_MENU_LEFT): if(slider) slider.execute(Osd.CMD_MENU_LF); break;
      case(CMD_MENU_RIGHT): if(slider) slider.execute(Osd.CMD_MENU_RG); break;
      case(CMD_MENU_SELECT): if(slider) slider.execute(Osd.CMD_MENU_SEL); break;
    }
  }
  public void showPrimaryVisuals() {
    center_line.runAnimation(0.2, 25, 1, "X");
    slider.teleport(0.1, 50, 1, "X");
    logo_streetlegal_resized.runAnimation(0.1, 30, -1, "X");
    logo_redline_resized.runAnimation(0.115, 15, -1, "X");
    messageSeek = 2; showMenu = 2;
  }
  public void cleanup() {
    message.changeText(""); osd.hideGroup(0); slider.deactivate();
    slider.teleport(0.25, 30, 1, "X");
    center_line.runAnimation(0.2, 25, -1, "X");
    logo_streetlegal_resized.reverseAnimation("X");
    logo_redline_resized.reverseAnimation("X");
    showMenu = 3;
  }
}`;

test('parsed MainMenu.enter executes Gates.buildSlidingMenu and exit', () => {
  const runtime = new MainMenuRuntime(source);
  const built = runtime.enter();
  // Build 940's literal conversion differs by one ULP from Math.fround for these values.
  assert.deepEqual(built, { selected: 1, layout: { spacing: 0.4750000238418579, y: 0, speed: 0.5 }, items: [
    { label: 'NEW CAREER', active: { pack: 'frontend', id: 0xc107 }, disabled: { pack: 'frontend', id: 0xc207 }, command: 0xa006, width: Math.fround(0.2), height: 0.3500000238418579, depth: 2 },
    { label: 'FREERIDE', active: { pack: 'frontend', id: 0xc104 }, disabled: { pack: 'frontend', id: 0xc204 }, command: 0xa008, width: Math.fround(0.2), height: 0.3500000238418579, depth: 2 },
  ] });
  assert.deepEqual(runtime.trace, ['MainMenu.enter', 'Gates.buildSlidingMenu']);
  assert.deepEqual(runtime.primaryVisuals().map(motion => motion.target), ['center_line', 'slider', 'logo_streetlegal_resized', 'logo_redline_resized']);
  assert.deepEqual(runtime.cleanupVisuals().map(motion => motion.operation), ['teleport', 'runAnimation', 'reverseAnimation', 'reverseAnimation']);
  assert.deepEqual(runtime.dispatchMenuAction('left'), { selected: 0, command: undefined });
  assert.deepEqual(runtime.dispatchMenuAction('select'), { selected: 0, command: 0xa006 });
  assert.deepEqual(runtime.dispatchMenuAction('right'), { selected: 1, command: undefined });
  runtime.exit();
  assert.deepEqual(runtime.trace, ['MainMenu.enter', 'Gates.buildSlidingMenu', 'Gates.showPrimaryVisuals', 'Gates.cleanup', 'Gates.osdCommand', 'Gates.osdCommand', 'Gates.osdCommand', 'MainMenu.exit']);
});

test('a Sound call in interpreted menu Java reaches the native music host', () => {
  const sets: number[] = [];
  const sound = new SoundJavaBridge({ changeMusicSet: (set: number) => sets.push(set) } as unknown as MusicEngine);
  const edited = source.replace('public void buildSlidingMenu() {', 'public void buildSlidingMenu() { Sound.changeMusicSet(Sound.MUSIC_SET_MENU);');
  new MainMenuRuntime(edited, undefined, sound).enter();
  assert.deepEqual(sets, [1]);
});

test('game state and source edits change the executed menu', () => {
  const career = new MainMenuRuntime(source, { gameMode: 1, played: false, debugMode: false, hasCar: true }).enter();
  assert.deepEqual(career.items.map(item => item.label), ['NEW CAREER', 'SAVE CAR', 'FREERIDE']);
  const single = new MainMenuRuntime(source, { gameMode: 4, played: false, debugMode: false, hasCar: true }).enter();
  assert.deepEqual(single.items.map(item => item.label), ['NEW CAREER', 'SAVE CAR', 'FREERIDE']);
  const edited = new MainMenuRuntime(source.replace('"FREERIDE"', '"TEST DRIVE"').replace('0xA008', '0xA099')).enter();
  assert.equal(edited.items[1].label, 'TEST DRIVE');
  assert.equal(edited.items[1].command, 0xa099);
  const threeItems = source.replace('slider.activate(1);', 'slider.addItem(0.3, 0.4, 2, addon:0xC111r, addon:0xC211r, CMD_SAVE, "THIRD"); slider.activate(1);');
  const remapped = new MainMenuRuntime(threeItems.replace('slider.execute(Osd.CMD_MENU_LF)', 'slider.execute(Osd.CMD_MENU_RG)'));
  remapped.enter();
  assert.equal(remapped.dispatchMenuAction('left').selected, 2);
  assert.equal(new MainMenuRuntime(threeItems.replace('0.475', '0.6')).enter().layout.spacing, Math.fround(0.6));
  const differentPack = new MainMenuRuntime(source.replace('frontend:0xC104r', 'addon:0xC104r')).enter();
  assert.equal(differentPack.items[1].active.pack, 'addon');
  const customMotion = new MainMenuRuntime(source.replace('runAnimation(0.2, 25, 1', 'runAnimation(0.3, 40, 1'));
  customMotion.enter();
  assert.deepEqual(customMotion.primaryVisuals()[0], { target: 'center_line', operation: 'runAnimation', speed: Math.fround(0.3), steps: 40, direction: 1, axis: 'X' });
  assert.throws(() => new MainMenuRuntime(source.replace('buildSlidingMenu', 'buildSomethingElse')), /buildSlidingMenu missing/);
});

test('source show and run control selection and label color, with finite native slider bounds', () => {
  const scripted = source.replace('  public void buildSlidingMenu() {', `
    ColorBank bank = new ColorBank();
    int m_idx; int m_dir = 1; int m_iterator = 3;
    public void show() { osd.createText("version from source"); buildSlidingMenu(); slider.activate(0); slider.active = 1; showMenu = 2; }
    public void run() { for(;;) {
      if(message.text && message.text != "") {
        if(m_iterator == 3) { m_idx += m_dir; message.setColor(bank.getColor(m_idx)); m_iterator = 0; }
        else m_iterator++;
      }
      if(slider && slider.active && showMenu > 0) message.changeText(slider.getLabel());
    } }
    public void buildSlidingMenu() {`) + `
    class ColorBank {
      int[] color = new int[2];
      public ColorBank() { color[1] = 0xF0BB0000; }
      public int getColor(int id) { return color[id]; }
    }`;
  const runtime = new MainMenuRuntime(scripted);
  assert.equal(runtime.enter().selected, 0);
  assert.equal(runtime.versionText, 'version from source');
  assert.equal(runtime.dispatchMenuAction('left').selected, 0);
  assert.equal(runtime.tick().text, 'NEW CAREER');
  assert.equal(runtime.tick().color >>> 0, 0xF0BB0000);
  assert.equal(runtime.dispatchMenuAction('right').selected, 1);
  assert.equal(runtime.tick().text, 'FREERIDE');
  assert.equal(runtime.dispatchMenuAction('right').selected, 1);
});

test('OSD animation interval follows Java steps and direction', () => {
  assert.deepEqual(osdMotionInterval(50, { operation: 'runAnimation', speed: 0.2, steps: 25, direction: 1, axis: 'X' }), [-200, 50]);
  assert.deepEqual(osdMotionInterval(50, { operation: 'teleport', speed: 0.1, steps: 50, direction: 1, axis: 'X' }), [300, 50]);
});
