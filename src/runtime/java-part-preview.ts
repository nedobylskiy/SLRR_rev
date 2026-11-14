import type { JavaValue } from 'slrr-jvm';
import type { Assets } from '../assets';
import type { BootResult } from './game-boot';
import type { JavaInstalledPart, JavaStockSelection, ResourceKey } from '../engine/world';
import { previewScope } from './preview-scope';
import { RenderObject } from './render-object';

/** Enumerate Java-created inventory cameras containing a Part or a standalone render model. */
export function javaPartPreviewCameras(result: BootResult) {
  // Native cameras at the same viewport/priority replace one another. During an
  // async Java page update both handles can briefly remain alive.
  const views = [];
  const latest = new Map<object, Map<number, number>>();
  for (const [ref, camera] of result.cameras.entries()) {
    const render = result.gameTypes.getRender(ref), scope = render && previewScope(render);
    const viewport = result.viewports.get(camera.viewport);
    if (!render || !scope || !viewport?.active) continue;
    const part = [...scope.children].find(node => result.jvm.isInstance(result.gameTypes.reference(node), 'java.game.parts.Part'));
    const model = part ? undefined : [...scope.children].find(node => node instanceof RenderObject
      && node !== render && node.renderResource && node.renderType?.resourceType !== 13) as RenderObject | undefined;
    if (part || model) {
      let slots = latest.get(viewport);
      if (!slots) { slots = new Map(); latest.set(viewport, slots); }
      slots.set(camera.priority, views.length);
      views.push({ ref, camera, render, viewport, part, model });
    }
  }
  return views.filter((view, index) => latest.get(view.viewport)?.get(view.camera.priority) === index)
    .sort((a, b) => a.camera.priority - b.camera.priority);
}

export async function javaPartPreviewSelection(result: BootResult, assets: Assets, ref: JavaValue) {
  const native = result.gameTypes.getResource(ref);
  if (!native?.resourcePack) throw new Error('Preview part has no resource pack');
  const resolve = async (id: number, pack: string): Promise<ResourceKey> => {
    const identity = result.resolveResourceIdentity(id);
    if (identity) return identity;
    const location = await assets.resourceLocation(pack, id);
    return { pack: location.packPath, id: location.id };
  };
  const project = async (part: ReturnType<BootResult['parts']['installedTree']>[number]): Promise<JavaInstalledPart> => ({
    nativeId: part.node.resourceId, key: await resolve(part.node.typeId, part.node.resourcePack ?? native.resourcePack!),
    parentSlot: part.parentSlot, ownSlot: part.ownSlot, positions: part.positions, wear: part.wear,
    render: part.renderType ? await resolve(part.renderType, part.node.resourcePack ?? native.resourcePack!) : undefined,
    texture: part.texture?.value ? part.texture.resource ?? await resolve(Number(part.texture.value), part.node.resourcePack ?? native.resourcePack!) : undefined,
    children: await Promise.all(part.children.map(project)),
  });
  const render = result.parts.renderTypeFor(ref);
  const texture = result.parts.textureFor(ref);
  const selection: JavaStockSelection = {
    rootWear: result.parts.wearFor?.(ref), damage: result.parts.damageFor?.(ref), nativeId: native.resourceId, rootRender: render ? await resolve(render, native.resourcePack) : undefined,
    rootTexture: texture?.value ? texture.resource ?? await resolve(Number(texture.value), native.resourcePack) : undefined,
    body: [], mechanical: [], tyres: [], wheelRefs: [], rootPositions: result.parts.slotOverrides(ref),
    installed: await Promise.all(result.parts.installedTree(ref).map(project)),
  };
  return { key: await resolve(native.typeId, native.resourcePack), selection };
}
