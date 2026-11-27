import {parseScxAsync} from '../formats/scx-worker-client';
import type { JavaValue } from 'slrr-jvm';
import type { Assets } from '../assets';
import type { BootResult } from '../runtime/game-boot';
import { type ScxMesh } from '../formats/scx';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import { normalizePath } from '../assets';
import { readExeCursor, stockCursorIndex } from '../formats/exe-cursor';
import { TwoFingerCamera } from './touch-camera';
import { showDropMenu, type DropMenu } from './drop-menu';

/** Pinch ratio that counts as one mouse-wheel notch. */
export const PINCH_NOTCH = Math.log(1.12);
/** A touch press held this long on an inventory part opens its drop-action menu. */
export const LONG_PRESS_MS = 500;

/** Font glyph UVs select the original pointer artwork, including modded fonts. */
export function pointerUv(mesh: ScxMesh, character: string) {
  const start = character.charCodeAt(0) * 8;
  const uv = Array.from(mesh.uv.slice(start, start + 8));
  if (uv.length !== 8) throw new Error(`Cursor glyph missing: ${character}`);
  const u = uv.filter((_, i) => i % 2 === 0), v = uv.filter((_, i) => i % 2 === 1);
  return { x: Math.min(...u), y: Math.min(...v), width: Math.max(...u) - Math.min(...u), height: Math.max(...v) - Math.min(...v) };
}

/** Browser transport for MouseCursor; Java still selects modes and camera bindings. */
export class JavaMouse {
  private hovered?: { id: number; local: number[]; world: number[] };
  private pressed?: { hit?: { id: number; local: number[]; world: number[] }; physics?: JavaValue; pointer: number; x: number; y: number; dragged: boolean };
  private suppressClick = false;
  private pointer?: number;
  private rightOrigin?: { x: number; y: number; hit?: { id: number; local: number[]; world: number[] } };
  private x = 0;
  private y = 0;
  private dragged = false;
  private disposed = false;
  private key = '';
  private styles = new Map<string, Promise<string>>();
  private exe?: Promise<Uint8Array>;
  private timer: ReturnType<typeof setInterval>;
  /** Touch screens: two fingers act as a right-button drag (orbit) and a pinch as the wheel (zoom). */
  private readonly fingers = new TwoFingerCamera();
  private touchDrag = false;
  private touchDragged = false;
  private pinch = 0;
  /** Touch long press on an inventory gadget: offer its drop targets instead of a drag. */
  private holdTimer?: ReturnType<typeof setTimeout>;
  private closeMenu?: () => void;
  showMenu: DropMenu = showDropMenu;
  constructor(private readonly viewport: HTMLElement, private readonly result: BootResult,
    private readonly assets: Assets, private readonly report: (message: string) => void,
    private readonly pick?: (x: number, y: number) => { id: number; local: number[]; world: number[] } | undefined) {
    viewport.addEventListener('pointerdown', this.down);
    viewport.addEventListener('click', this.click, true);
    viewport.addEventListener('pointermove', this.move);
    viewport.addEventListener('pointerup', this.up);
    viewport.addEventListener('pointercancel', this.cancelPointer);
    viewport.addEventListener('lostpointercapture', this.cancel);
    viewport.addEventListener('wheel', this.wheel, { passive: false });
    viewport.addEventListener('contextmenu', this.context);
    window.addEventListener('blur', this.blur);
    window.addEventListener('pointerup',this.up);
    this.timer = setInterval(() => this.update(), 50);
    this.update();
  }
  private cursor() { return this.result.input.mouseCursor(); }
  private controlled() {
    const cursor = this.cursor();
    return !!cursor?.value && !!this.result.jvm.get(cursor, 'controlledcam').value;
  }
  private trackPosition(event:MouseEvent){
    const rect=this.viewport.getBoundingClientRect?.();if(!rect?.width||!rect.height)return;
    this.result.input.setCursorPosition?.((event.clientX-rect.left)/rect.width*2-1,(event.clientY-rect.top)/rect.height*2-1);
  }
  private pickWhilePressed(event:MouseEvent){
    // Pointer capture retargets events to the viewport instead of the canvas.
    // Ray picking still uses client coordinates; OSD controls block world paint.
    if(this.result.osdButtons?.physicsAt(event.clientX,event.clientY))return;
    return this.pick?.(event.clientX,event.clientY);
  }
  private down = (event: PointerEvent) => {
    this.trackPosition(event);
    if (event.pointerType === 'touch' && event.target instanceof HTMLCanvasElement) {
      this.fingers.down(event.pointerId, event.clientX, event.clientY);
      if (this.fingers.active) {
        event.preventDefault();
        if (!this.touchDrag && this.controlled()) this.beginTouchDrag();
        return;
      }
    }
    if (event.button === 0 && this.controlled()) {
      this.suppressClick = false;
      const physics = this.result.osdButtons?.physicsAt(event.clientX, event.clientY);
      const hit = !physics && event.target instanceof HTMLCanvasElement ? this.pick?.(event.clientX, event.clientY) : undefined;
      if (hit || physics) {
        this.pressed = { hit, physics, pointer: event.pointerId, x: event.clientX, y: event.clientY, dragged: false };
        // Capturing OSD buttons on press would swallow their normal browser click.
        // Capture only once movement actually becomes a drag.
        if (hit) this.result.input.cursorEvent(1, hit);
        if (physics && event.pointerType === 'touch') this.startHold(this.pressed);
      }
      return;
    }
    if (event.button !== 2 || !this.controlled() || !(event.target instanceof HTMLCanvasElement)) return;
    event.preventDefault();
    this.pointer = event.pointerId; this.x = event.clientX; this.y = event.clientY;
    this.rightOrigin = { x: event.clientX, y: event.clientY, hit: this.pick?.(event.clientX, event.clientY) };
    this.viewport.setPointerCapture(event.pointerId);
    this.result.input.setPhysicalAxis(1, 4, 1);
    this.result.input.cursorEvent(3, this.rightOrigin.hit);
  };
  private move = (event: PointerEvent) => {
    if (event.pointerType === 'touch') {
      const gesture = this.fingers.move(event.pointerId, event.clientX, event.clientY);
      if (this.touchDrag) {
        event.preventDefault();
        if (gesture) this.touchGesture(gesture.dx, gesture.dy, gesture.zoom);
        return;
      }
    }
    this.trackPosition(event);
    const pressed = this.pressed;
    if (pressed && pressed.pointer === event.pointerId) {
      if (!pressed.dragged && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) >= 5) {
        pressed.dragged = true; this.suppressClick = true; this.stopHold();
        this.viewport.setPointerCapture(event.pointerId);
        if (pressed.hit) this.result.input.cursorEvent(9, pressed.hit);
      }
      if (pressed.dragged) {
        this.result.input.setPickedTarget?.(this.pickWhilePressed(event));
        event.preventDefault(); return;
      }
    }
    if (event.pointerId !== this.pointer) {
      const hit = this.controlled() && event.target instanceof HTMLCanvasElement ? this.pick?.(event.clientX, event.clientY) : undefined;
      if (hit?.id !== this.hovered?.id) {
        if (this.hovered) this.result.input.cursorEvent(16, this.hovered);
        if (hit) this.result.input.cursorEvent(15, hit);
      }
      this.result.input.setPickedTarget?.(hit);
      this.hovered = hit;
      return;
    }
    const dx = event.clientX - this.x, dy = event.clientY - this.y;
    if (!dx && !dy) return;
    if (!this.dragged && Math.hypot(event.clientX - this.rightOrigin!.x, event.clientY - this.rightOrigin!.y) < 5) return;
    this.x = event.clientX; this.y = event.clientY;
    if (!this.dragged) { this.dragged = true; this.result.input.cursorEvent(12); }
    const input = this.result.input;
    input.setPhysicalAxis(1, 0, Math.max(-1, Math.min(1, input.physicalAxis(1, 0) + dx * 0.01)));
    input.setPhysicalAxis(1, 1, Math.max(-1, Math.min(1, input.physicalAxis(1, 1) + dy * 0.01)));
  };
  private up = (event: PointerEvent) => {
    if (event.pointerType === 'touch') {
      this.fingers.up(event.pointerId);
      if (this.touchDrag) { if (!this.fingers.active) this.endTouchDrag(); return; }
    }
    this.trackPosition(event);
    if (event.button === 0 && this.pressed && event.pointerId === this.pressed.pointer) {
      this.stopHold();
      const pressed = this.pressed; this.pressed = undefined;
      if (pressed.dragged) {
        event.preventDefault();
        const target = this.result.osdButtons?.physicsAt(event.clientX, event.clientY);
        if (pressed.hit) this.result.input.cursorEvent(10, pressed.hit);
        if (pressed.hit) this.result.input.cursorEvent(2,this.pickWhilePressed(event)??pressed.hit);
        if (target) {
          const node = pressed.hit && this.result.gameTypes.getByResourceId(pressed.hit.id);
          const source = pressed.physics ? { physics: pressed.physics }
            : node ? { object: this.result.gameTypes.reference(node) } : undefined;
          if (source) void this.result.osdButtons.dropOn(target, source).catch(error => this.report(`Java drop: ${error instanceof Error ? error.message : String(error)}`));
        }
        if (this.viewport.hasPointerCapture(pressed.pointer)) this.viewport.releasePointerCapture(pressed.pointer);
      } else if (pressed.hit) {
        const hit = event.target instanceof HTMLCanvasElement ? this.pick?.(event.clientX, event.clientY) : undefined;
        this.result.input.cursorEvent(2, hit ?? pressed.hit);
        if (hit?.id === pressed.hit.id && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < 5)
          this.result.input.cursorEvent(5, hit);
      }
    }
    if (event.pointerId === this.pointer && event.button === 2) {
      const origin = this.rightOrigin, dragged = this.dragged;
      const hit = this.pick?.(event.clientX, event.clientY);
      this.cancel();
      if (!dragged && origin?.hit && hit?.id === origin.hit.id &&
          Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 5)
        this.result.input.cursorEvent(6, hit);
    }
  };
  /** The second finger turns a one-finger press into a camera gesture: drop the
   * press without a click and hold the right button, as for a mouse orbit. */
  private beginTouchDrag() {
    this.stopHold();
    const pressed = this.pressed; this.pressed = undefined;
    if (pressed) {
      if (pressed.dragged && pressed.hit) this.result.input.cursorEvent(10, pressed.hit);
      if (pressed.hit) this.result.input.cursorEvent(2, pressed.hit);
      this.result.input.setPickedTarget?.();
    }
    this.suppressClick = true;
    this.touchDrag = true; this.touchDragged = false; this.pinch = 0;
    this.result.input.setPhysicalAxis(1, 4, 1);
    this.result.input.cursorEvent(3);
  }
  private touchGesture(dx: number, dy: number, zoom: number) {
    const input = this.result.input;
    if ((dx || dy) && !this.touchDragged) { this.touchDragged = true; input.cursorEvent(12); }
    if (dx || dy) {
      input.setPhysicalAxis(1, 0, Math.max(-1, Math.min(1, input.physicalAxis(1, 0) + dx * 0.01)));
      input.setPhysicalAxis(1, 1, Math.max(-1, Math.min(1, input.physicalAxis(1, 1) + dy * 0.01)));
    }
    // Spreading the fingers (zoom < 1) zooms in like scrolling the wheel up.
    this.pinch -= Math.log(zoom);
    const notches = Math.trunc(this.pinch / PINCH_NOTCH);
    if (notches) { this.pinch -= notches * PINCH_NOTCH; input.setPhysicalAxis(1, 2, Math.sign(notches)); }
  }
  private startHold(pressed: NonNullable<JavaMouse['pressed']>) {
    this.stopHold();
    if (!pressed.physics || !this.result.osdButtons?.dropTargets) return;
    this.holdTimer = setTimeout(() => { this.holdTimer = undefined; void this.longPress(pressed).catch(error =>
      this.report(`Java drop menu: ${error instanceof Error ? error.message : String(error)}`)); }, LONG_PRESS_MS);
  }
  private stopHold() { if (this.holdTimer !== undefined) { clearTimeout(this.holdTimer); this.holdTimer = undefined; } }
  /** The press becomes a menu only if the gadget has somewhere to go; otherwise it stays an ordinary press. */
  private async longPress(pressed: NonNullable<JavaMouse['pressed']>) {
    const source = pressed.physics!;
    const { title, targets } = await this.result.osdButtons.dropTargets(source);
    if (!targets.length || this.pressed !== pressed || pressed.dragged || this.disposed) return;
    this.pressed = undefined; this.suppressClick = true;
    this.closeMenu?.();
    this.closeMenu = this.showMenu(this.viewport, pressed.x, pressed.y, title, targets.map(target => target.label), index => {
      this.closeMenu = undefined;
      void this.result.osdButtons.dropOn(targets[index].physics, { physics: source })
        .catch(error => this.report(`Java drop: ${error instanceof Error ? error.message : String(error)}`));
    });
  }
  private endTouchDrag() {
    if (!this.touchDrag) return;
    this.touchDrag = false;
    if (this.touchDragged) this.result.input.cursorEvent(13);
    this.result.input.cursorEvent(4); this.touchDragged = false;
    for (const axis of [0, 1, 2, 4]) this.result.input.setPhysicalAxis(1, axis, 0);
  }
  private cancelPointer = (event: PointerEvent) => {
    if (event.pointerType === 'touch') {
      this.fingers.up(event.pointerId);
      if (this.touchDrag) { if (!this.fingers.active) this.endTouchDrag(); return; }
    }
    this.cancel();
  };
  private blur = () => { this.fingers.clear(); this.endTouchDrag(); this.cancel(); };
  private click = (event: MouseEvent) => {
    if (!this.suppressClick) return;
    this.suppressClick = false; event.preventDefault(); event.stopImmediatePropagation();
  };
  private cancel = () => {
    this.stopHold();
    const pressed = this.pressed; this.pressed = undefined;
    if (pressed?.dragged) {
      if (pressed.hit) this.result.input.cursorEvent(10, pressed.hit);
      if (this.viewport.hasPointerCapture(pressed.pointer)) this.viewport.releasePointerCapture(pressed.pointer);
    }
    if(pressed?.hit)this.result.input.cursorEvent(2,pressed.hit);
    this.result.input.setPickedTarget?.();
    if (this.pointer === undefined) return;
    const id = this.pointer; this.pointer = undefined;
    this.rightOrigin = undefined;
    if (this.dragged) this.result.input.cursorEvent(13);
    this.result.input.cursorEvent(4); this.dragged = false;
    for (const axis of [0, 1, 2, 4]) this.result.input.setPhysicalAxis(1, axis, 0);
    if (this.viewport.hasPointerCapture(id)) this.viewport.releasePointerCapture(id);
  };
  private wheel = (event: WheelEvent) => {
    if (!this.controlled() || !(event.target instanceof HTMLCanvasElement)) return;
    event.preventDefault();
    this.result.input.setPhysicalAxis(1, 2, -Math.sign(event.deltaY));
  };
  private context = (event: MouseEvent) => { if (this.controlled()) event.preventDefault(); };
  private update() {
    const cursor = this.cursor();
    if (!cursor?.value) return;
    const { jvm, gameTypes } = this.result;
    const native = jvm.get(cursor, 'cursor');
    const command = gameTypes.lastCommand(native, 'mode');
    const enabled = Number(jvm.get(cursor, 'visible').value) !== 0;
    const key = `${enabled}:${command}`;
    if (key === this.key) return;
    this.key = key;
    if (!enabled) { this.apply('none'); return; }
    const match = command && /^mode\s+\d+\s+(\S)\s+(-?\d+)/.exec(command);
    if (!match) { this.apply('default'); return; }
    const cache = `${match[2]}:${match[1]}`;
    if (!this.styles.has(cache)) this.styles.set(cache, this.load(Number(match[2]), match[1]));
    void this.styles.get(cache)!.then(style => { if (!this.disposed && this.key === key) this.apply(style); })
      .catch(error => { if (!this.disposed && this.key === key) { this.apply('default'); this.report(`Java cursor: ${String(error)}`); } });
  }
  private apply(style: string) {
    this.viewport.dataset.gameCursor = 'true';
    this.viewport.style.cursor = style;
  }
  private async load(id: number, character: string): Promise<string> {
    if (this.assets.byPath.get('streetlegal_redline.exe')?.size) {
      this.exe ??= this.assets.read('streetlegal_redline.exe');
      const image = readExeCursor(await this.exe, stockCursorIndex(character));
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      canvas.getContext('2d')!.putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0);
      return `url("${canvas.toDataURL()}") ${image.hotspotX} ${image.hotspotY}, default`;
    }
    const identity = this.result.resolveResourceIdentity(id);
    if (!identity) throw new Error(`Cursor font resource ${id} has no identity`);
    const model = await this.assets.modelForResource(identity.pack, identity.id);
    const mesh = (await parseScxAsync(await this.assets.read(model.path))).meshes[0];
    const rect = pointerUv(mesh, character);
    if (!(rect.width > 0 && rect.height > 0)) return 'default';
    const path = model.textures[mesh.textureIndex];
    // The game ships browser-readable PNG siblings of its original TGA atlases.
    const png = path.replace(/\.tga$/i, '.png');
    let bitmap: ImageBitmap;
    if (this.assets.byPath.has(normalizePath(png))) {
      const bytes = await this.assets.read(png);
      bitmap = await createImageBitmap(new Blob([bytes.slice().buffer]));
    } else if (/\.tga$/i.test(path)) {
      const bytes = await this.assets.read(path);
      const texture = new TGALoader().parse(bytes.slice().buffer);
      const image = texture.image;
      bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height));
      texture.dispose();
    } else throw new Error(`Unsupported cursor atlas: ${path}`);
    try {
      const canvas = document.createElement('canvas');
      canvas.height = 32; canvas.width = Math.max(1, Math.round(32 * rect.width / rect.height));
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, rect.x * bitmap.width, rect.y * bitmap.height,
        rect.width * bitmap.width, rect.height * bitmap.height, 0, 0, canvas.width, canvas.height);
      const centered = !['J', 'K', 'L'].includes(character);
      return `url("${canvas.toDataURL()}") ${centered ? Math.floor(canvas.width / 2) : 0} ${centered ? 16 : 0}, default`;
    } finally { bitmap.close(); }
  }
  dispose() {
    this.blur(); this.closeMenu?.(); this.closeMenu = undefined; this.disposed = true; clearInterval(this.timer);
    this.viewport.removeEventListener('pointerdown', this.down);
    this.viewport.removeEventListener('click', this.click, true);
    this.viewport.removeEventListener('pointermove', this.move);
    this.viewport.removeEventListener('pointerup', this.up);
    this.viewport.removeEventListener('pointercancel', this.cancelPointer);
    this.viewport.removeEventListener('lostpointercapture', this.cancel);
    this.viewport.removeEventListener('wheel', this.wheel);
    this.viewport.removeEventListener('contextmenu', this.context);
    window.removeEventListener('blur', this.blur);
    window.removeEventListener('pointerup',this.up);
    delete this.viewport.dataset.gameCursor; this.viewport.style.removeProperty('cursor');
    this.styles.clear();
  }
}
