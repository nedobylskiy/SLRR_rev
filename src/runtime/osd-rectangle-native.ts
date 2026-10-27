import type { JavaObject, JavaValue, ResourceIdentity } from 'slrr-jvm';
import type { OsdElement, OsdLayer } from '../osd/osd-layer';
import type { GameTypeNative } from './game-type-native';
import type { RenderObject } from './render-object';

interface RectangleView { render: RenderObject; group: JavaObject; element: OsdElement }

/** Projects Java Rectangle RenderRefs into the HTML OSD instead of the 3D scene. */
export class OsdRectangleNative {
  private readonly views = new Map<RenderObject, RectangleView>();

  constructor(private readonly resources: GameTypeNative,
    private readonly layer?: Pick<OsdLayer, 'createRectangle'>,
    private readonly resourceIdentity?: (id: number) => ResourceIdentity | null | undefined) {}

  sync(render: RenderObject): boolean {
    if (render.alias !== 'Rectangle' || render.parent?.className !== 'java.render.Group') return false;
    if (!this.layer) return true;
    const group = this.object(this.resources.reference(render.parent));
    const osd = this.object(group?.fields.get('osd'));
    const type = render.renderType;
    if (!group || !osd || !type) return true;
    const texture = [...type.resourceReplacements]
      .map(([slot, id]) => {
        const pack = type.resourceReplacementPacks.get(slot);
        return pack ? { pack, id: id & 0xffff } : this.resourceIdentity?.(id);
      }).find((identity): identity is ResourceIdentity => Boolean(identity));
    const mesh = [...type.resourceReplacements.values()]
      .map(id => this.resources.getByResourceId(id)).find(resource => resource?.copiedFromResourceId != null);
    if (!texture || !mesh) return true;
    const aspect = Number(osd.fields.get('vpAspect')?.value ?? 1);
    const vpWidth = Number(osd.fields.get('vpWidth')?.value ?? 1);
    const vpHeight = Number(osd.fields.get('vpHeight')?.value ?? 1);
    const scaleX = 1.469 * aspect * vpWidth;
    const scaleY = 1.469 * vpHeight;
    const width = mesh.meshScale.x / (1.47 * aspect * vpWidth);
    const height = mesh.meshScale.y / (1.47 * vpHeight);
    const normalizedPosition = this.normalizedPosition(render, osd);
    const x = normalizedPosition ? render.position.x / aspect : render.position.x / scaleX;
    const y = -render.position.y / scaleY;
    const depth = Math.round(render.position.z * 1000);
    if (![x, y, width, height, depth].every(Number.isFinite)) return true;
    let view = this.views.get(render);
    if (!view) {
      const element = this.layer.createRectangle(x, y, width, height, depth,
        { pack: texture.pack.endsWith('.rpk') ? texture.pack : `${texture.pack}.rpk`, id: texture.id });
      view = { render, group, element };
      this.views.set(render, view);
    } else view.element.setBounds(x, y, width, height, depth);
    this.syncView(view);
    return true;
  }

  syncVisibility(): void { for (const view of this.views.values()) this.sync(view.render); }

  remove(render: RenderObject): void {
    const view = this.views.get(render);
    view?.element.node.remove();
    this.views.delete(render);
  }

  dispose(): void {
    for (const render of this.views.keys()) this.remove(render);
  }

  private syncView(view: RectangleView): void {
    const osd = this.object(view.group.fields.get('osd'));
    if (Number(view.group.fields.get('active')?.value ?? 0) && osd?.fields.get('cam')?.value != null)
      view.element.show();
    else view.element.hide();
  }

  private normalizedPosition(render: RenderObject, osd: JavaObject): boolean {
    const vector = this.object(osd.fields.get('rectangles'));
    const data = vector?.fields.get('elementData')?.value;
    const count = Number(vector?.fields.get('elementCount')?.value ?? 0);
    if (!Array.isArray(data)) return false;
    for (const value of data.slice(0, count) as JavaValue[]) {
      const rectangle = this.object(value);
      if (!rectangle) continue;
      const instance = rectangle.fields.get('ins');
      if (instance && this.resources.getRender(instance) === render)
        return rectangle.fields.get('rev_pos')?.value != null;
    }
    return false;
  }

  private object(value: JavaValue | undefined): JavaObject | undefined {
    const object = value?.value;
    return object && typeof object === 'object' && 'fields' in object && object.fields instanceof Map
      ? object as JavaObject : undefined;
  }
}
