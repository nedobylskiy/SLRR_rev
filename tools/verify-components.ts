import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Assets } from '../src/assets';
import { PartFactory, poseMatrix, type EnginePart } from '../src/engine/world';
import { MechanicalSystem } from '../src/engine/mechanical-system';
import { parseScx } from '../src/formats/scx';
import { SCX_TO_WORLD } from '../src/engine/model-transform';
import { Vector3 } from 'three';
import { gameRoot, walk, relativeGamePath, safeGamePath } from './game-files';

const assets = new Assets((await walk(gameRoot)).map(path => ({ path: relativeGamePath(path), size: 0 })), async path => new Uint8Array(await readFile(await safeGamePath(path))));
const built = await new PartFactory(assets).stock({ pack: 'cars/racers/Baiern.rpk', id: 6 }, { mechanical: true });
const visualAxis = async (part: EnginePart) => {
  const model = parseScx(await assets.read(part.definition.model!.path));
  const pose = part.definition.config.renderPose && poseMatrix(part.definition.config.renderPose);
  const points = model.meshes.flatMap(mesh => Array.from({ length: mesh.positions.length / 3 }, (_, i) => {
    const point = new Vector3().fromArray(mesh.positions, i * 3).multiplyScalar(SCX_TO_WORLD);
    return pose ? point.applyMatrix4(pose) : point;
  }));
  const centerX = (Math.min(...points.map(p => p.x)) + Math.max(...points.map(p => p.x))) / 2;
  const centerZ = (Math.min(...points.map(p => p.z)) + Math.max(...points.map(p => p.z))) / 2;
  const matrix = part.matrix().multiply(part.renderAdjustment);
  return [Math.min(...points.map(p => p.y)), Math.max(...points.map(p => p.y))].map(y => new Vector3(centerX, y, centerZ).applyMatrix4(matrix));
};
try {
  assert.deepEqual(built.warnings, []);
  assert.equal(built.world.parts.size, 72);
  assert.equal(built.world.wheelRefs.length, 4);
  for (const wheel of built.world.wheelRefs) {
    assert.ok(wheel && Math.abs(wheel.friction - 1.76863) < 0.001, 'stock Java tyre source sets WheelRef friction');
    assert.ok(Math.abs(wheel.radius - 0.32865) < 0.001, 'stock Java tyre source sets WheelRef radius');
    assert.ok(wheel.pacejka[4] > 17 && wheel.pacejka[4] < 18, 'stock Java tyre source sets WheelRef stiffness');
  }
  const mechanics = new MechanicalSystem(built.root);
  for (const [index, corner] of mechanics.corners.entries()) {
    const wheelX = built.root.definition.config.wheels[index].position[0];
    for (const part of [corner.strut, corner.spring, corner.shock, corner.brake]) {
      assert.ok(part, `corner ${index} is complete`);
      const x = new Vector3().setFromMatrixPosition(part.matrix()).x;
      assert.ok(Math.abs(x - wheelX) < 0.25, `${part.definition.cfgPath} must mount beside wheel ${index}`);
    }
    if (index < 2) assert.match(corner.strut!.definition.additionalModels?.[0]?.model.path ?? '', new RegExp(`${['FL', 'FR'][index]}_lower_arm\\.scx$`, 'i'));
    else assert.ok(corner.strut!.definition.additionalModels?.length, `rear suspension ${index} keeps its additional CFG render meshes`);
    assert.match(corner.brake!.definition.model?.path ?? '', new RegExp(`disc_brake_${['FL', 'FR', 'RL', 'RR'][index]}\\.scx$`, 'i'));
    const wheel = built.root.children.get(101 + index)!;
    assert.ok(Math.abs(new Vector3().setFromMatrixPosition(wheel.matrix()).x - wheelX - built.root.slotPositions.get(101 + index)![0]) < 1e-10);
    const [shockBottom, shockTop] = await visualAxis(corner.shock!);
    const [springBottom, springTop] = await visualAxis(corner.spring!);
    assert.ok(shockBottom.distanceTo(springBottom) < 0.04, `shock ${index} stays inside its spring at the lower mount: ${shockBottom.toArray()} vs ${springBottom.toArray()}`);
    assert.ok(shockTop.distanceTo(springTop) < 0.04, `shock ${index} meets its spring at the upper mount: ${shockTop.toArray()} vs ${springTop.toArray()}`);
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
