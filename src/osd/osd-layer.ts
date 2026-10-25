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
  show(): void;
  hide(): void;
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
