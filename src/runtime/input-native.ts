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
  Digit1: 2, Digit2: 3, Digit3: 4, Digit4: 5,
  Digit5: 6, Digit6: 7, Digit7: 8, Digit8: 9, Digit9: 10, Digit0: 11,
  Backspace: 14, Tab: 15, ShiftLeft: 42, ShiftRight: 54, ControlLeft: 29, ControlRight: 157,
};
for (const [letters, start] of [['QWERTYUIOP', 16], ['ASDFGHJKL', 30], ['ZXCVBNM', 44]] as const)
  [...letters].forEach((letter, index) => { codes[`Key${letter}`] = start + index; });
for (let n = 1; n <= 10; n++) codes[`F${n}`] = 58 + n;
codes.F11 = 87; codes.F12 = 88;
const cameraShortcuts: Record<string, { cameraAxis: number; command: number }> = {
  Digit1: { cameraAxis: codes.F1, command: 7 },
  Digit2: { cameraAxis: codes.F2, command: 0 },
  Digit3: { cameraAxis: codes.F3, command: 8 },
  Digit4: { cameraAxis: codes.F4, command: 31 },
};

/** Physical input samples and hotkey registrations; Java handlers receive the events. */
export class InputNative {
  private readonly axes = new Map<string, number>();
  private readonly pressedKeys: number[] = [];
  private readonly cheatRing = new Uint8Array(16);
  private cheatWrite = 0;
  private readonly hotkeys: HotkeyRegistration[] = [];
  private readonly pressedCodes = new Set<string>();
  private readonly cameraAliases = new Map<string, number>();
  private currentController = jv('Controller', null);
  private currentFocus = jv('Osd', null);

  constructor(private readonly jvm: SlrrJvm, private readonly controllers: ControllerNative,
    private readonly events: GameTypeNative) {
    const owner = 'java.io.Input';
    const voidValue = () => jv('void', undefined);
    jvm.natives.register(owner, 'getAxis', ['int', 'int'], ({ args }) =>
      jv('float', this.physicalAxis(Number(args[0].value), Number(args[1].value))));
    jvm.natives.register(owner, 'lastKey', [], () => {
      const key = this.pressedKeys.shift() ?? 0;
      const character = (key >>> 16) & 0xff;
      if (character) {
        this.cheatRing[this.cheatWrite] = character;
        this.cheatWrite = (this.cheatWrite + 1) % this.cheatRing.length;
      }
      return jv('int', key);
    });
    // Original native 0x0047CB50: ASCII+1 strings, reverse search, 16-byte
    // history populated by lastKey (including Input.flushKeys).
    jvm.natives.register('java.game.GameLogic', 'kismajomCheck', ['String[]'], ({ args }) => {
      const codes = args[0].value;
      if (!Array.isArray(codes)) return jv('int', -1);
      for (let i = codes.length - 1; i >= 0; i--) {
        const encoded = (codes[i] as JavaValue)?.value;
        if (typeof encoded !== 'string') continue;
        let matches = true;
        for (let n = 0; n < encoded.length; n++) {
          const index = (this.cheatWrite - 1 - n % 16 + 16) % 16;
          if (((encoded.charCodeAt(encoded.length - 1 - n) - 1) & 255) !== this.cheatRing[index]) {
            matches = false; break;
          }
        }
        if (matches) {
          this.cheatRing[(this.cheatWrite + 15) % 16] = 0;
          return jv('int', i);
        }
      }
      return jv('int', -1);
    });
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

  setPhysicalAxis(device: number, axis: number, value: number, character = 0): void {
    if (!Number.isFinite(value)) throw new Error('Input axis value must be finite');
    const key = `${device}:${axis}`;
    const previous = this.axes.get(key) ?? 0;
    this.axes.set(key, value);
    // Native lastKey ABI: low word = physical scan, high word = typed character.
    if (device === 0 && value > 0.2 && previous <= 0.2) this.pressedKeys.push((character << 16) | axis);
  }

  setKeyboardCode(code: string, pressed: boolean, character = 0, repeat = false): void {
    const axis = codes[code];
    if (axis === undefined) { if (pressed && character) this.pressedKeys.push(character << 16); return; }
    const wasPressed = this.pressedCodes.has(code);
    if (pressed) this.pressedCodes.add(code); else this.pressedCodes.delete(code);
    const shortcut = cameraShortcuts[code];
    if (shortcut) {
      if (pressed && !wasPressed && this.cameraShortcutAvailable(axis, shortcut.cameraAxis, shortcut.command))
        this.cameraAliases.set(code, shortcut.cameraAxis);
      if (!pressed) this.cameraAliases.delete(code);
    }
    this.setPhysicalAxis(0, axis, pressed ? 1 : 0, character);
    if (pressed && wasPressed && repeat && character) this.pressedKeys.push((character << 16) | axis);
    if (shortcut) this.updateCameraAliasAxis(shortcut.cameraAxis);
    else if (axis >= codes.F1 && axis <= codes.F4) this.updateCameraAliasAxis(axis);
  }

  private cameraShortcutAvailable(digitAxis: number, cameraAxis: number, command: number): boolean {
    const active = (item: HotkeyRegistration) => item.owner.value == null || item.owner.value === this.currentFocus.value;
    const camera = this.hotkeys.some(item => active(item) && (item.flags & 2) && item.axis === cameraAxis
      && Number((item.hotkey.value as JavaObject | null)?.fields?.get('command')?.value) === command);
    if (!camera || this.hotkeys.some(item => active(item) && (item.flags & 2) && item.axis === digitAxis)) return false;
    return this.currentController.value == null || !this.controllers.bindings(this.currentController)
      .some(binding => binding.device === 0 && binding.physicalAxis === digitAxis);
  }

  private updateCameraAliasAxis(axis: number): void {
    const direct = Object.entries(codes).some(([code, value]) => value === axis && this.pressedCodes.has(code));
    const aliased = [...this.cameraAliases.values()].includes(axis);
    this.axes.set(`0:${axis}`, direct || aliased ? 1 : 0);
  }

  attachBrowserKeyboard(target: Window): () => void {
    const down = (event: KeyboardEvent) => {
      const element = document.activeElement as HTMLElement | null;
      if (element?.matches('input, textarea, select, [contenteditable="true"]') || event.isComposing) return;
      const character = event.ctrlKey || event.metaKey || event.altKey ? 0
        : event.key.length === 1 ? event.key.charCodeAt(0)
        : event.key === 'Backspace' ? 8 : event.key === 'Enter' ? 13 : event.key === 'Escape' ? 27 : 0;
      const focus = this.currentFocus.value as JavaObject | null;
      if (character && focus?.fields?.get('actGadget')?.value != null) event.preventDefault();
      if (document.activeElement?.tagName === 'CANVAS'
        && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
      this.setKeyboardCode(event.code, true, character, event.repeat);
    };
    const up = (event: KeyboardEvent) => this.setKeyboardCode(event.code, false);
    const blur = () => { this.pressedCodes.clear(); this.cameraAliases.clear();
      for (const key of this.axes.keys()) if (key.startsWith('0:')) this.axes.set(key, 0); };
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
    this.currentController = controller; this.currentFocus = focus;
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
