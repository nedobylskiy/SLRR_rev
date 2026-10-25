import { JavaSourceMachine, jv, nil, parseSourceClass, type JavaHost, type JavaValue, type SourceClass } from './java-source';

export interface MenuResource { pack: string; id: number }
export interface MainMenuItem { label: string; active: MenuResource; disabled: MenuResource; command: number; width: number; height: number; depth: number }
export interface MainMenuLayout { spacing: number; y: number; speed: number }
export interface MenuMotion { target: string; operation: 'runAnimation' | 'teleport' | 'reverseAnimation'; speed: number; steps: number; direction: number; axis: string }
export interface MainMenuState { gameMode: number; played: boolean; debugMode: boolean; hasCar: boolean }
export const INITIAL_MENU_STATE: MainMenuState = { gameMode: 0, played: false, debugMode: false, hasCar: false };

interface Slider { items: MainMenuItem[]; selected: number; active: number; speed: number; spacing: number; y: number }
interface Gates { myPrevState: JavaValue; slider: Slider | null; messageSeek: number; showMenu: number; fields: Map<string, JavaValue> }
interface MainMenu { window: Gates | null }

function integer(value: JavaValue) {
  if (!Number.isInteger(value.value)) throw new Error(`Expected Java integer, got ${value.type}`);
  return value.value as number;
}

/** Executes the installed Java entry/exit and menu-building methods against narrow OSD host objects. */
export class MainMenuRuntime implements JavaHost {
  readonly mainClass: SourceClass;
  readonly gatesClass: SourceClass;
  readonly colorBankClass: SourceClass | undefined;
  readonly trace: string[] = [];
  private readonly machine = new JavaSourceMachine(this, 50_000);
  private readonly menu: MainMenu = { window: null };
  private readonly osd = { tag: 'Osd' };
  private readonly gameLogic = { tag: 'GameLogic' };
  private readonly player: { car: object | null };
  private motion: MenuMotion[] = [];
  private messageText = '';
  private messageColor = 0xff000000;
  versionText = '';

  constructor(source: string, readonly state: MainMenuState = INITIAL_MENU_STATE) {
    this.mainClass = parseSourceClass(source, new Set(['enter', 'exit']), 'MainMenu');
    this.gatesClass = parseSourceClass(source, new Set(['Gates', 'show', 'hide', 'buildSlidingMenu', 'osdCommand', 'showPrimaryVisuals', 'cleanup', 'run']), 'Gates');
    this.colorBankClass = source.includes('class ColorBank') ? parseSourceClass(source, new Set(['ColorBank', 'getColor']), 'ColorBank') : undefined;
    this.player = { car: state.hasCar ? {} : null };
    for (const name of ['enter', 'exit']) if (!this.mainClass.methods.some(method => method.name === name)) throw new Error(`MainMenu.${name} missing`);
    if (!this.gatesClass.methods.some(method => method.name === 'buildSlidingMenu')) throw new Error('Gates.buildSlidingMenu missing');
  }

  enter(previous: JavaValue = nil()) {
    if (this.menu.window) throw new Error('MainMenu already entered');
    this.run(this.mainClass, 'enter', jv('MainMenu', this.menu), [previous]);
    const slider = (this.menu as MainMenu).window?.slider;
    if (!slider?.items.length || slider.selected < 0 || slider.selected >= slider.items.length) throw new Error('MainMenu built no valid sliding menu');
    return { items: slider.items.map(item => ({ ...item })), selected: slider.selected,
      layout: { spacing: slider.spacing, y: slider.y, speed: slider.speed } satisfies MainMenuLayout };
  }

  /** Send a UI action through the Java osdCommand switch and its SlidingMenu native. */
  dispatchMenuAction(action: 'left' | 'right' | 'select') {
    const name = { left: 'CMD_MENU_LEFT', right: 'CMD_MENU_RIGHT', select: 'CMD_MENU_SELECT' }[action];
    const command = this.gatesClass.constants.get(name);
    const window = this.menu.window;
    if (!window?.slider || !command) throw new Error(`Java menu action unavailable: ${name}`);
    const method = this.gatesClass.methods.find(method => method.name === 'osdCommand');
    if (!method) throw new Error('Gates.osdCommand missing');
    this.pendingCommand = undefined;
    this.run(this.gatesClass, 'osdCommand', jv('Gates', window), [command]);
    return { selected: window.slider.selected, command: this.pendingCommand };
  }

  primaryVisuals(): MenuMotion[] {
    const window = this.menu.window;
    if (!window) throw new Error('MainMenu not entered');
    if (!this.gatesClass.methods.some(method => method.name === 'showPrimaryVisuals')) return [];
    this.motion = [];
    this.run(this.gatesClass, 'showPrimaryVisuals', jv('Gates', window), []);
    return this.motion.map(motion => ({ ...motion }));
  }

  cleanupVisuals(): MenuMotion[] {
    const window = this.menu.window;
    if (!window || !this.gatesClass.methods.some(method => method.name === 'cleanup')) return [];
    this.motion = [];
    this.run(this.gatesClass, 'cleanup', jv('Gates', window), []);
    return this.motion.map(motion => ({ ...motion }));
  }

  private pendingCommand: number | undefined;

  /** Advance one iteration of the installed Gates.run animation loop. */
  tick() {
    const window = this.menu.window;
    const method = this.gatesClass.methods.find(method => method.name === 'run');
    if (window && method) this.machine.invokeTick(method, jv('Gates', window), []);
    return { text: this.messageText, color: this.messageColor };
  }

  exit(next: JavaValue = nil()) {
    if (!this.menu.window) return;
    this.run(this.mainClass, 'exit', jv('MainMenu', this.menu), [next]);
  }

  private run(cls: SourceClass, name: string, receiver: JavaValue, args: JavaValue[]) {
    const method = cls.methods.find(method => method.name === name);
    if (!method) throw new Error(`Missing source method ${cls.name}.${name}`);
    this.trace.push(`${cls.name}.${name}`);
    return this.machine.invoke(method, receiver, args);
  }

  parent(name: string) { return name === 'Gates' ? 'Dialog' : null; }
  global(name: string): JavaValue {
    if (name === 'GameLogic') return jv('GameLogic', this.gameLogic);
    if (name === 'SlidingMenu') return jv('class', 'SlidingMenu');
    if (['Osd', 'Input', 'Sound', 'Frontend', 'Config', 'GfxEngine', 'Steam', 'Text', 'System', 'Thread'].includes(name)) return jv('class', name);
    if (name === 'osd') return jv('Osd', this.osd);
    if (name === 'player') return jv('Player', this.player);
    if (name.startsWith('DF_')) return jv('int', 0);
    const constant = this.gatesClass.constants.get(name);
    if (constant) return constant;
    throw new Error(`Unknown menu Java name ${name}`);
  }
  get(receiver: JavaValue, name: string): JavaValue {
    if (receiver.value === this.menu && name === 'window') return jv('Gates', this.menu.window);
    if (receiver.value === this.gameLogic) {
      if (name === 'gameMode') return jv('int', this.state.gameMode);
      if (name === 'GM_CARREER') return jv('int', 1);
      if (name === 'GM_SINGLECAR') return jv('int', 4);
      if (name === 'played') return jv('int', Number(this.state.played));
      if (name === 'DEBUG_MODE') return jv('int', Number(this.state.debugMode));
      if (name === 'player') return jv('Player', this.player);
      if (name === 'carrerInProgress') return jv('int', 0);
    }
    if (receiver.value === 'SlidingMenu' && name === 'STYLE_HORIZONTAL') return jv('int', 0);
    if (receiver.value === 'Osd') {
      const commands: Record<string, number> = { CMD_MENU_LF: 1, CMD_MENU_RG: 2, CMD_MENU_SEL: 3 };
      if (name in commands) return jv('int', commands[name]);
    }
    if (receiver.value === 'Input' && name === 'AXIS_SELECT') return jv('int', -1);
    if (receiver.value === 'Input' && name === 'cursor') return jv('Cursor', { tag: 'Cursor' });
    if (receiver.value === 'Input' && name === 'VIRTUAL') return jv('int', 1);
    if (receiver.value === 'Sound' && name === 'MUSIC_SET_MENU') return jv('int', 1);
    if (receiver.value === 'Frontend') return jv(name === 'loadingScreen' ? 'LoadingScreen' : 'Font', { name });
    if (receiver.value === 'Config' && name === 'version') return jv('String', 'v2.3.1');
    if (receiver.value === 'Steam' && name === 'ready') return jv('int', 1);
    if (receiver.value === 'Text' && name.startsWith('ALIGN_')) return jv('int', 0);
    if (receiver.value === 'Thread' && name === 'MAX_PRIORITY') return jv('int', 10);
    if (receiver.value === 'Osd' && ['MD_HORIZONTAL', 'RRT_GHOST', 'HK_STATIC'].includes(name)) return jv('int', 0);
    if (receiver.value === this.osd && name === 'globalHandler') return jv('Gates', this.menu.window);
    const obj = receiver.value;
    if (obj && typeof obj === 'object') {
      if ('slider' in obj && name === 'slider') return jv('SlidingMenu', (obj as Gates).slider);
      if ('slider' in obj && name === 'message') return jv('MenuText', { name });
      if ('slider' in obj && name === 'mmaThread') return jv('Thread', { name });
      if ('slider' in obj && name === 'arrowGroup') return jv('int', 0);
      if ('slider' in obj && ['center_line', 'logo_streetlegal', 'logo_redline', 'logo_streetlegal_resized', 'logo_redline_resized'].includes(name)) return jv('MenuVisual', { name });
      if ('slider' in obj && (name === 'messageSeek' || name === 'showMenu')) return jv('int', (obj as Gates)[name]);
      if ('myPrevState' in obj && name === 'myPrevState') return (obj as Gates).myPrevState;
      if ('slider' in obj && name === 'osd') return jv('Osd', this.osd);
      if ('car' in obj && name === 'car') return jv('Vehicle', (obj as typeof this.player).car);
      if ('car' in obj && name === 'controller') return jv('Controller', {});
      if ('name' in obj && (name === 'rect' || name === 'phy')) return jv('MenuVisual', { name: `${String((obj as { name: string }).name)}.${name}` });
      if ('items' in obj && name === 'active') return jv('int', (obj as Slider).active);
      if ('items' in obj && name === 'rect') return jv('MenuVisual', { name: 'slider-item' });
      if ('name' in obj && name === 'a_finished_x') return jv('int', 1);
      if ('name' in obj && name === 'text') return jv('String', this.messageText);
      if ('fields' in obj && (obj as Gates).fields.has(name)) return (obj as Gates).fields.get(name)!;
    }
    throw new Error(`Missing menu field ${receiver.type}.${name}`);
  }
  set(receiver: JavaValue, name: string, value: JavaValue): void {
    if (receiver.value === this.menu && name === 'window') { this.menu.window = value.value as Gates | null; return; }
    const obj = receiver.value;
    if (obj && typeof obj === 'object') {
      if (obj === this.osd && name === 'globalHandler') return;
      if ('slider' in obj && (name === 'messageSeek' || name === 'showMenu')) { (obj as Gates)[name] = integer(value); return; }
      if ('myPrevState' in obj && name === 'myPrevState') { (obj as Gates).myPrevState = value; return; }
      if ('slider' in obj && name === 'slider') { (obj as Gates).slider = value.value as Slider; return; }
      if ('items' in obj && name === 'active') { (obj as Slider).active = integer(value); return; }
      if ('fields' in obj) { (obj as Gates).fields.set(name, value); return; }
    }
    throw new Error(`Cannot set menu field ${receiver.type}.${name}`);
  }
  construct(name: string, args: JavaValue[]): JavaValue {
    if (name === 'Gates' && args.length === 0) {
      const value = jv('Gates', { myPrevState: nil(), slider: null, messageSeek: 0, showMenu: 0, fields: new Map() } satisfies Gates);
      this.machine.initializeFields(this.gatesClass, value);
      if (this.gatesClass.methods.some(method => method.name === 'Gates')) this.run(this.gatesClass, 'Gates', value, []);
      return value;
    }
    if (name === 'ColorBank' && args.length === 0 && this.colorBankClass) {
      const value = jv('ColorBank', { fields: new Map<string, JavaValue>() });
      this.machine.initializeFields(this.colorBankClass, value);
      this.run(this.colorBankClass, 'ColorBank', value, []);
      return value;
    }
    if (name === 'ResourceRef' && args.length === 1) return jv('ResourceRef', args[0].value);
    if (['Style', 'Vector3', 'Thread'].includes(name)) return jv(name, { name, args });
    throw new Error(`Unsupported menu constructor ${name}`);
  }
  call(receiver: JavaValue, name: string, args: JavaValue[], fromClass?: string): JavaValue {
    const obj = receiver.value;
    if (receiver.type === 'Gates' && name === 'super') return nil();
    if (obj === this.gameLogic && name === 'careerComplete') return jv('CareerResult', { f: 0 });
    if (receiver.value === 'Config' && name === 'HD_quality') return jv('int', 1);
    if (receiver.value === 'GfxEngine' && name === 'openVideo') return jv('int', 0);
    if (receiver.value === 'GfxEngine' && name === 'closeVideo') return nil();
    if (receiver.value === 'System' && name === 'buildNumber') return jv('int', 940);
    if (receiver.value === 'Sound' && name === 'changeMusicSet') return nil();
    if (receiver.type === 'ResourceRef' && ['cache', 'precache'].includes(name)) return nil();
    if (receiver.type === 'LoadingScreen' && ['show', 'userWait'].includes(name)) return nil();
    if (receiver.type === 'MenuText' && name === 'changeColor' && args.length === 1) return nil();
    if (receiver.type === 'MenuVisual' && ['setPos', 'setMatrix'].includes(name)) return nil();
    if (receiver.type === 'Thread' && ['setPriority', 'start', 'addMethod', 'stop'].includes(name)) return nil();
    if (receiver.type === 'Menu' && name === 'addItem') return jv('Gadget', { name: 'gadget' });
    if (receiver.type === 'Gadget' && name === 'rect') return jv('MenuVisual', { name: 'gadget.rect' });
    if (receiver.type === 'MenuText' && name === 'changeText' && args.length === 1) { this.messageText = String(args[0].value ?? ''); return nil(); }
    if (receiver.type === 'MenuText' && name === 'setColor' && args.length === 1) { this.messageColor = integer(args[0]); return nil(); }
    if (receiver.type === 'Thread' && name === 'methodStatus') return jv('int', 0);
    if (receiver.type === 'Thread' && name === 'sleep') return nil();
    if (receiver.type === 'ColorBank' && name === 'getColor' && this.colorBankClass) {
      const method = this.colorBankClass.methods.find(method => method.name === 'getColor');
      if (method) return this.machine.invoke(method, receiver, args);
    }
    if (receiver.type === 'Cursor' && name === 'enable') return nil();
    if (obj === this.osd && name === 'showGroup' && args.length === 1) return nil();
    if (obj === this.osd && name === 'hideGroup' && args.length === 1) return nil();
    if (obj === this.osd && name === 'endGroup') return jv('int', 0);
    if (obj === this.osd && name === 'createMenu') return jv('Menu', { name: 'menu' });
    if (obj === this.osd && name === 'createText') {
      if (!this.versionText && args[0]?.type === 'String' && args[0].value) this.versionText = String(args[0].value);
      return jv('MenuText', { name: 'text' });
    }
    if (obj === this.osd && name === 'createRectangle') return jv('MenuVisual', { name: 'rectangle' });
    if (obj === this.osd && name === 'createHotkey') return nil();
    if (receiver.type === 'Gates' && name === 'show' && fromClass === 'Dialog') return nil();
    if (receiver.type === 'Gates' && name === 'hide' && fromClass === 'Dialog') return nil();
    if (receiver.type === 'Gates' && name === 'show' && args.length === 0 && this.gatesClass.methods.some(method => method.name === 'show')) return this.run(this.gatesClass, 'show', receiver, args);
    if (receiver.type === 'Gates' && name === 'hide' && args.length === 0 && this.gatesClass.methods.some(method => method.name === 'hide')) return this.run(this.gatesClass, 'hide', receiver, args);
    if (receiver.type === 'Gates' && name === 'buildSlidingMenu' && args.length === 0) return this.run(this.gatesClass, 'buildSlidingMenu', receiver, args);
    if (receiver.type === 'Gates' && name === 'showPrimaryVisuals' && args.length === 0) return this.run(this.gatesClass, 'showPrimaryVisuals', receiver, args);
    if (receiver.type === 'MenuVisual' && obj && typeof obj === 'object') {
      if (name === 'runAnimation' && args.length === 4) {
        this.motion.push({ target: (obj as { name: string }).name, operation: 'runAnimation', speed: Number(args[0].value),
          steps: integer(args[1]), direction: integer(args[2]), axis: String(args[3].value) });
        return nil();
      }
      if (name === 'reverseAnimation' && args.length === 1) {
        this.motion.push({ target: (obj as { name: string }).name, operation: 'reverseAnimation', speed: 0, steps: 0, direction: 0, axis: String(args[0].value) });
        return nil();
      }
    }
    if (obj && typeof obj === 'object' && 'myPrevState' in obj) {
      if (name === 'show' && args.length === 0) {
        this.run(this.gatesClass, this.gatesClass.methods.some(method => method.name === 'show') ? 'show' : 'buildSlidingMenu', receiver, []);
        return nil();
      }
      if (name === 'hide' && args.length === 0) return nil();
    }
    if (obj === this.osd && name === 'createSlidingMenu' && args.length === 7) return jv('SlidingMenu', {
      items: [], selected: 0, active: 0, speed: 0, spacing: Number(args[2].value), y: Number(args[1].value),
    } satisfies Slider);
    if (obj && typeof obj === 'object' && 'items' in obj) {
      const slider = obj as Slider;
      if (name === 'teleport' && (args.length === 0 || args.length === 4)) {
        this.motion.push({ target: 'slider', operation: 'teleport', speed: args.length ? Number(args[0].value) : 0,
          steps: args.length ? integer(args[1]) : 0, direction: args.length ? integer(args[2]) : 0,
          axis: args.length ? String(args[3].value) : 'X' });
        return nil();
      }
      if (name === 'addItem' && args.length === 7) {
        const active = args[3].value as { pack: string; id: number }, disabled = args[4].value as { pack: string; id: number };
        if (!active?.pack || !disabled?.pack) throw new Error('Menu item requires image resources');
        slider.items.push({ active: { ...active }, disabled: { ...disabled }, command: integer(args[5]), label: String(args[6].value),
          width: Number(args[0].value), height: Number(args[1].value), depth: integer(args[2]) });
        return nil();
      }
      if (name === 'activate' && args.length === 1) { slider.selected = integer(args[0]); return nil(); }
      if (name === 'setSpeed' && args.length === 1) { slider.speed = Number(args[0].value); return nil(); }
      if (name === 'deactivate' && args.length === 0) { slider.active = 0; return nil(); }
      if (name === 'getItem' && args.length === 0) return jv('MenuItem', { items: slider.items });
      if (name === 'getLabel' && args.length === 0) return jv('String', slider.items[slider.selected]?.label ?? '');
      if (name === 'execute' && args.length === 1) {
        if (!slider.items.length) throw new Error('Empty sliding menu');
        switch (integer(args[0])) {
          case 1: slider.selected = Math.max(0, slider.selected - 1); break;
          case 2: slider.selected = Math.min(slider.items.length - 1, slider.selected + 1); break;
          case 3: this.pendingCommand = slider.items[slider.selected].command; break;
          default: throw new Error(`Unknown SlidingMenu command ${args[0].value}`);
        }
        return nil();
      }
    }
    throw new Error(`Missing menu native ${receiver.type}.${name}`);
  }

}
