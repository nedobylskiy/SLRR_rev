import type { Assets } from '../assets';
import { OsdLayer, OsdMotionController, type OsdElement, type OsdResource } from './osd-layer';
import type { MainMenuItem, MainMenuLayout, MenuMotion, MenuResource } from '../runtime/main-menu-runtime';

export function mountMainMenu(viewport: HTMLElement, assets: Assets, items: readonly MainMenuItem[], initialSelection: number,
  layout: MainMenuLayout, motions: readonly MenuMotion[], dispatch: (action: 'left' | 'right' | 'select') => { selected: number; command?: number },
  onCommand: (item: MainMenuItem) => void, onClose: () => void, backgroundVideoUrl?: string,
  tick?: () => { text: string; color: number }, versionText = '') {
  if (!items.length || initialSelection < 0 || initialSelection >= items.length) throw new Error('Invalid main menu items');
  const osd = new OsdLayer(viewport, assets);
  const resource = (id: number): OsdResource => ({ pack: 'frontend.rpk', id });
  const itemResource = (ref: MenuResource): OsdResource => ({ pack: /\.rpk$/i.test(ref.pack) ? ref.pack : `${ref.pack}.rpk`, id: ref.id });
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
  const centerLine = osd.createRectangle(0, 0, 2, 0.65, 1, resource(0xc00f));
  const streetLegal = osd.createRectangle(0.28, -0.72, 1.2, 0.22, 2, resource(0xc00d));
  const redline = osd.createRectangle(0.46, -0.57, 0.33, 0.09, 2, resource(0xc00b));
  osd.endGroup();

  let selected = initialSelection;
  let closing = false;
  let ready = motions.length === 0;
  let animationTimer: number | undefined;
  const spacing = layout.spacing * 0.6;
  const slots = items.map((item, index) => {
    const offset = index - selected;
    const scale = offset ? 1.1 : 1.43;
    const icon = osd.createButton(item.label, offset * spacing, layout.y, item.width * scale, item.height * scale, offset ? item.depth : item.depth + 1,
      itemResource(offset ? item.disabled : item.active), () => index === selected ? activate() : change(index - selected));
    icon.node.classList.add('osd-menu-icon');
    if (Math.abs(offset) > 3) icon.hide();
    return icon;
  });
  const title = osd.createText(items[selected].label, 'center', 0, 0.75, 3);
  title.node.classList.add('osd-menu-title');
  const version = osd.createText(versionText, 'left', -0.975, 0.95, 3);
  version.node.classList.add('osd-menu-version');
  const message = osd.createText('', 'center', 0, 0.89, 3);
  message.node.classList.add('osd-menu-message');
  osd.endGroup();
  osd.createButton('Previous item', -0.855, 0, 0.1, 0.2, 4, resource(0xd15d), () => change(-1));
  osd.createButton('Next item', 0.855, 0, 0.1, 0.2, 4, resource(0xd15e), () => change(1));
  const arrows = osd.endGroup();
  if (motions.length) { osd.hideGroup(arrows); title.hide(); }

  const moving: Record<string, OsdElement[]> = {
    center_line: [centerLine], slider: slots, logo_streetlegal_resized: [streetLegal], logo_redline_resized: [redline],
  };
  const motionController = new OsdMotionController();
  const playMotion = (sequence: readonly MenuMotion[]) => Promise.all(sequence.flatMap(motion =>
    (moving[motion.target] ?? []).map(element => motionController.animate(element.node, motion))));

  function arrange(previous: number) {
    const duration = Math.round(160 / Math.max(0.1, layout.speed));
    slots.forEach((icon, index) => {
      const item = items[index], offset = index - selected;
      if (Math.abs(offset) <= 3 || Math.abs(index - previous) <= 3) icon.show();
      const scale = offset ? 1.1 : 1.43;
      icon.node.style.transition = `left ${duration}ms ease-in-out, width ${duration}ms ease-in-out, height ${duration}ms ease-in-out`;
      icon.setBounds(offset * spacing, layout.y, item.width * scale, item.height * scale, offset ? item.depth : item.depth + 1);
      icon.setResource(itemResource(offset ? item.disabled : item.active));
    });
    window.setTimeout(() => {
      slots.forEach((icon, index) => { if (Math.abs(index - selected) > 3) icon.hide(); });
      ready = true;
    }, duration);
  }

  function change(direction: number) {
    if (closing || !ready) return;
    const previous = selected;
    for (let step = 0; step < Math.abs(direction); step++) selected = dispatch(direction < 0 ? 'left' : 'right').selected;
    if (previous === selected) return;
    ready = false;
    arrange(previous);
    message.setText('');
  }
  function activate() {
    if (closing || !ready) return;
    const result = dispatch('select');
    if (result.command !== undefined) onCommand(items[selected]);
  }
  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); change(-1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); change(1); }
    else if (event.key === 'Enter') { event.preventDefault(); activate(); }
  }
  window.addEventListener('keydown', keydown);
  if (tick) animationTimer = window.setInterval(() => {
    if (!ready || closing) return;
    const frame = tick();
    if (title.node.textContent !== frame.text) {
      title.setText(frame.text);
      title.node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
    }
    const argb = frame.color >>> 0;
    title.node.style.color = `rgba(${(argb >>> 16) & 255},${(argb >>> 8) & 255},${argb & 255},${((argb >>> 24) & 255) / 255})`;
  }, 10);
  osd.show(); osd.focus();
  if (motions.length) {
    void playMotion(motions)
      .then(() => { if (osd.root.isConnected) { ready = true; osd.showGroup(arrows); title.show(); } });
  }
  return {
    showMessage: (text: string) => message.setText(text),
    animateOut: async (sequence: readonly MenuMotion[]) => {
      closing = true; osd.hideGroup(arrows); title.hide();
      await playMotion(sequence);
    },
    dispose: () => { if (animationTimer !== undefined) window.clearInterval(animationTimer); window.removeEventListener('keydown', keydown); video?.pause(); video?.removeAttribute('src'); osd.dispose(); },
    get selectedCommand() { return items[selected].command; },
  };
}
