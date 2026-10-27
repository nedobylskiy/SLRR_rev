import { jv, type JavaObject, type JavaValue, type SlrrJvm } from 'slrr-jvm';
import type { OsdAlign, OsdElement, OsdLayer } from '../osd/osd-layer';
import { FULL_OSD_VIEWPORT, osdDepth, projectOsdBounds, type OsdViewport } from './osd-depth';

interface TextState { element?: OsdElement; group?: JavaObject; x: number; y: number; viewport: OsdViewport; align: OsdAlign; scaleX: number; scaleY: number; fontSize: number; fadeGlyph: boolean; depth: number }

/** Native Text operations; the original Java constructors and changeText logic still execute. */
export class OsdTextNative {
  private readonly states = new WeakMap<JavaObject, TextState>();
  private readonly live = new Set<OsdElement>();

  constructor(private readonly jvm: SlrrJvm, private readonly layer?: Pick<OsdLayer, 'createText'>,
    private readonly viewportLayout: (group: JavaValue) => OsdViewport = () => FULL_OSD_VIEWPORT) {
    const owner = 'java.render.Text';
    const nil = () => jv('void', undefined);
    jvm.natives.register(owner, 'create', ['ResourceRef', 'ResourceRef', 'float', 'float'], ({ receiver, args }) => {
      const object = this.object(receiver);
      const x = Number(args[2].value), y = Number(args[3].value);
      const fontId = Number(jvm.natives.invoke('java.util.resource.ResourceRef', 'id', args[1], [])?.value ?? 0) & 0xffff;
      const fadeGlyph = fontId === 0x1a25 || fontId === 0x1a26;
      const fontSize = [0x139, 0xc02a, 0xc02d, 0xc12a].includes(fontId) ? 15
        : fontId === 0x138 ? 10 : fontId === 0xb2 ? 7 : 24;
      const viewport = this.viewportLayout(args[0]);
      const depth = osdDepth(viewport.priority, 2);
      const point = projectOsdBounds(viewport, x, y);
      const element = this.layer?.createText('', 'left', point.x, point.y, depth);
      if (element) element.node.style.fontSize = `${fontSize}px`;
      if (element) element.node.style.color = '#ffffff';
      if (element) this.live.add(element);
      const group = args[0].value as JavaObject | null;
      this.states.set(object, { element, group: group?.fields instanceof Map ? group : undefined,
        x, y, viewport, align: 'left', scaleX: 1, scaleY: 1, fontSize, fadeGlyph, depth });
      return nil();
    });
    jvm.natives.register(owner, 'update', [], ({ receiver }) => {
      const state = this.state(receiver);
      state.element?.setText(state.fadeGlyph ? '' : String(this.object(receiver).fields.get('text')?.value ?? ''));
      return nil();
    });
    jvm.natives.register(owner, 'changeAlign', ['int'], ({ receiver, args }) => {
      const state = this.state(receiver);
      state.align = Number(args[0].value) === 1 ? 'center' : Number(args[0].value) === 0 ? 'right' : 'left';
      const node = state.element?.node;
      if (node) { node.classList.remove('osd-align-left', 'osd-align-center', 'osd-align-right'); node.classList.add(`osd-align-${state.align}`); }
      return nil();
    });
    jvm.natives.register(owner, 'changeColor', ['int'], ({ receiver, args }) => {
      const state = this.state(receiver);
      const node = state.element?.node;
      if (node) {
        const color = Number(args[0].value) >>> 0;
        const osd = state.group?.fields.get('osd')?.value as JavaObject | null | undefined;
        if (state.fadeGlyph && osd?.fields?.get('dark')?.value === receiver.value) {
          node.classList?.add('osd-fade-overlay');
          node.style.backgroundColor = '#000000';
        }
        node.style.color = `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
        node.style.opacity = String(color === 0xffffffff ? 1 : ((color >>> 24) & 0xff) / 255);
      }
      return nil();
    });
    jvm.natives.register(owner, 'setPos', ['float', 'float'], ({ receiver, args }) => {
      const state = this.state(receiver);
      state.x = Number(args[0].value); state.y = Number(args[1].value);
      const point = projectOsdBounds(state.viewport, state.x, state.y);
      state.element?.setBounds(point.x, point.y, 0, 0, state.depth);
      return nil();
    });
    jvm.natives.register(owner, 'getPos', [], ({ receiver }) => {
      const state = this.state(receiver);
      return jv('Vector3', { className: 'java.lang.Vector3', fields: new Map([
        ['x', jv('float', state.x)], ['y', jv('float', state.y)], ['z', jv('float', 0)],
      ]) });
    });
    jvm.natives.register(owner, 'setScale', ['float', 'float'], ({ receiver, args }) => {
      const state = this.state(receiver);
      state.scaleX = Number(args[0].value); state.scaleY = Number(args[1].value);
      if (state.element) state.element.node.style.fontSize = `${Math.max(1, state.fontSize * state.scaleY)}px`;
      return nil();
    });
  }

  private object(receiver: JavaValue): JavaObject {
    const object = receiver.value as JavaObject;
    if (!object || !(object.fields instanceof Map)) throw new Error('Text native requires a Java Text object');
    return object;
  }

  private state(receiver: JavaValue): TextState {
    const state = this.states.get(this.object(receiver));
    if (!state) throw new Error('Text.create must run before updating OSD text');
    return state;
  }

  dispose(): void {
    for (const element of this.live) element.node.remove();
    this.live.clear();
  }
}
