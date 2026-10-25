import type { Assets } from '../assets';
import { OsdLayer, type OsdResource } from './osd-layer';
import type { MainMenuItem } from '../runtime/main-menu-runtime';

export function mountMainMenu(viewport: HTMLElement, assets: Assets, items: readonly MainMenuItem[], initialSelection: number, onCommand: (item: MainMenuItem) => void, onClose: () => void) {
  if (!items.length || initialSelection < 0 || initialSelection >= items.length) throw new Error('Invalid main menu items');
  const osd = new OsdLayer(viewport, assets);
  const resource = (id: number): OsdResource => ({ pack: 'frontend.rpk', id });
  osd.createRectangle(0, 0, 2, 2, 0, resource(0xc00a));
  osd.createRectangle(0, 0, 2, 0.65, 1, resource(0xc00f));
  osd.createRectangle(0.45, 0.86, 1, 0.18, 2, resource(0xc00d));
  osd.createRectangle(0.72, 0.69, 0.28, 0.11, 2, resource(0xc00b));
  osd.endGroup();

  let selected = initialSelection;
  const left = osd.createRectangle(-0.45, 0, 0.16, 0.28, 2, resource(items[(selected - 1 + items.length) % items.length].disabled));
  const right = osd.createRectangle(0.45, 0, 0.16, 0.28, 2, resource(items[(selected + 1) % items.length].disabled));
  const center = osd.createButton(items[selected].label, 0, 0, 0.23, 0.41, 3, resource(items[selected].active), activate);
  const title = osd.createText(items[selected].label, 'center', 0, 0.67, 3);
  title.node.classList.add('osd-menu-title');
  const message = osd.createText('', 'center', 0, -0.73, 3);
  message.node.classList.add('osd-menu-message');
  osd.createButton('Предыдущий пункт', -0.82, 0, 0.12, 0.2, 4, resource(0xd15d), () => change(-1));
  osd.createButton('Следующий пункт', 0.82, 0, 0.12, 0.2, 4, resource(0xd15e), () => change(1));
  const arrows = osd.endGroup();
  osd.showGroup(arrows);

  function change(direction: number) {
    selected = (selected + direction + items.length) % items.length;
    const item = items[selected];
    center.setResource(resource(item.active)); center.node.setAttribute('aria-label', item.label);
    left.setResource(resource(items[(selected - 1 + items.length) % items.length].disabled));
    right.setResource(resource(items[(selected + 1) % items.length].disabled));
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
    dispose: () => { window.removeEventListener('keydown', keydown); osd.dispose(); },
    get selectedCommand() { return items[selected].command; },
  };
}
