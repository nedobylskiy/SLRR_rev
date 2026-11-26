/** Where on-screen buttons send keys: InputNative, as if typed on a keyboard. */
export interface TouchKeySink {
  setKeyboardCode(code: string, pressed: boolean, character?: number, repeat?: boolean): void;
}

/** Track hotkeys (Track.java): F4 chase, F1 internal, F3 external, F2 TV. */
export const CAMERA_VIEWS = [
  { code: 'F4', label: 'Chase' }, { code: 'F1', label: 'Internal' },
  { code: 'F3', label: 'External' }, { code: 'F2', label: 'TV' },
] as const;
/** ControlSet.defaults: A shifts up, Z shifts down (to neutral, then reverse). */
export const VOLUME_GEAR_KEYS: Readonly<Record<string, string>> = { VolumeUp: 'KeyA', VolumeDown: 'KeyZ' };
/** A tap stays pressed long enough for Java's hotkey poll to see it, even at a low frame rate. */
export const TAP_MS = 250;

const OPACITY_KEY = 'slrr-touch-opacity';
const VOLUME_KEY = 'slrr-touch-volume-gears';

export function clampOpacity(value: number): number {
  return Number.isFinite(value) ? Math.max(.2, Math.min(1, value)) : .8;
}

/** The text the hidden IME field holds between edits. Losing it means Backspace. */
const SENTINEL = ' ';

/** Turn one edit of the hidden field (value after the edit) into game key presses. */
export function imeEdit(value: string): { backspace: boolean; characters: number[] } {
  if (value.length < SENTINEL.length) return { backspace: true, characters: [] };
  const typed = value.startsWith(SENTINEL) ? value.slice(SENTINEL.length) : value;
  return { backspace: false, characters: [...typed].map(ch => ch.codePointAt(0)!).filter(code => code >= 32 && code < 256) };
}

declare global {
  interface Window {
    /** Called by the Android activity for hardware keys it routes to the page. */
    slrrHardwareKey?: (name: string, down: boolean) => void;
    /** Android bridge (MainActivity): whether volume keys go to the game. */
    SlrrAndroid?: { setVolumeGears(enabled: boolean): void };
  }
}

const ICONS: Record<string, string> = {
  keyboard: '<path d="M3 7h18v10H3z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 10h2M10 10h2M14 10h2M18 10h0M7 14h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  camera: '<path d="M3 8h4l2-2h6l2 2h4v11H3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  settings: '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};
const icon = (name: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

/** Mobile button bar over the game frame (touch builds): on-screen keyboard
 * for Java text fields, game menu (Esc), camera, and a mobile-only settings
 * panel for control opacity, camera views and volume-key gear shifting. */
export class TouchToolbar {
  readonly root = document.createElement('div');
  private readonly field = document.createElement('input');
  private readonly panel = document.createElement('div');
  private driving = false;
  private cameraIndex = 0;
  private volumeGears = true;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(container: HTMLElement, private readonly sink: TouchKeySink, private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage) {
    this.root.className = 'touch-toolbar';
    this.root.innerHTML = `<button type="button" data-action="keyboard" aria-label="Keyboard">${icon('keyboard')}</button>
      <button type="button" data-action="camera" class="touch-driving-only" aria-label="Change camera">${icon('camera')}</button>
      <button type="button" data-action="menu" aria-label="Game menu">${icon('menu')}</button>
      <button type="button" data-action="settings" aria-label="Mobile settings">${icon('settings')}</button>`;
    this.field.className = 'touch-ime';
    Object.assign(this.field, { type: 'text', autocomplete: 'off', spellcheck: false, value: SENTINEL });
    for (const [name, value] of [['autocapitalize', 'off'], ['autocorrect', 'off'], ['enterkeyhint', 'done'], ['aria-label', 'Text for the game']])
      this.field.setAttribute(name, value);
    this.panel.className = 'touch-settings';
    this.panel.hidden = true;
    this.panel.innerHTML = `<div class="touch-settings-box" role="dialog" aria-label="Mobile settings">
      <strong>Mobile controls</strong>
      <label>Controls opacity <output></output><input type="range" min="20" max="100" step="5" data-setting="opacity"></label>
      <div class="touch-settings-row"><span>Camera</span>${CAMERA_VIEWS.map((view, i) => `<button type="button" data-camera="${i}">${view.label}</button>`).join('')}</div>
      <label class="touch-settings-check"><input type="checkbox" data-setting="volume"> Volume buttons shift gears while driving (down to reverse)</label>
      <button type="button" data-action="close">Close</button></div>`;
    this.root.append(this.field);
    container.append(this.root, this.panel);

    this.setOpacity(Number(this.storage?.getItem(OPACITY_KEY) ?? .8));
    this.volumeGears = this.storage?.getItem(VOLUME_KEY) !== '0';
    (this.panel.querySelector('[data-setting="volume"]') as HTMLInputElement).checked = this.volumeGears;

    this.root.addEventListener('click', this.onToolbar);
    this.panel.addEventListener('click', this.onPanel);
    this.panel.addEventListener('input', this.onSetting);
    this.field.addEventListener('input', this.onImeInput);
    this.field.addEventListener('keydown', this.onImeKey);
    window.slrrHardwareKey = this.hardwareKey;
    this.syncVolumeBridge();
  }

  /** Driving shows the camera button and enables volume-key gear shifting. */
  setDriving(driving: boolean): void {
    this.driving = driving;
    this.root.classList.toggle('driving', driving);
    this.syncVolumeBridge();
  }

  /** Press and release a key, e.g. Escape for the game menu. */
  tap(code: string, character = 0): void {
    this.sink.setKeyboardCode(code, true, character);
    const timer = setTimeout(() => { this.timers.delete(timer); this.sink.setKeyboardCode(code, false); }, TAP_MS);
    this.timers.add(timer);
  }

  nextCamera(): void {
    this.cameraIndex = (this.cameraIndex + 1) % CAMERA_VIEWS.length;
    this.tap(CAMERA_VIEWS[this.cameraIndex].code);
  }

  setOpacity(value: number): void {
    const opacity = clampOpacity(value);
    document.documentElement.style.setProperty('--touch-opacity', String(opacity));
    const slider = this.panel.querySelector('[data-setting="opacity"]') as HTMLInputElement, output = this.panel.querySelector('output')!;
    slider.value = String(Math.round(opacity * 100)); output.textContent = `${Math.round(opacity * 100)}%`;
    this.storage?.setItem(OPACITY_KEY, String(opacity));
  }

  private readonly hardwareKey = (name: string, down: boolean) => {
    const code = VOLUME_GEAR_KEYS[name];
    if (code && this.driving && this.volumeGears) this.sink.setKeyboardCode(code, down);
  };

  private syncVolumeBridge(): void {
    try { window.SlrrAndroid?.setVolumeGears(this.driving && this.volumeGears); } catch { /* Not on Android. */ }
  }

  private readonly onToolbar = (event: MouseEvent) => {
    const action = (event.target as Element).closest('button')?.dataset.action;
    if (action === 'keyboard') this.toggleKeyboard();
    else if (action === 'camera') this.nextCamera();
    else if (action === 'menu') this.tap('Escape', 27);
    else if (action === 'settings') this.panel.hidden = !this.panel.hidden;
  };

  private readonly onPanel = (event: MouseEvent) => {
    const button = (event.target as Element).closest('button');
    if (event.target === this.panel || button?.dataset.action === 'close') { this.panel.hidden = true; return; }
    if (button?.dataset.camera !== undefined) {
      this.cameraIndex = Number(button.dataset.camera);
      this.tap(CAMERA_VIEWS[this.cameraIndex].code);
    }
  };

  private readonly onSetting = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (input.dataset.setting === 'opacity') this.setOpacity(Number(input.value) / 100);
    if (input.dataset.setting === 'volume') {
      this.volumeGears = input.checked;
      this.storage?.setItem(VOLUME_KEY, input.checked ? '1' : '0');
      this.syncVolumeBridge();
    }
  };

  /** Focusing a text field is what raises the system keyboard on a phone. */
  private toggleKeyboard(): void {
    if (document.activeElement === this.field) { this.field.blur(); return; }
    this.field.value = SENTINEL;
    this.field.focus({ preventScroll: true });
    this.field.setSelectionRange(SENTINEL.length, SENTINEL.length);
  }

  private readonly onImeInput = () => {
    const { backspace, characters } = imeEdit(this.field.value);
    if (backspace) this.tap('Backspace', 8);
    // Characters without a mapped key reach Java's lastKey as typed text.
    for (const character of characters) this.sink.setKeyboardCode('', true, character);
    this.field.value = SENTINEL;
    this.field.setSelectionRange(SENTINEL.length, SENTINEL.length);
  };

  private readonly onImeKey = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    this.tap('Enter', 13);
    this.field.blur();
  };

  dispose(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    if (window.slrrHardwareKey === this.hardwareKey) window.slrrHardwareKey = undefined;
    this.driving = false; this.syncVolumeBridge();
    this.root.remove(); this.panel.remove();
  }
}
