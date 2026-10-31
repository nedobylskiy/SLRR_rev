import { jv, type JavaObject, type JavaValue, type SlrrJvm } from 'slrr-jvm';
import type { OsdAlign, OsdElement, OsdLayer } from '../osd/osd-layer';
import { FULL_OSD_VIEWPORT, osdDepth, projectOsdBounds, type OsdViewport } from './osd-depth';

interface TextState { object: JavaObject; element?: OsdElement; group?: JavaObject; x: number; y: number; viewport: OsdViewport; align: OsdAlign; scaleX: number; scaleY: number; fontSize: number; fadeGlyph: boolean; depth: number; labelAdjusted: boolean }

/** Native Text operations; the original Java constructors and changeText logic still execute. */
export class OsdTextNative {
  private readonly states = new WeakMap<JavaObject, TextState>();
  private readonly renderStates = new WeakMap<JavaObject, TextState>();
  private readonly activeStates = new Set<TextState>();
  private readonly live = new Set<OsdElement>();
  private measureContext?: CanvasRenderingContext2D | null;

  constructor(private readonly jvm: SlrrJvm, private readonly layer?: Pick<OsdLayer, 'createText'>,
    private readonly viewportLayout: (group: JavaValue) => OsdViewport = () => FULL_OSD_VIEWPORT) {
    const owner = 'java.render.Text';
    const nil = () => jv('void', undefined);
    jvm.natives.register(owner, 'getWidthPixels', ['String', 'ResourceRef'], ({ args }) => {
      const value = args[0].value == null ? '' : String(args[0].value);
      const fontId = Number(jvm.natives.invoke('java.util.resource.ResourceRef', 'id', args[1], [])?.value ?? 0) & 0xffff;
      return jv('float', this.widthPixels(value, this.fontSize(fontId)));
    });
    jvm.natives.register(owner, 'create', ['ResourceRef', 'ResourceRef', 'float', 'float'], ({ receiver, args }) => {
      const object = this.object(receiver);
      const x = Number(args[2].value), y = Number(args[3].value);
      const fontId = Number(jvm.natives.invoke('java.util.resource.ResourceRef', 'id', args[1], [])?.value ?? 0) & 0xffff;
      const fadeGlyph = fontId === 0x1a25 || fontId === 0x1a26;
      const fontSize = this.fontSize(fontId);
      const viewport = this.viewportLayout(args[0]);
      const depth = osdDepth(viewport.priority, 2);
      const point = projectOsdBounds(viewport, x, y);
      const element = this.layer?.createText('', 'left', point.x, point.y, depth);
      if (element) element.node.style.fontSize = `${fontSize}px`;
      if (element) element.node.style.color = '#ffffff';
      if (element) this.live.add(element);
      const group = args[0].value as JavaObject | null;
      const state = { object, element, group: group?.fields instanceof Map ? group : undefined,
        x, y, viewport, align: 'left' as OsdAlign, scaleX: 1, scaleY: 1, fontSize, fadeGlyph, depth,
        labelAdjusted: false };
      this.states.set(object, state);
      const renderinst = object.fields.get('renderinst')?.value as JavaObject | null | undefined;
      if (renderinst?.fields instanceof Map) this.renderStates.set(renderinst, state);
      this.activeStates.add(state);
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
      this.setPosition(state, Number(args[0].value), Number(args[1].value));
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

  private fontSize(fontId: number): number {
    if ([0x139, 0xc02a, 0xc02d, 0xc12a].includes(fontId)) return 15;
    if ([0x25, 0xc02b, 0xc02c, 0xc12b, 0xc02e, 0xc02f].includes(fontId)) return 24;
    if (fontId === 0x138 || fontId === 0x23 || fontId === 0xc03b) return 10;
    if (fontId === 0xb2) return 7;
    if (fontId === 0x22) return 40;
    if (fontId === 0x20) return 20;
    if (fontId === 0x8c) return 14;
    if (fontId === 0x2e) return 28;
    return 20;
  }

  private widthPixels(value: string, fontSize: number): number {
    if (!value) return 0;
    if (this.measureContext === undefined)
      this.measureContext = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
    if (this.measureContext) {
      this.measureContext.font = `600 ${fontSize}px Arial`;
      return this.measureContext.measureText(value).width;
    }
    // The headless verifier has no canvas; use a stable width until a browser renders the text.
    return [...value].reduce((sum, glyph) => sum + fontSize * (/\s/.test(glyph) ? 0.33 : /[il.,:;!|]/.test(glyph) ? 0.28 : 0.58), 0);
  }

  /** Text.renderinst is a native handle for the text glyph, not a standalone scene render. */
  setRenderMatrix(receiver: JavaValue, position: { x: number; y: number; z: number }): boolean {
    const object = receiver.value as JavaObject | null;
    if (!object || !(object.fields instanceof Map)) return false;
    const state = this.renderStates.get(object);
    if (!state) return false;
    this.setPosition(state, position.x, position.y);
    return true;
  }

  private setPosition(state: TextState, x: number, y: number): void {
    state.x = x; state.y = y;
    const point = projectOsdBounds(state.viewport, x, y);
    state.element?.setBounds(point.x, point.y, 0, 0, state.depth);
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

  syncVisibility(): void {
    for (const state of this.activeStates) {
      if (!state.element) continue;
      const osd = state.group?.fields.get('osd')?.value as JavaObject | null | undefined;
      if (osd?.fields instanceof Map) {
        const active = Number(state.group?.fields.get('active')?.value ?? 1);
        if (active && osd.fields.get('cam')?.value != null) state.element.show();
        else state.element.hide();
      }
      if (!state.labelAdjusted && this.isImageButtonLabel(state)) {
        state.element.node.classList?.add('osd-image-button-label');
        state.labelAdjusted = true;
      }
    }
  }

  private isImageButtonLabel(state: TextState): boolean {
    const vector = state.group?.fields.get('gadget')?.value as JavaObject | null | undefined;
    const data = vector?.fields?.get('elementData')?.value;
    const count = Number(vector?.fields?.get('elementCount')?.value ?? 0);
    if (!Array.isArray(data)) return false;
    for (const value of data.slice(0, count) as JavaValue[]) {
      const gadget = value?.value as JavaObject | null;
      const label = gadget?.fields?.get('label')?.value as JavaObject | null | undefined;
      if (gadget?.fields?.get('rect')?.value != null && label?.fields?.get('txt')?.value === state.object)
        return true;
    }
    return false;
  }

  dispose(): void {
    for (const element of this.live) element.node.remove();
    this.live.clear();
    this.activeStates.clear();
  }
}
