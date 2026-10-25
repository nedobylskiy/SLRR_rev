import type { Assets } from '../assets';
import { OsdLayer, type OsdResource } from './osd-layer';

interface MenuItem { label: string; active: number; disabled: number; command: number }
// MainMenu.java / Gates.buildSlidingMenu() in the installed SLRR scripts.
export const MAIN_MENU_ITEMS: readonly MenuItem[] = [
  { label: 'LOAD CAR', active: 0xc105, disabled: 0xc205, command: 0xa001 },
  { label: 'LOAD CAREER', active: 0xc106, disabled: 0xc206, command: 0xa003 },
  { label: 'DELETE CAREER', active: 0xc101, disabled: 0xc201, command: 0xa005 },
  { label: 'NEW CAREER', active: 0xc107, disabled: 0xc207, command: 0xa006 },
  { label: 'FREERIDE', active: 0xc104, disabled: 0xc204, command: 0xa008 },
  { label: 'QUICK RACE', active: 0xc10b, disabled: 0xc20b, command: 0xa009 },
  { label: 'EXTRAS', active: 0xc103, disabled: 0xc203, command: 0xb002 },
  { label: 'OPTIONS', active: 0xc108, disabled: 0xc208, command: 0xb003 },
  { label: 'EXIT GAME', active: 0xc102, disabled: 0xc202, command: 0xb004 },
];

export function mountMainMenu(viewport: HTMLElement, assets: Assets, onCommand: (item: MenuItem) => void, onClose: () => void) {
  const osd = new OsdLayer(viewport, assets);
  const resource = (id: number): OsdResource => ({ pack: 'frontend.rpk', id });
  osd.createRectangle(0, 0, 2, 2, 0, resource(0xc00a));
  osd.createRectangle(0, 0, 2, 0.65, 1, resource(0xc00f));
  osd.createRectangle(0.45, 0.86, 1, 0.18, 2, resource(0xc00d));
  osd.createRectangle(0.72, 0.69, 0.28, 0.11, 2, resource(0xc00b));
  osd.endGroup();

  let selected = 3; // Gates.buildSlidingMenu() activates its fourth item.
  const left = osd.createRectangle(-0.45, 0, 0.16, 0.28, 2, resource(MAIN_MENU_ITEMS[2].disabled));
  const right = osd.createRectangle(0.45, 0, 0.16, 0.28, 2, resource(MAIN_MENU_ITEMS[4].disabled));
  const center = osd.createButton('NEW CAREER', 0, 0, 0.23, 0.41, 3, resource(MAIN_MENU_ITEMS[selected].active), activate);
  const title = osd.createText(MAIN_MENU_ITEMS[selected].label, 'center', 0, 0.67, 3);
  title.node.classList.add('osd-menu-title');
  const message = osd.createText('', 'center', 0, -0.73, 3);
  message.node.classList.add('osd-menu-message');
  osd.createButton('Предыдущий пункт', -0.82, 0, 0.12, 0.2, 4, resource(0xd15d), () => change(-1));
  osd.createButton('Следующий пункт', 0.82, 0, 0.12, 0.2, 4, resource(0xd15e), () => change(1));
  const arrows = osd.endGroup();
  osd.showGroup(arrows);

  function change(direction: number) {
    selected = (selected + direction + MAIN_MENU_ITEMS.length) % MAIN_MENU_ITEMS.length;
    const item = MAIN_MENU_ITEMS[selected];
    center.setResource(resource(item.active)); center.node.setAttribute('aria-label', item.label);
    left.setResource(resource(MAIN_MENU_ITEMS[(selected - 1 + MAIN_MENU_ITEMS.length) % MAIN_MENU_ITEMS.length].disabled));
    right.setResource(resource(MAIN_MENU_ITEMS[(selected + 1) % MAIN_MENU_ITEMS.length].disabled));
    title.setText(item.label); message.setText('');
  }
  function activate() { onCommand(MAIN_MENU_ITEMS[selected]); }
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
    get selectedCommand() { return MAIN_MENU_ITEMS[selected].command; },
  };
}
