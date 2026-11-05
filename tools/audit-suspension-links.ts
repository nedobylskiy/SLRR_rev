import { readFile } from 'node:fs/promises';
import { Box3, Vector3 } from 'three';
import { Assets } from '../src/assets';
import { PartFactory } from '../src/engine/world';
import { linkedMountGroup, selectLinkedRule } from '../src/engine/linked-slots';
import { linkedRenderPose } from '../src/engine/linked-render';
import { linkedSuspensionAnchors } from '../src/engine/linked-suspension';
import { parseScx } from '../src/formats/scx';
import { gameRoot, walk, relativeGamePath } from './game-files';

const assets = new Assets((await walk(gameRoot)).map(path => ({ path: relativeGamePath(path), size: 0 })), path => readFile(`${gameRoot}/${path}`));
const factory = new PartFactory(assets);
let single = 0, dual = 0, springDamper = 0, missing = 0;
for (const [pack, id] of [['cars/racers/einvagen.rpk', 6], ['cars/racers/baiern.rpk', 6]] as const) {
  const { world, root } = await factory.stock({ pack, id }, { mechanical: true, suspensionMountOffsetY: 0, suspensionMountOffsets: [] });
  try {
    for (const part of world.parts.values()) if (part.definition.mechanics?.kind === 'spring' || part.definition.mechanics?.kind === 'shock') {
      const anchors = linkedSuspensionAnchors(root, part);
      if (!anchors) missing++; else springDamper++;
      console.log(JSON.stringify({ pack, part: part.definition.alias, springDamper: true, resolved: !!anchors,
        span: anchors && +anchors.lower.distanceTo(anchors.upper).toFixed(5) }));
    }
    for (const part of world.parts.values()) for (const extra of part.definition.additionalModels ?? []) {
      const links = selectLinkedRule(part, extra.linkRules ?? (extra.links ? [extra.links] : []));
      if (!links) continue;
      const bounds = new Box3();
      for (const mesh of parseScx(await assets.read(extra.model.path)).meshes)
        for (let i = 0; i < mesh.positions.length; i += 3) bounds.expandByPoint(new Vector3().fromArray(mesh.positions, i).multiplyScalar(0.01));
      const pose = linkedRenderPose(part, links, bounds);
      if (!pose) missing++; else if (links[1]) dual++; else single++;
      console.log(JSON.stringify({ pack, part: part.definition.alias, model: extra.model.path, mount: part.parentSlot,
        ownSlot: part.ownSlot, group: linkedMountGroup(part), links, resolved: !!pose,
        anchorLocal: pose && new Vector3().setFromMatrixPosition(pose).toArray().map(value => +value.toFixed(5)) }));
    }
  } finally { world.dispose(); }
}
console.log(JSON.stringify({ single, dual, springDamper, missing }));
if (missing || !single || !dual) process.exitCode = 1;
