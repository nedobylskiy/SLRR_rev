import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { Box3, Vector3 } from 'three';
import { Assets } from '../src/assets';
import { entryProperties } from '../src/formats/rpk';
import { PartFactory, poseMatrix } from '../src/engine/world';
import { slotMatrix } from '../src/engine/slot-frames';
import { modelMatrix } from '../src/engine/model-transform';
import { parseScx } from '../src/formats/scx';
import { DrivingDemo } from '../src/engine/driving-demo';
import { gameRoot, walk, relativeGamePath, safeGamePath } from './game-files';

const assets = new Assets((await walk(gameRoot)).map(file => ({ path: relativeGamePath(file), size: 0 })), async path => new Uint8Array(await readFile(await safeGamePath(path))));
const reports = [];
for (const name of ['Baiern', 'Einvagen', 'Duhen', 'Ninja', 'Zed']) {
  const pack = `cars/racers/${name}.rpk`, parsed = await assets.pack(pack);
  const entry = parsed.entries.find(e => entryProperties(e).some(p => p.key === 'native' && p.value.startsWith('car ')))!;
  const { world, root, warnings } = await new PartFactory(assets).stock({ pack, id: entry.typeId });
  const mounts = [];
  for (const slot of root.definition.config.slots.filter(s => s.type === 11 || (s.type !== undefined && s.type >= 101 && s.type < 200))) {
    const child = root.children.get(slot.id); assert.ok(child, `${name}: empty typed slot ${slot.id}`);
    const own = child.definition.config.slots.find(s => s.id === child.ownSlot)!;
    const expected = slotMatrix(root.definition.config, slot), actual = child.matrix().multiply(slotMatrix(child.definition.config, own));
    expected.elements.forEach((n, i) => assert.ok(Math.abs(n - actual.elements[i]) < 1e-10, `${name}: mount frame ${slot.id}`));
    const frame = slot.type === 11 ? root.definition.config.steering! : root.definition.config.wheels[slot.type! - 101];
    const expectedPoint = new Vector3(...slot.position).applyMatrix4(poseMatrix(frame));
    assert.ok(expectedPoint.distanceTo(new Vector3().setFromMatrixPosition(actual)) < 1e-10);
    const geometry = parseScx(await assets.read(child.definition.model!.path)), box = new Box3();
    const draw = modelMatrix(child.matrix(), child.definition.config.renderPose && poseMatrix(child.definition.config.renderPose));
    for (const mesh of geometry.meshes) for (let i = 0; i < mesh.positions.length; i += 3) box.expandByPoint(new Vector3().fromArray(mesh.positions, i).applyMatrix4(draw));
    if (slot.type !== 11) {
      const wheel = root.definition.config.wheels[slot.type! - 101];
      assert.ok(box.getCenter(new Vector3()).distanceTo(expectedPoint) < 0.03, `${name}: wheel mesh centre`);
      assert.ok(Math.abs(box.getSize(new Vector3()).y - 2 * wheel.radius!) < 0.04, `${name}: wheel geometry/radius scale`);
    } else assert.ok(box.getCenter(new Vector3()).distanceTo(expectedPoint) < 0.15, `${name}: steering geometry position`);
    mounts.push({ slot: slot.id, type: slot.type, resource: child.definition.key, position: new Vector3().setFromMatrixPosition(child.matrix()).toArray(), renderPose: child.definition.config.renderPose });
  }
  assert.equal(mounts.length, 5, `${name}: four wheels and steering`);
  const demo = new DrivingDemo(root);
  for (let i = 0; i < 120; i++) demo.advance(1 / 60, { throttle: 1, steer: 0, brake: false });
  for (let i = 0; i < 60; i++) demo.advance(1 / 60, { throttle: 1, steer: 0.4, brake: false });
  assert.ok(demo.speed > 8 && demo.position.z < -10 && demo.position.x < -0.1 && demo.yaw > 0);
  const driving = { wheelbase: demo.wheelbase, speed: demo.speed, position: demo.position.toArray(), yaw: demo.yaw }; demo.reset();
  reports.push({ name, root: root.definition.key, cfg: root.definition.cfgPath, parts: world.parts.size, warnings, mounts, driving }); world.dispose();
}
await mkdir('local', { recursive: true }); await writeFile('local/mounts-verification.json', JSON.stringify(reports, null, 2));
console.log(JSON.stringify(reports.map(r => ({ name: r.name, parts: r.parts, typedMounts: r.mounts.length, warnings: r.warnings })), null, 2));
