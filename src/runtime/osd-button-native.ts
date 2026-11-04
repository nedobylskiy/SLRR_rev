import { jv, type JavaObject, type JavaValue, type SlrrJvm } from 'slrr-jvm';
import type { OsdElement, OsdLayer } from '../osd/osd-layer';
import { FULL_OSD_VIEWPORT, osdDepth, projectOsdBounds, type OsdViewport } from './osd-depth';
import type { PhysicsRefNative } from './physics-ref-native';

interface HitBox { physics: JavaValue; group: JavaValue; width: number; height: number; label: string;
  position?: { x: number; y: number; z: number }; element?: OsdElement }

/** At equal Java depth, a small control wins over a broad dialog shield or ghost area. */
export function osdHitDepth(z: number, width: number, height: number): number {
  const plane = Math.round(z * 1000);
  const specificity = Math.round(99 / (1 + Math.abs(width * height)));
  return plane * 100 + specificity;
}

/** Maps OSD PhysicsRef hit boxes to HTML controls and dispatches clicks back into Java. */
export class OsdButtonNative {
  private readonly boxes = new WeakMap<JavaObject, HitBox>();
  private readonly live = new Set<OsdElement>();
  private readonly activeBoxes = new Set<HitBox>();
  private worldPhysics?: PhysicsRefNative;
  private cursorEvent?: (code: number, physics: JavaValue) => void;
  private focusTimer?: ReturnType<typeof setInterval>;
  private focused?: JavaObject;
  private focusBusy = false;

  setCursorEvents(dispatch: (code: number, physics: JavaValue) => void): void { this.cursorEvent = dispatch; }
  private clearFocus(): void { clearInterval(this.focusTimer); this.focusTimer = undefined; this.focused = undefined; }

  setWorldPhysics(physics: PhysicsRefNative): void { this.worldPhysics = physics; }

  constructor(private readonly jvm: SlrrJvm,
    private readonly layer?: Pick<OsdLayer, 'createHitTarget'>,
    private readonly report: (error: Error) => void = () => {},
    private readonly viewportLayout: (group: JavaValue) => OsdViewport = () => FULL_OSD_VIEWPORT,
    private readonly stageAspect: () => number = () => 16 / 9) {
    const owner = 'java.util.resource.PhysicsRef';
    const nil = () => jv('void', undefined);
    jvm.natives.register(owner, 'createBox', ['ResourceRef', 'float', 'float', 'float', 'String'], ({ receiver, args }) => {
      const group = args[0];
      if (this.object(group)?.className !== 'java.render.Group') {
        if (!this.worldPhysics) throw new Error('PhysicsRef world backend is not connected');
        return this.worldPhysics.createBox(receiver, args);
      }
      const box = {
        physics: receiver, group, width: Number(args[1].value), height: Number(args[2].value), label: String(args[4].value ?? ''),
      };
      if (!this.worldPhysics) throw new Error('PhysicsRef OSD backend is not connected');
      this.worldPhysics.createReference(receiver, group, box.label);
      this.boxes.set(this.requireObject(receiver), box);
      this.activeBoxes.add(box);
      return nil();
    });
    jvm.natives.register(owner, 'setMatrix', ['Vector3', 'Ypr'], ({ receiver, args }) => {
      const physics = this.requireObject(receiver), box = this.boxes.get(physics);
      if (!box) {
        if (!this.worldPhysics) throw new Error('PhysicsRef world backend is not connected');
        return this.worldPhysics.setMatrix(receiver, args[0], args[1]);
      }
      const position = this.requireObject(args[0]);
      box.position = {
        x: Number(position.fields.get('x')?.value ?? 0),
        y: Number(position.fields.get('y')?.value ?? 0),
        z: Number(position.fields.get('z')?.value ?? 0),
      };
      const osd = this.object(box.group)?.fields.get('osd');
      const osdFields = this.object(osd)?.fields;
      const aspect = Number(osdFields?.get('vpAspect')?.value ?? 1);
      const viewportWidth = Number(osdFields?.get('vpWidth')?.value ?? 1);
      const viewportHeight = Number(osdFields?.get('vpHeight')?.value ?? 1);
      const scaleX = 1.469 * aspect * viewportWidth;
      const scaleY = 1.469 * viewportHeight;
      const x = Number(position.fields.get('x')?.value ?? 0) / scaleX;
      const y = -Number(position.fields.get('y')?.value ?? 0) / scaleY;
      const viewport = this.viewportLayout(box.group);
      const projected = projectOsdBounds(viewport, x, y);
      const width = box.width / (1.469 * this.stageAspect());
      const height = box.height / 1.469;
      const depth = osdDepth(viewport.priority,
        osdHitDepth(Number(position.fields.get('z')?.value ?? 0), width, height));
      if (box.element) box.element.setBounds(projected.x, projected.y, width, height, depth);
      else {
        box.element = this.layer?.createHitTarget(box.label, projected.x, projected.y, width, height, depth,
          () => { void this.activate(receiver).catch(this.report); },
          () => { void this.hover(receiver).catch(this.report); },
          () => { void this.leave(receiver).catch(this.report); });
        if (box.element) { this.live.add(box.element); this.sync(); }
      }
      return nil();
    });
    jvm.natives.register(owner, 'getPos', [], ({ receiver }) => {
      const position = this.boxes.get(this.requireObject(receiver))?.position;
      if (!position) {
        if (!this.worldPhysics) throw new Error('PhysicsRef.getPos requires a positioned OSD hit box');
        return this.worldPhysics.getPos(receiver);
      }
      return jv('Vector3', { className: 'java.lang.Vector3', fields: new Map(Object.entries(position)
        .map(([axis, value]) => [axis, jv('float', value)])) });
    });
  }

  /** Resolve the top HTML hit target even while the viewport owns pointer capture. */
  physicsAt(x: number, y: number): JavaValue | undefined {
    const element = document.elementFromPoint(x, y);
    if (!element) return;
    for (const box of this.activeBoxes)
      if (box.element && this.visible(box) && box.element.node.contains(element)) return box.physics;
  }

  /** Use the original Button.drop overloads and its Java command handler. */
  async dropOn(target: JavaValue, source: { physics: JavaValue } | { object: JavaValue }): Promise<boolean> {
    const box = this.boxes.get(this.requireObject(target));
    if (!box || !this.visible(box)) return false;
    const gadget = await this.findGadget(box, target);
    if (!gadget || Number(gadget.fields.get('disabled')?.value ?? 0) || !Number(gadget.fields.get('dropEnabled')?.value ?? 0)) return false;
    let dropped: JavaValue;
    if ('physics' in source) {
      if (source.physics.value === target.value) return false;
      const origin = this.boxes.get(this.requireObject(source.physics));
      if (!origin || !this.visible(origin)) return false;
      const sourceGadget = await this.findGadget(origin, source.physics);
      if (!sourceGadget || Number(sourceGadget.fields.get('disabled')?.value ?? 0)) return false;
      dropped = jv('Gadget', sourceGadget);
    } else dropped = source.object;
    await this.jvm.invokeAsync(jv(gadget.className, gadget), 'drop', [dropped]);
    return true;
  }

  async activate(physics: JavaValue): Promise<void> {
    const box = this.boxes.get(this.requireObject(physics));
    if (!box) return;
    if (!this.visible(box)) return;
    const gadget = await this.findGadget(box, physics);
    if (!gadget || Number(gadget.fields.get('disabled')?.value ?? 0)) return;
    const osd = this.object(this.requireObject(box.group).fields.get('osd'));
    const active = this.object(osd?.fields.get('actGadget'));
    // Publish the active editor before dispatching a different gadget's command.
    // Do not send its submit command: that would also wake a modal dialog's wait.
    if (osd && active && active !== gadget && this.jvm.isInstance(jv('Gadget', active), 'java.render.osd.StringInput'))
      this.jvm.set(jv('Osd', osd), 'stringValue', active.fields.get('inputString') ?? jv('String', ''));
    await this.jvm.invokeAsync(jv(gadget.className.split('.').at(-1)!, gadget), 'click');
  }

  async hover(physics: JavaValue): Promise<void> {
    const box = this.boxes.get(this.requireObject(physics));
    if (!box || !this.visible(box)) return;
    const gadget = await this.findGadget(box, physics);
    if (!gadget || Number(gadget.fields.get('disabled')?.value ?? 0) || Number(gadget.fields.get('nofocus')?.value ?? 0)) return;
    const group = this.requireObject(box.group);
    const osd = this.object(group.fields.get('osd'));
    if (!osd || osd.fields.get('pointedGadget')?.value === gadget) return;
    if (osd.fields.get('pointedGadget')?.value)
      await this.jvm.invokeAsync(jv('Osd', osd), 'deactivateText');
    await this.jvm.invokeAsync(jv('Osd', osd), 'activateText', [jv('Group', group), jv('Gadget', gadget)]);
    this.cursorEvent?.(15, physics);
    this.clearFocus();
    const panel = this.object(osd.fields.get('globalHandler'));
    if (panel && this.jvm.isInstance(jv(panel.className, panel), 'java.game.InventoryPanel')) {
      const inventory = this.object(panel.fields.get('inv'));
      // Mechanic/Painter own their spinner thread. A standalone catalog panel
      // has no caller; drive its existing Java focusHook while HTML has focus.
      if (!inventory?.fields.get('caller')?.value) {
        this.focused = panel;
        this.focusTimer = setInterval(() => {
          if (this.focused !== panel || !this.visible(box)) { this.clearFocus(); return; }
          if (this.focusBusy) return;
          this.focusBusy = true;
          void this.jvm.invokeAsync(jv(panel.className, panel), 'focusHook')
            .catch(this.report).finally(() => { this.focusBusy = false; });
        }, 20);
      }
    }
  }

  async leave(physics: JavaValue): Promise<void> {
    this.clearFocus(); this.cursorEvent?.(16, physics);
    const box = this.boxes.get(this.requireObject(physics));
    if (!box) return;
    const gadget = await this.findGadget(box, physics);
    const osd = this.object(this.requireObject(box.group).fields.get('osd'));
    if (gadget && osd?.fields.get('pointedGadget')?.value === gadget)
      await this.jvm.invokeAsync(jv('Osd', osd), 'deactivateText');
  }

  private async findGadget(box: HitBox, physics: JavaValue): Promise<JavaObject | undefined> {
    const group = this.requireObject(box.group);
    const gadgetVector = group.fields.get('gadget');
    if (!gadgetVector) return undefined;
    const count = Number((await this.jvm.invokeAsync(gadgetVector, 'size')).value);
    for (let index = count - 1; index >= 0; index--) {
      const gadget = await this.jvm.invokeAsync(gadgetVector, 'elementAt', [jv('int', index)]);
      const object = this.object(gadget);
      if (!object || object.fields.get('phy')?.value !== physics.value) continue;
      return object;
    }
    return undefined;
  }

  sync(): void {
    for (const box of this.activeBoxes) {
      if (this.visible(box)) box.element?.show();
      else box.element?.hide();
    }
  }

  private visible(box: HitBox): boolean {
    const group = this.requireObject(box.group);
    const osd = this.object(group.fields.get('osd'));
    return Boolean(Number(group.fields.get('active')?.value ?? 0) && osd?.fields.get('cam')?.value != null);
  }

  private object(value: JavaValue | undefined): JavaObject | undefined {
    let object: unknown = value?.value;
    for (let depth = 0; depth < 3; depth++) {
      if (object && typeof object === 'object' && 'fields' in object && object.fields instanceof Map)
        return object as JavaObject;
      if (!object || typeof object !== 'object' || !('value' in object)) return undefined;
      object = object.value;
    }
    return undefined;
  }

  private requireObject(value: JavaValue): JavaObject {
    const object = this.object(value);
    if (!object) throw new Error(`OSD hit target requires a Java object: ${value.type}`);
    return object;
  }

  dispose(): void {
    this.clearFocus();
    for (const element of this.live) element.node.remove();
    this.live.clear();
    this.activeBoxes.clear();
  }
}
