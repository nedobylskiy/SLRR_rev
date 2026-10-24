import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Assets } from '../src/assets';
import { PartFactory } from '../src/engine/world';
import { MechanicalSystem } from '../src/engine/mechanical-system';
import { parseScx } from '../src/formats/scx';
import { Vector3 } from 'three';
import { gameRoot, walk, relativeGamePath, safeGamePath } from './game-files';

const assets = new Assets((await walk(gameRoot)).map(path => ({ path: relativeGamePath(path), size: 0 })), async path => new Uint8Array(await readFile(await safeGamePath(path))));
const built = await new PartFactory(assets).stock({ pack: 'cars/racers/Baiern.rpk', id: 6 }, { mechanical: true });
try {
  assert.deepEqual(built.warnings, []);
  assert.equal(built.world.parts.size, 72);
  const mechanics = new MechanicalSystem(built.root);
  for (const [index, corner] of mechanics.corners.entries()) {
    const wheelX = built.root.definition.config.wheels[index].position[0];
    for (const part of [corner.strut, corner.spring, corner.shock, corner.brake]) {
      assert.ok(part, `corner ${index} is complete`);
      const x = new Vector3().setFromMatrixPosition(part.matrix()).x;
      assert.ok(Math.abs(x - wheelX) < 0.25, `${part.definition.cfgPath} must mount beside wheel ${index}`);
    }
    assert.match(corner.brake!.definition.model?.path ?? '', new RegExp(`disc_brake_${['FL', 'FR', 'RL', 'RR'][index]}\\.scx$`, 'i'));
    const wheel = built.root.children.get(101 + index)!;
    assert.ok(Math.abs(new Vector3().setFromMatrixPosition(wheel.matrix()).x - wheelX - built.root.slotPositions.get(101 + index)![0]) < 1e-10);
    const shock = corner.shock!, spring = corner.spring!, model = parseScx(await assets.read(shock.definition.model!.path));
    const topY = Math.max(...model.meshes.flatMap(mesh => Array.from(mesh.positions).filter((_, i) => i % 3 === 1))) * 0.01;
    const shockTop = new Vector3(0, topY, 0).applyMatrix4(shock.renderAdjustment).applyMatrix4(shock.matrix());
    const springTop = new Vector3().setFromMatrixPosition(spring.matrix());
    assert.ok(Math.hypot(shockTop.x - springTop.x, shockTop.z - springTop.z) < 0.04, `shock ${index} meets its spring at the upper mount`);
  }
  assert.equal(mechanics.engine.length, 20);
  assert.ok(Math.abs(mechanics.displacement - 0.002714336) < 1e-7);
  assert.equal(mechanics.drive, 'DT_RWD');
  assert.deepEqual(mechanics.corners.map((_, i) => Math.round(mechanics.spring(i))), [71613, 71613, 73575, 73575]);
  assert.deepEqual(mechanics.corners.map((_, i) => mechanics.damper(i)), [3300, 3300, 3000, 3000]);
  assert.ok(mechanics.corners.every((_, i) => mechanics.brake(i) === 1));
  assert.deepEqual([mechanics.sway(0).force, mechanics.sway(2).force], [9000, 10000]);
  const force = mechanics.driveForce(2, 0, 0.315, 1);
  assert.ok(force > 2000 && force < 4000);
  assert.equal(mechanics.driveForce(0, 0, 0.315, 1), 0);
  mechanics.crank!.condition = 0.5;
  assert.ok(Math.abs(mechanics.driveForce(2, 0, 0.315, 1) - force / 2) < 1e-9);
  mechanics.crank!.condition = 1;
  mechanics.corners[2].strut!.condition = 0.09;
  assert.equal(mechanics.support(2), 0.09);
  built.world.detach(mechanics.block!);
  assert.equal(mechanics.driveForce(2, 0, 0.315, 1), 0);
  console.log('Baiern stock: 72 installed, four complete corners, 20 engine nodes, no warnings. Damage affects suspension and drive.');
} finally { built.world.dispose(); }
