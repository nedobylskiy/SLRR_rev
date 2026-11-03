import { Box3, Vector3 } from 'three';
import type { Assets } from '../assets';
import { normalizePath } from '../assets';
import { parsePartConfig, secondaryRenders } from '../formats/cfg';
import { parseScx } from '../formats/scx';
import { poseMatrix } from '../engine/transforms';
import type { GameTypeNative } from './game-type-native';
import type { JavaValue } from 'slrr-jvm';

/** Cache local visual bounds in metres, never the catalog's mesh buffers. */
export function resourceBoundsReader(assets: Assets, resources: () => GameTypeNative) {
  const sizes = new Map<string, Promise<Box3 | null>>();
  return async (receiver: JavaValue): Promise<Box3 | null> => {
    const node = resources().getResource(receiver);
    if (!node?.resourcePack) return null;
    const pack = node.resourcePack;
    const cfgPath = resources().catalogResource(pack, node.typeId)?.cfgPath;
    if (!cfgPath) return null;
    const key = `${pack}|${cfgPath}`;
    let pending = sizes.get(key);
    if (!pending) {
      pending = (async () => {
        const cfg = parsePartConfig(new TextDecoder('windows-1252').decode(await assets.read(cfgPath)));
        if (cfg.render === undefined) return null;
        const bounds = new Box3(), point = new Vector3();
        for (const render of [{ resource: cfg.render, pose: cfg.renderPose }, ...secondaryRenders(cfg)]) {
          const source = await assets.modelForResource(pack, render.resource);
          const model = parseScx(await assets.read(normalizePath(source.path)));
          const transform = render.pose && poseMatrix(render.pose);
          for (const mesh of model.meshes) for (let i = 0; i < mesh.positions.length; i += 3) {
            point.fromArray(mesh.positions, i).multiplyScalar(0.01);
            if (transform) point.applyMatrix4(transform);
            bounds.expandByPoint(point);
          }
        }
        return bounds.isEmpty() ? null : bounds;
      })();
      sizes.set(key, pending);
      void pending.catch(() => sizes.delete(key));
    }
    return (await pending)?.clone() ?? null;
  };
}

/** Native GII_SIZE uses the longest visual extent in centimetres. */
export function resourceSizeReader(assets: Assets, resources: () => GameTypeNative,
  bounds = resourceBoundsReader(assets, resources)) {
  return async (receiver: JavaValue): Promise<number> => {
    const box = await bounds(receiver);
    if (!box) return 100; // Original native's 1 m fallback without visual data.
    const size = box.getSize(new Vector3());
    return Math.max(1, Math.min(10000, Math.round(Math.max(size.x, size.y, size.z) * 100)));
  };
}
