/** Long-press action menu for touch screens: lists OSD drop targets (Mechanic
 * "Repair Part", "Sell Part", ...) so a part can be repaired or sold without a
 * drag. It only reports the choice; the caller performs the Java drop. */
export type DropMenu = (host: HTMLElement, x: number, y: number, labels: string[], choose: (index: number) => void) => () => void;

const STYLE_ID = 'slrr-drop-menu-style';
const STYLE = `
.slrr-drop-menu-backdrop { position: fixed; inset: 0; z-index: 2147483000; touch-action: none; }
.slrr-drop-menu { position: fixed; min-width: 180px; max-width: min(320px, 90vw); padding: 6px; display: grid; gap: 4px;
  background: rgba(16, 14, 12, .94); border: 1px solid rgba(255, 196, 64, .55); border-radius: 8px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, .6); font: 600 15px/1.2 system-ui, sans-serif; color: #f4ead2; }
.slrr-drop-menu button { all: unset; box-sizing: border-box; padding: 12px 14px; border-radius: 6px; cursor: pointer;
  background: rgba(255, 255, 255, .06); text-align: left; }
.slrr-drop-menu button:active, .slrr-drop-menu button:hover { background: rgba(255, 196, 64, .28); }
.slrr-drop-menu button.cancel { color: #b9ae96; font-weight: 500; }
`;

export const showDropMenu: DropMenu = (host, x, y, labels, choose) => {
  const document = host.ownerDocument;
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style'); style.id = STYLE_ID; style.textContent = STYLE;
    document.head.append(style);
  }
  const backdrop = document.createElement('div'); backdrop.className = 'slrr-drop-menu-backdrop';
  const menu = document.createElement('div'); menu.className = 'slrr-drop-menu'; menu.setAttribute('role', 'menu');
  let open = true;
  const close = () => { if (!open) return; open = false; backdrop.remove(); };
  const item = (label: string, action: () => void, extra = '') => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.setAttribute('role', 'menuitem'); if (extra) button.className = extra;
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); close(); action(); });
    menu.append(button);
  };
  labels.forEach((label, index) => item(label, () => choose(index)));
  item('Cancel', () => {}, 'cancel');
  // Keep these events away from the game's own pointer and click handlers on the viewport.
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'click', 'contextmenu', 'wheel'])
    backdrop.addEventListener(type, event => {
      event.stopPropagation();
      if (event.target === backdrop && (type === 'pointerdown' || type === 'contextmenu')) { event.preventDefault(); close(); }
    });
  backdrop.append(menu); host.append(backdrop);
  // Open beside the finger, kept inside the window.
  const width = menu.offsetWidth, height = menu.offsetHeight;
  const view = document.defaultView!;
  menu.style.left = `${Math.max(8, Math.min(x - width / 2, view.innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y - height - 24, view.innerHeight - height - 8))}px`;
  return close;
};
