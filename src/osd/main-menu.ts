import type { Assets } from '../assets';
import { OsdLayer, type OsdResource } from './osd-layer';
import type { MainMenuItem } from '../runtime/main-menu-runtime';

export function mountMainMenu(viewport: HTMLElement, assets: Assets, items: readonly MainMenuItem[], initialSelection: number, onCommand: (item: MainMenuItem) => void, onClose: () => void, backgroundVideoUrl?: string) {
  if (!items.length || initialSelection < 0 || initialSelection >= items.length) throw new Error('Invalid main menu items');
  const osd = new OsdLayer(viewport, assets);
  const resource = (id: number): OsdResource => ({ pack: 'frontend.rpk', id });
  const fallback = osd.createRectangle(0, 0, 2, 2, 0, resource(0xc00a));
  let video: HTMLVideoElement | undefined;
  if (backgroundVideoUrl) {
    video = document.createElement('video'); video.className = 'osd-background-video';
    video.muted = true; video.autoplay = true; video.loop = true; video.playsInline = true;
    video.onplaying = () => fallback.hide();
    video.onerror = () => fallback.show();
    video.src = backgroundVideoUrl; osd.stage.prepend(video);
    void video.play().catch(() => fallback.show());
  }
  osd.createRectangle(0, 0, 2, 0.65, 1, resource(0xc00f));
  osd.createRectangle(0.28, -0.72, 1.2, 0.22, 2, resource(0xc00d));
  osd.createRectangle(0.46, -0.57, 0.33, 0.09, 2, resource(0xc00b));
  osd.endGroup();

  let selected = initialSelection;
  const slots = Array.from({ length: 7 }, (_, index) => {
    const offset = index - 3, item = items[(selected + offset + items.length) % items.length];
    const icon = osd.createButton(item.label, offset * 0.285, 0, offset ? 0.22 : 0.285, offset ? 0.39 : 0.51, offset ? 2 : 3,
      resource(offset ? item.disabled : item.active), () => offset ? change(offset) : activate());
    icon.node.classList.add('osd-menu-icon');
    return icon;
  });
  const title = osd.createText(items[selected].label, 'center', 0, 0.75, 3);
  title.node.classList.add('osd-menu-title');
  const version = osd.createText('v2.3.1 (build 940)', 'left', -0.975, 0.95, 3);
  version.node.classList.add('osd-menu-version');
  const message = osd.createText('', 'center', 0, 0.89, 3);
  message.node.classList.add('osd-menu-message');
  osd.createButton('Предыдущий пункт', -0.855, 0, 0.1, 0.2, 4, resource(0xd15d), () => change(-1));
  osd.createButton('Следующий пункт', 0.855, 0, 0.1, 0.2, 4, resource(0xd15e), () => change(1));
  const arrows = osd.endGroup();
  osd.showGroup(arrows);

  function change(direction: number) {
    selected = (selected + direction + items.length) % items.length;
    const item = items[selected];
    slots.forEach((icon, index) => {
      const offset = index - 3, visible = items[(selected + offset + items.length) % items.length];
      icon.setResource(resource(offset ? visible.disabled : visible.active));
      icon.node.setAttribute('aria-label', visible.label);
    });
    title.setText(item.label); message.setText('');
  }
  function activate() { onCommand(items[selected]); }
  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); change(-1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); change(1); }
    else if (event.key === 'Enter') { event.preventDefault(); activate(); }
  }
  window.addEventListener('keydown', keydown);
  osd.show(); osd.focus();
  return {
    showMessage: (text: string) => message.setText(text),
    dispose: () => { window.removeEventListener('keydown', keydown); video?.pause(); video?.removeAttribute('src'); osd.dispose(); },
    get selectedCommand() { return items[selected].command; },
  };
}
