import type { JavaValue } from 'slrr-jvm';
import type { Assets } from '../assets';
import type { BootResult } from './game-boot';
import type { JavaInstalledPart, JavaStockSelection, ResourceKey } from '../engine/world';
import { previewScope } from './preview-scope';

/** Enumerate only Java-created cameras whose isolated world contains a Part. */
export function javaPartPreviewCameras(result: BootResult) {
  const views = [];
  for (const [ref, camera] of result.cameras.entries()) {
    const render = result.gameTypes.getRender(ref), scope = render && previewScope(render);
    const viewport = result.viewports.get(camera.viewport);
    if (!render || !scope || !viewport?.active) continue;
    const part = [...scope.children].find(node => result.jvm.isInstance(result.gameTypes.reference(node), 'java.game.parts.Part'));
    if (part) views.push({ ref, camera, render, viewport, part });
  }
  return views;
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
    children: await Promise.all(part.children.map(project)),
  });
  const render = result.parts.renderTypeFor(ref);
  const selection: JavaStockSelection = {
    nativeId: native.resourceId, rootRender: render ? await resolve(render, native.resourcePack) : undefined,
    body: [], mechanical: [], tyres: [], wheelRefs: [], rootPositions: result.parts.slotOverrides(ref),
    installed: await Promise.all(result.parts.installedTree(ref).map(project)),
  };
  return { key: await resolve(native.typeId, native.resourcePack), selection };
}
