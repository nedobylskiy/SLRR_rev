import { jv, type JavaObject, type JavaValue, type SlrrJvm } from 'slrr-jvm';
import type { ControllerNative } from './controller-native';
import { EVENT_HOTKEY, type GameTypeNative } from './game-type-native';

interface HotkeyRegistration {
  hotkey: JavaValue;
  axis: number;
  flags: number;
  handler: JavaValue;
  owner: JavaValue;
  eventFilter: number;
  armed: boolean;
  down: boolean;
}

const codes: Record<string, number> = {
  Escape: 1, Enter: 28, NumpadEnter: 156, Space: 57, ArrowUp: 200,
  ArrowDown: 208, ArrowLeft: 203, ArrowRight: 205, Comma: 51, Period: 52,
  NumpadAdd: 78, NumpadSubtract: 74, PageUp: 201, PageDown: 209,
};
for (const [letters, start] of [['QWERTYUIOP', 16], ['ASDFGHJKL', 30], ['ZXCVBNM', 44]] as const)
  [...letters].forEach((letter, index) => { codes[`Key${letter}`] = start + index; });
for (let n = 1; n <= 10; n++) codes[`F${n}`] = 58 + n;
codes.F11 = 87; codes.F12 = 88;

/** Physical input samples and hotkey registrations; Java handlers receive the events. */
export class InputNative {
  private readonly axes = new Map<string, number>();
  private readonly pressedKeys: number[] = [];
  private readonly hotkeys: HotkeyRegistration[] = [];

  constructor(private readonly jvm: SlrrJvm, private readonly controllers: ControllerNative,
    private readonly events: GameTypeNative) {
    const owner = 'java.io.Input';
    const voidValue = () => jv('void', undefined);
    jvm.natives.register(owner, 'getAxis', ['int', 'int'], ({ args }) =>
      jv('float', this.physicalAxis(Number(args[0].value), Number(args[1].value))));
    jvm.natives.register(owner, 'lastKey', [], () => jv('int', this.pressedKeys.shift() ?? 0));
    jvm.natives.register(owner, 'createHotkey', ['int', 'int', 'Hotkey', 'GameRef', 'Osd', 'int'], ({ args }) => {
      const [axis, flags, hotkey, handler, osd, eventFilter] = args;
      this.createHotkey(Number(axis.value), Number(flags.value), hotkey, handler, osd, Number(eventFilter.value));
      return voidValue();
    });
    jvm.natives.register(owner, 'deleteHotkey', ['Hotkey'], ({ args }) => {
      const index = this.hotkeys.findIndex(item => item.hotkey.value === args[0].value);
      if (index >= 0) this.hotkeys.splice(index, 1);
      return voidValue();
    });
    jvm.natives.register(owner, 'flushHotkeys', [], () => {
      for (const item of this.hotkeys) item.armed = false;
      return voidValue();
    });
    jvm.natives.register(owner, 'checkHotkeys', ['GameRef', 'Osd'], ({ args }) => {
      this.checkHotkeys(args[0], args[1], true);
      return voidValue();
    });
  }

  physicalAxis(device: number, axis: number): number { return this.axes.get(`${device}:${axis}`) ?? 0; }

  setPhysicalAxis(device: number, axis: number, value: number): void {
    if (!Number.isFinite(value)) throw new Error('Input axis value must be finite');
    const key = `${device}:${axis}`;
    const previous = this.axes.get(key) ?? 0;
    this.axes.set(key, value);
    if (device === 0 && value > 0.2 && previous <= 0.2) this.pressedKeys.push(axis);
  }

  setKeyboardCode(code: string, pressed: boolean): void {
    const axis = codes[code];
    if (axis !== undefined) this.setPhysicalAxis(0, axis, pressed ? 1 : 0);
  }

  attachBrowserKeyboard(target: Window): () => void {
    const down = (event: KeyboardEvent) => this.setKeyboardCode(event.code, true);
    const up = (event: KeyboardEvent) => this.setKeyboardCode(event.code, false);
    const blur = () => { for (const key of this.axes.keys()) if (key.startsWith('0:')) this.axes.set(key, 0); };
    target.addEventListener('keydown', down);
    target.addEventListener('keyup', up);
    target.addEventListener('blur', blur);
    return () => { target.removeEventListener('keydown', down); target.removeEventListener('keyup', up);
      target.removeEventListener('blur', blur); };
  }

  /** Host frame-loop replacement for HotkeyWatcher until Java Thread is supported. */
  poll(): void {
    this.pollEvents(false);
  }

  pollCooperative(): void {
    this.pollEvents(true);
  }

  private pollEvents(cooperative: boolean): void {
    let controller = jv('Controller', null), focus = jv('Osd', null);
    const cursor = this.jvm.get(jv('class', 'java.io.Input'), 'cursor');
    if (cursor.value != null) controller = this.jvm.get(cursor, 'controller');
    const queue = this.jvm.get(jv('class', 'java.render.Frontend'), 'inputQueue');
    if (queue.value != null) focus = this.jvm.invoke(queue, 'lastElement');
    this.checkHotkeys(controller, focus, cooperative);
  }

  checkHotkeys(controller: JavaValue, focus: JavaValue, cooperative = false): void {
    let fired = false;
    for (const item of this.hotkeys) {
      if (item.owner.value != null && item.owner.value !== focus.value) continue;
      const value = item.flags & 1 ? controller.value == null ? 0 : this.controllers.read(controller, item.axis)
        : item.flags & 2 ? this.physicalAxis(0, item.axis) : 0;
      const down = value > 0.2;
      this.jvm.set(item.hotkey, 'state', jv('int', Number(down)));
      if (item.armed && down !== item.down && !fired
        && item.eventFilter & (down ? 1 : 2) && item.handler.value != null) {
        this.events.queueHotkey(item.handler, item.hotkey);
        fired = true;
      }
      item.armed = true;
      item.down = down;
    }
    if (cooperative) this.events.dispatchQueuedEventsCooperative();
    else this.events.dispatchQueuedEvents();
  }

  registeredHotkeys(): number { return this.hotkeys.length; }

  private createHotkey(axis: number, flags: number, hotkey: JavaValue, handler: JavaValue,
    owner: JavaValue, eventFilter: number): void {
    if (hotkey.value == null || this.hotkeys.length >= 512) return;
    const object = hotkey.value as JavaObject;
    if (!(object.fields instanceof Map)) throw new Error('Hotkey is not a Java object');
    const existing = this.hotkeys.find(item => item.hotkey.value === hotkey.value);
    if (existing) Object.assign(existing, { axis, flags, handler, owner, eventFilter, armed: false, down: false });
    else this.hotkeys.push({ hotkey, axis, flags, handler, owner, eventFilter, armed: false, down: false });
  }
}
