import type { Assets } from '../assets';
import type { BootResult } from '../runtime/game-boot';
import { parseScx, type ScxMesh } from '../formats/scx';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import { normalizePath } from '../assets';
import { readExeCursor, stockCursorIndex } from '../formats/exe-cursor';

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
  private pressed?: { id: number; x: number; y: number };
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
  constructor(private readonly viewport: HTMLElement, private readonly result: BootResult,
    private readonly assets: Assets, private readonly report: (message: string) => void,
    private readonly pick?: (x: number, y: number) => { id: number; local: number[]; world: number[] } | undefined) {
    viewport.addEventListener('pointerdown', this.down);
    viewport.addEventListener('pointermove', this.move);
    viewport.addEventListener('pointerup', this.up);
    viewport.addEventListener('pointercancel', this.cancel);
    viewport.addEventListener('lostpointercapture', this.cancel);
    viewport.addEventListener('wheel', this.wheel, { passive: false });
    viewport.addEventListener('contextmenu', this.context);
    window.addEventListener('blur', this.cancel);
    this.timer = setInterval(() => this.update(), 50);
    this.update();
  }
  private cursor() { return this.result.input.mouseCursor(); }
  private controlled() {
    const cursor = this.cursor();
    return !!cursor?.value && !!this.result.jvm.get(cursor, 'controlledcam').value;
  }
  private down = (event: PointerEvent) => {
    if (event.button === 0 && this.controlled() && event.target instanceof HTMLCanvasElement) {
      const hit = this.pick?.(event.clientX, event.clientY);
      if (hit) { this.pressed = { id: hit.id, x: event.clientX, y: event.clientY }; this.result.input.cursorEvent(1, hit); }
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
    if (event.pointerId !== this.pointer) {
      const hit = this.controlled() && event.target instanceof HTMLCanvasElement ? this.pick?.(event.clientX, event.clientY) : undefined;
      if (hit?.id !== this.hovered?.id) {
        if (this.hovered) this.result.input.cursorEvent(16, this.hovered);
        if (hit) this.result.input.cursorEvent(15, hit);
      }
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
    if (event.button === 0 && this.pressed) {
      const pressed = this.pressed; this.pressed = undefined;
      const hit = this.pick?.(event.clientX, event.clientY);
      if (hit?.id === pressed.id && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < 5) {
        this.result.input.cursorEvent(2, hit); this.result.input.cursorEvent(5, hit);
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
  private cancel = () => {
    this.pressed = undefined;
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
    const mesh = parseScx(await this.assets.read(model.path)).meshes[0];
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
    this.cancel(); this.disposed = true; clearInterval(this.timer);
    this.viewport.removeEventListener('pointerdown', this.down);
    this.viewport.removeEventListener('pointermove', this.move);
    this.viewport.removeEventListener('pointerup', this.up);
    this.viewport.removeEventListener('pointercancel', this.cancel);
    this.viewport.removeEventListener('lostpointercapture', this.cancel);
    this.viewport.removeEventListener('wheel', this.wheel);
    this.viewport.removeEventListener('contextmenu', this.context);
    window.removeEventListener('blur', this.cancel);
    delete this.viewport.dataset.gameCursor; this.viewport.style.removeProperty('cursor');
    this.styles.clear();
  }
}
