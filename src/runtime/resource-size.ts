import { Box3, Vector3 } from 'three';
import type { Assets } from '../assets';
import { normalizePath } from '../assets';
import { parsePartConfig, secondaryRenders } from '../formats/cfg';
import { parseScx } from '../formats/scx';
import { poseMatrix } from '../engine/transforms';
import type { GameTypeNative } from './game-type-native';
import type { JavaValue } from 'slrr-jvm';

/** Lazy preview query: retain only scalar sizes, never all catalog mesh buffers. */
export function resourceSizeReader(assets: Assets, resources: () => GameTypeNative) {
  const sizes = new Map<string, Promise<number>>();
  return async (receiver: JavaValue): Promise<number> => {
    const node = resources().getResource(receiver);
    if (!node?.resourcePack) return 100;
    const pack = node.resourcePack;
    const cfgPath = resources().catalogResource(pack, node.typeId)?.cfgPath;
    if (!cfgPath) return 100; // No visual definition: original native's 1 m fallback.
    const key = `${pack}|${cfgPath}`;
    let pending = sizes.get(key);
    if (!pending) {
      pending = (async () => {
        const cfg = parsePartConfig(new TextDecoder('windows-1252').decode(await assets.read(cfgPath)));
        if (cfg.render === undefined) return 100;
        const bounds = new Box3(), point = new Vector3();
        for (const render of [{ resource: cfg.render, pose: cfg.renderPose }, ...secondaryRenders(cfg)]) {
          const source = await assets.modelForResource(pack, render.resource);
          const model = parseScx(await assets.read(normalizePath(source.path)));
          const transform = render.pose && poseMatrix(render.pose);
          for (const mesh of model.meshes) for (let i = 0; i < mesh.positions.length; i += 3) {
            point.fromArray(mesh.positions, i);
            if (transform) point.multiplyScalar(0.01).applyMatrix4(transform).multiplyScalar(100);
            bounds.expandByPoint(point);
          }
        }
        if (bounds.isEmpty()) return 100;
        const size = bounds.getSize(point);
        return Math.max(1, Math.min(10000, Math.round(Math.max(size.x, size.y, size.z))));
      })();
      sizes.set(key, pending);
      void pending.catch(() => sizes.delete(key));
    }
    return pending;
  };
}
