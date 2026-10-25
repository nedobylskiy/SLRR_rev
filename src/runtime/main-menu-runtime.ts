import { JavaSourceMachine, jv, nil, parseSourceClass, type JavaHost, type JavaValue, type SourceClass } from './java-source';

export interface MainMenuItem { label: string; active: number; disabled: number; command: number }
export interface MainMenuState { gameMode: number; played: boolean; debugMode: boolean; hasCar: boolean }
export const INITIAL_MENU_STATE: MainMenuState = { gameMode: 0, played: false, debugMode: false, hasCar: false };

interface Slider { items: MainMenuItem[]; selected: number; active: number; speed: number }
interface Gates { myPrevState: JavaValue; slider: Slider | null }
interface MainMenu { window: Gates | null }

function integer(value: JavaValue) {
  if (!Number.isInteger(value.value)) throw new Error(`Expected Java integer, got ${value.type}`);
  return value.value as number;
}

/** Executes the installed Java entry/exit and menu-building methods against narrow OSD host objects. */
export class MainMenuRuntime implements JavaHost {
  readonly mainClass: SourceClass;
  readonly gatesClass: SourceClass;
  readonly trace: string[] = [];
  private readonly machine = new JavaSourceMachine(this, 50_000);
  private readonly menu: MainMenu = { window: null };
  private readonly osd = { tag: 'Osd' };
  private readonly gameLogic = { tag: 'GameLogic' };
  private readonly player: { car: object | null };

  constructor(source: string, readonly state: MainMenuState = INITIAL_MENU_STATE) {
    this.mainClass = parseSourceClass(source, new Set(['enter', 'exit']), 'MainMenu');
    this.gatesClass = parseSourceClass(source, new Set(['buildSlidingMenu']), 'Gates');
    this.player = { car: state.hasCar ? {} : null };
    for (const name of ['enter', 'exit']) if (!this.mainClass.methods.some(method => method.name === name)) throw new Error(`MainMenu.${name} missing`);
    if (!this.gatesClass.methods.some(method => method.name === 'buildSlidingMenu')) throw new Error('Gates.buildSlidingMenu missing');
  }

  enter(previous: JavaValue = nil()) {
    if (this.menu.window) throw new Error('MainMenu already entered');
    this.run(this.mainClass, 'enter', jv('MainMenu', this.menu), [previous]);
    const slider = (this.menu as MainMenu).window?.slider;
    if (!slider?.items.length || slider.selected < 0 || slider.selected >= slider.items.length) throw new Error('MainMenu built no valid sliding menu');
    return { items: slider.items.map(item => ({ ...item })), selected: slider.selected };
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
    if (name === 'osd') return jv('Osd', this.osd);
    if (name === 'player') return jv('Player', this.player);
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
    }
    if (receiver.value === 'SlidingMenu' && name === 'STYLE_HORIZONTAL') return jv('int', 0);
    const obj = receiver.value;
    if (obj && typeof obj === 'object') {
      if ('slider' in obj && name === 'slider') return jv('SlidingMenu', (obj as Gates).slider);
      if ('myPrevState' in obj && name === 'myPrevState') return (obj as Gates).myPrevState;
      if ('car' in obj && name === 'car') return jv('Vehicle', (obj as typeof this.player).car);
      if ('items' in obj && name === 'active') return jv('int', (obj as Slider).active);
    }
    throw new Error(`Missing menu field ${receiver.type}.${name}`);
  }
  set(receiver: JavaValue, name: string, value: JavaValue): void {
    if (receiver.value === this.menu && name === 'window') { this.menu.window = value.value as Gates | null; return; }
    const obj = receiver.value;
    if (obj && typeof obj === 'object') {
      if ('myPrevState' in obj && name === 'myPrevState') { (obj as Gates).myPrevState = value; return; }
      if ('slider' in obj && name === 'slider') { (obj as Gates).slider = value.value as Slider; return; }
      if ('items' in obj && name === 'active') { (obj as Slider).active = integer(value); return; }
    }
    throw new Error(`Cannot set menu field ${receiver.type}.${name}`);
  }
  construct(name: string, args: JavaValue[]): JavaValue {
    if (name === 'Gates' && args.length === 0) return jv('Gates', { myPrevState: nil(), slider: null } satisfies Gates);
    throw new Error(`Unsupported menu constructor ${name}`);
  }
  call(receiver: JavaValue, name: string, args: JavaValue[]): JavaValue {
    const obj = receiver.value;
    if (obj && typeof obj === 'object' && 'myPrevState' in obj) {
      if (name === 'show' && args.length === 0) { this.run(this.gatesClass, 'buildSlidingMenu', receiver, []); return nil(); }
      if (name === 'hide' && args.length === 0) return nil();
    }
    if (obj === this.osd && name === 'createSlidingMenu' && args.length === 7) return jv('SlidingMenu', { items: [], selected: 0, active: 0, speed: 0 } satisfies Slider);
    if (obj && typeof obj === 'object' && 'items' in obj) {
      const slider = obj as Slider;
      if (name === 'addItem' && args.length === 7) {
        const active = args[3].value as { pack: string; id: number }, disabled = args[4].value as { pack: string; id: number };
        if (active?.pack?.toLowerCase() !== 'frontend' || disabled?.pack?.toLowerCase() !== 'frontend') throw new Error('Unsupported menu resource namespace');
        slider.items.push({ active: active.id, disabled: disabled.id, command: integer(args[5]), label: String(args[6].value) });
        return nil();
      }
      if (name === 'activate' && args.length === 1) { slider.selected = integer(args[0]); return nil(); }
      if (name === 'setSpeed' && args.length === 1) { slider.speed = Number(args[0].value); return nil(); }
    }
    throw new Error(`Missing menu native ${receiver.type}.${name}`);
  }

}
