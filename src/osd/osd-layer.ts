import { entryProperties } from '../formats/rpk';
import type { Assets } from '../assets';

export type OsdResource = { pack: string; id: number };
export type OsdAlign = 'left' | 'center' | 'right';

/** Original OSD positions use a screen-centred -1..1 space, with positive Y downward. */
export function osdBounds(x: number, y: number, width = 0, height = 0) {
  return { left: (x + 1 - width / 2) * 50, top: (y + 1 - height / 2) * 50, width: width * 50, height: height * 50 };
}

export interface OsdElement {
  readonly node: HTMLElement;
  setText(value: string): void;
  setResource(resource: OsdResource): void;
  setBounds(x: number, y: number, width: number, height: number, depth: number): void;
  show(): void;
  hide(): void;
}

export interface OsdMotion { operation: 'runAnimation' | 'teleport' | 'reverseAnimation'; speed: number; steps: number; direction: number; axis: string }

/** Translate Java's per-step OSD motion to a screen-space interval. */
export function osdMotionInterval(destination: number, motion: OsdMotion): [number, number] {
  const travel = motion.speed * motion.steps * motion.direction * 50;
  return motion.operation === 'teleport' ? [destination + travel, destination] : [destination - travel, destination];
}

export class OsdMotionController {
  private origins = new WeakMap<HTMLElement, { axis: 'left' | 'top'; start: number; end: number; duration: number }>();
  animate(node: HTMLElement, motion: OsdMotion): Promise<void> {
    const axis = motion.axis.toUpperCase() === 'Y' ? 'top' : 'left';
    const destination = Number.parseFloat(node.style[axis]);
    const previous = this.origins.get(node);
    const reverse = (motion.operation === 'reverseAnimation' || (motion.operation === 'teleport' && motion.steps === 0)) && previous;
    const [start, end] = reverse ? [previous.end, previous.start] : previous
      ? [destination, destination + motion.speed * motion.steps * motion.direction * 50] : osdMotionInterval(destination, motion);
    const duration = reverse ? previous.duration : Math.max(1, motion.steps) * 16;
    if (!reverse) this.origins.set(node, { axis, start, end, duration });
    if (!Number.isFinite(start) || !Number.isFinite(end) || typeof node.animate !== 'function') return Promise.resolve();
    const animation = node.animate([{ [axis]: `${start}%` }, { [axis]: `${end}%` }], { duration, easing: 'ease-out', fill: 'both' });
    return animation.finished.then(() => { node.style[axis] = `${end}%`; animation.cancel(); }, () => undefined);
  }
}

/** A screen-space OSD renderer kept separate from the 3D scene and its camera. */
export class OsdLayer {
  readonly root = document.createElement('div');
  readonly stage = document.createElement('div');
  private nextGroup = 0;
  private groups = new Map<number, HTMLElement[]>();
  private images = new Map<string, Promise<string>>();
  private objectUrls = new Set<string>();
  private disposed = false;
  private observer: ResizeObserver;

  constructor(private viewport: HTMLElement, private assets: Assets) {
    this.root.className = 'osd-layer';
    this.stage.className = 'osd-stage';
    this.stage.tabIndex = 0;
    this.root.append(this.stage); viewport.append(this.root);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.root);
    this.resize();
  }

  private resize() {
    const width = Math.min(this.root.clientWidth, this.root.clientHeight * 16 / 9);
    this.stage.style.width = `${width}px`;
    this.stage.style.height = `${width * 9 / 16}px`;
  }

  getViewportSize() {
    return { width: Number.parseFloat(this.stage.style.width) || this.stage.clientWidth || 16,
      height: Number.parseFloat(this.stage.style.height) || this.stage.clientHeight || 9 };
  }

  private place(node: HTMLElement, x: number, y: number, width: number, height: number, depth: number) {
    const bounds = osdBounds(x, y, width, height);
    node.style.left = `${bounds.left}%`;
    node.style.top = `${bounds.top}%`;
    if (width) node.style.width = `${bounds.width}%`;
    if (height) node.style.height = `${bounds.height}%`;
    node.style.zIndex = String(depth + 10);
    node.classList.add('osd-item');
    this.stage.append(node);
    const members = this.groups.get(this.nextGroup) ?? [];
    members.push(node); this.groups.set(this.nextGroup, members);
    return node;
  }

  private handle(node: HTMLElement, image?: HTMLImageElement): OsdElement {
    let imageRequest = 0;
    return {
      node,
      setText: value => { node.textContent = value; },
      setResource: resource => {
        if (!image) return;
        const request = ++imageRequest;
        void this.imageUrl(resource).then(url => { if (!this.disposed && request === imageRequest) image.src = url; })
          .catch(() => { if (!this.disposed && request === imageRequest) node.classList.add('osd-missing-image'); });
      },
      setBounds: (x, y, width, height, depth) => {
        const bounds = osdBounds(x, y, width, height);
        node.style.left = `${bounds.left}%`; node.style.top = `${bounds.top}%`;
        node.style.width = `${bounds.width}%`; node.style.height = `${bounds.height}%`;
        node.style.zIndex = String(depth + 10);
      },
      show: () => { node.hidden = false; },
      hide: () => { node.hidden = true; },
    };
  }

  private imageUrl(resource: OsdResource) {
    const key = `${resource.pack.toLowerCase()}:${resource.id}`;
    let cached = this.images.get(key);
    if (!cached) {
      cached = (async () => {
        const { entry } = await this.assets.resource(resource.pack, resource.id);
        const source = entryProperties(entry).find(property => property.key === 'sourcefile')?.value;
        if (!source) throw new Error(`OSD resource ${key} has no sourcefile`);
        const bytes = await this.assets.read(source);
        const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: /\.png$/i.test(source) ? 'image/png' : 'image/jpeg' }));
        if (this.disposed) URL.revokeObjectURL(url); else this.objectUrls.add(url);
        return url;
      })();
      this.images.set(key, cached);
    }
    return cached;
  }

  createRectangle(x: number, y: number, width: number, height: number, depth: number, resource: OsdResource) {
    const node = this.place(document.createElement('div'), x, y, width, height, depth);
    node.classList.add('osd-rectangle');
    const image = document.createElement('img'); image.alt = ''; node.append(image);
    const handle = this.handle(node, image); handle.setResource(resource);
    return handle;
  }

  createText(value: string, align: OsdAlign, x: number, y: number, depth = 2) {
    const node = this.place(document.createElement('span'), x, y, 0, 0, depth);
    node.classList.add('osd-text', `osd-align-${align}`);
    node.textContent = value;
    return this.handle(node);
  }

  createHitTarget(label: string, x: number, y: number, width: number, height: number, depth: number,
    action: () => void) {
    const node = this.place(document.createElement('button'), x, y, width, height, depth) as HTMLButtonElement;
    node.type = 'button';
    node.classList.add('osd-hit-target');
    node.setAttribute('aria-label', label.trim() || 'OSD action');
    node.onclick = action;
    return this.handle(node);
  }

  createButton(label: string, x: number, y: number, width: number, height: number, depth: number, resource: OsdResource, action: () => void) {
    const node = this.place(document.createElement('button'), x, y, width, height, depth) as HTMLButtonElement;
    node.type = 'button'; node.classList.add('osd-button'); node.setAttribute('aria-label', label);
    const image = document.createElement('img'); image.alt = ''; node.append(image);
    node.onclick = action;
    const handle = this.handle(node, image); handle.setResource(resource);
    return handle;
  }

  endGroup() { return this.nextGroup++; }
  hideGroup(group: number) { for (const node of this.groups.get(group) ?? []) node.hidden = true; }
  showGroup(group: number) { for (const node of this.groups.get(group) ?? []) node.hidden = false; }
  show() { this.root.hidden = false; }
  hide() { this.root.hidden = true; }
  focus() { this.stage.focus(); }
  dispose() {
    this.disposed = true;
    this.observer.disconnect();
    this.root.remove();
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls.clear(); this.images.clear();
  }
}
