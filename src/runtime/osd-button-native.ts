import { jv, type JavaObject, type JavaValue, type SlrrJvm } from 'slrr-jvm';
import type { OsdElement, OsdLayer } from '../osd/osd-layer';

interface HitBox { group: JavaValue; width: number; height: number; label: string; element?: OsdElement }

/** Maps OSD PhysicsRef hit boxes to HTML controls and dispatches clicks back into Java. */
export class OsdButtonNative {
  private readonly boxes = new WeakMap<JavaObject, HitBox>();
  private readonly live = new Set<OsdElement>();
  private readonly activeBoxes = new Set<HitBox>();

  constructor(private readonly jvm: SlrrJvm,
    private readonly layer?: Pick<OsdLayer, 'createHitTarget'>,
    private readonly report: (error: Error) => void = () => {}) {
    const owner = 'java.util.resource.PhysicsRef';
    const nil = () => jv('void', undefined);
    jvm.natives.register(owner, 'createBox', ['ResourceRef', 'float', 'float', 'float', 'String'], ({ receiver, args }) => {
      const group = args[0];
      if (this.object(group)?.className !== 'java.render.Group')
        throw new Error('PhysicsRef.createBox currently supports OSD groups only');
      const box = {
        group, width: Number(args[1].value), height: Number(args[2].value), label: String(args[4].value ?? ''),
      };
      this.boxes.set(this.requireObject(receiver), box);
      this.activeBoxes.add(box);
      return nil();
    });
    jvm.natives.register(owner, 'setMatrix', ['Vector3', 'Ypr'], ({ receiver, args }) => {
      const physics = this.requireObject(receiver), box = this.boxes.get(physics);
      if (!box) throw new Error('PhysicsRef.setMatrix requires an OSD hit box');
      const position = this.requireObject(args[0]);
      const osd = this.object(box.group)?.fields.get('osd');
      const osdFields = this.object(osd)?.fields;
      const aspect = Number(osdFields?.get('vpAspect')?.value ?? 1);
      const viewportWidth = Number(osdFields?.get('vpWidth')?.value ?? 1);
      const viewportHeight = Number(osdFields?.get('vpHeight')?.value ?? 1);
      const scaleX = 1.469 * aspect * viewportWidth;
      const scaleY = 1.469 * viewportHeight;
      const x = Number(position.fields.get('x')?.value ?? 0) / scaleX;
      const y = -Number(position.fields.get('y')?.value ?? 0) / scaleY;
      if (box.element) box.element.setBounds(x, y, box.width / scaleX, box.height / scaleY, 3);
      else {
        box.element = this.layer?.createHitTarget(box.label, x, y, box.width / scaleX, box.height / scaleY, 3,
          () => { void this.activate(receiver).catch(this.report); });
        if (box.element) { this.live.add(box.element); this.sync(); }
      }
      return nil();
    });
  }

  async activate(physics: JavaValue): Promise<void> {
    const box = this.boxes.get(this.requireObject(physics));
    if (!box) return;
    const group = this.requireObject(box.group);
    if (!this.visible(box)) return;
    const gadgetVector = group.fields.get('gadget');
    if (!gadgetVector) return;
    const count = Number((await this.jvm.invokeAsync(gadgetVector, 'size')).value);
    for (let index = count - 1; index >= 0; index--) {
      const gadget = await this.jvm.invokeAsync(gadgetVector, 'elementAt', [jv('int', index)]);
      const object = this.object(gadget);
      if (!object || object.fields.get('phy')?.value !== physics.value) continue;
      if (Number(object.fields.get('disabled')?.value ?? 0)) return;
      await this.jvm.invokeAsync(jv(object.className.split('.').at(-1)!, object), 'click');
      return;
    }
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
    for (const element of this.live) element.node.remove();
    this.live.clear();
    this.activeBoxes.clear();
  }
}
