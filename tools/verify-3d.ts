import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { Box3, Matrix4, Vector3 } from 'three';
import assert from 'node:assert/strict';
import { Assets } from '../src/assets';
import { PartFactory, poseMatrix } from '../src/engine/world';
import { modelMatrix } from '../src/engine/model-transform';
import { parseScx } from '../src/formats/scx';
import { Vehicle3D } from '../src/engine/vehicle-3d';
import { gameRoot, walk, relativeGamePath, safeGamePath } from './game-files';
const assets = new Assets((await walk(gameRoot)).map(f => ({ path: relativeGamePath(f), size: 0 })), async p => new Uint8Array(await readFile(await safeGamePath(p))));
const reports = [];
const scenarios = ['idle', 'crash', 'jump', 'roll'] as const;
if (process.argv[2] && !scenarios.some(s => s === process.argv[2])) throw new Error('Expected idle, crash, jump or roll');
for (const scenario of scenarios.filter(s => !process.argv[2] || s === process.argv[2])) {
  const { world, root } = await new PartFactory(assets).stock({ pack: 'cars/racers/Baiern.rpk', id: 6 });
  const hood = [...world.parts.values()].find(p => /\/hood.cfg$/i.test(p.definition.cfgPath))!;
  const originalTree = [...world.parts.values()].map(part => ({ part, parent: part.parent, parentSlot: part.parentSlot, ownSlot: part.ownSlot }));
  const data = new Map<typeof root, { samples: number[]; triangles: number[] }>();
  for (const p of world.parts.values()) {
    if (!p.definition.model) continue;
    const type = p.parent?.definition.config.slots.find(s => s.id === p.parentSlot)?.type; if (type === 11 || type !== undefined && type >= 101 && type < 200) continue;
    const model = parseScx(await assets.read(p.definition.model.path)), transform = modelMatrix(new Matrix4(), p.definition.config.renderPose && poseMatrix(p.definition.config.renderPose));
    const samples: number[] = [], triangles: number[] = [];
    for (const mesh of model.meshes) { for (let i = 0; i < mesh.positions.length; i += 3) samples.push(...new Vector3().fromArray(mesh.positions, i).applyMatrix4(transform).toArray()); for (const i of mesh.indices) triangles.push(...new Vector3().fromArray(mesh.positions, i * 3).applyMatrix4(transform).toArray()); }
    data.set(p, { samples, triangles });
  }
  const b = new Box3(); for (let i = 0; i < data.get(root)!.samples.length; i += 3) b.expandByPoint(new Vector3().fromArray(data.get(root)!.samples, i));
  const demo = new Vehicle3D(root, hood, data.get(hood)!.samples, b), triangles: number[] = [];
  for (const [p, d] of data) if (p !== hood) { demo.register(p, d.samples, d.triangles); const frame = root.matrix().invert().multiply(p.matrix()); for (let i = 0; i < d.triangles.length; i += 3) triangles.push(...new Vector3().fromArray(d.triangles, i).applyMatrix4(frame).toArray()); }
  demo.setBodyTriangles(triangles);
  if (scenario === 'crash') demo.reset(50 / 3.6); else if (scenario === 'jump') demo.jump(); else if (scenario === 'roll') demo.roll(); else demo.reset();
  let maxY = -Infinity, minUp = 1, airborne = 0;
  for (let i = 0; i < 240 * 4; i++) {
    demo.advance(1 / 240, { throttle: 0, steer: 0, brake: false });
    maxY = Math.max(maxY, demo.driving.position.y); minUp = Math.min(minUp, new Vector3(0, 1, 0).applyQuaternion(demo.body.orientation).y);
    if (demo.suspension.wheels.every(w => !w.contact)) airborne++;
    assert.ok(demo.body.position.toArray().every(Number.isFinite));
    if (i % 240 === 0) console.log(scenario, i / 240, 'position', demo.driving.position.toArray(), 'up', new Vector3(0, 1, 0).applyQuaternion(demo.body.orientation).y, 'wheel', demo.suspension.wheels.map(w => w.force.toFixed(0)));
  }
  const report = { scenario, maxY, minUp, airborne, position: demo.driving.position.toArray(), soft: demo.soft.size, rigid: demo.rigid.size, detached: [...demo.soft.keys(), ...demo.rigid.keys()].filter(p => p !== root && !p.parent).map(p => p.definition.cfgPath.split('/').at(-1)), damaged: [...demo.soft.values()].filter(s => s.panel.plasticBeams > 0).map(s => s.part.definition.cfgPath.split('/').at(-1)), wheelForces: demo.suspension.wheels.map(w => w.force), springs: root.definition.config.wheels.map(w => w.spring) };
  if (scenario === 'idle') { assert.equal(report.detached.length, 0); assert.equal(report.damaged.length, 0); assert.ok(demo.suspension.wheels.every(w => w.contact && w.force > 0)); }
  if (scenario === 'crash') { assert.equal(hood.parent, undefined); assert.ok(report.damaged.length > 1); assert.ok([...demo.rigid.keys()].some(p => /headlight/i.test(p.definition.cfgPath) && !p.parent)); }
  if (scenario === 'jump') { assert.ok(maxY > 1.5); assert.ok(airborne > 20); }
  if (scenario === 'roll') assert.ok(minUp < -0.8);
  for (const r of demo.rigid.values()) { assert.equal(demo.soft.has(r.part), false); const m = r.part.matrix(), x = new Vector3().setFromMatrixColumn(m, 0), y = new Vector3().setFromMatrixColumn(m, 1); assert.ok(Math.abs(x.dot(y)) < 1e-8); assert.ok(Math.abs(x.length() - 1) < 1e-8 && Math.abs(y.length() - 1) < 1e-8); }
  console.log(report); reports.push(report);
  demo.reset(); assert.equal(world.parts.size, 33); assert.equal(hood.parent, root);
  for (const s of originalTree) { assert.equal(s.part.parent, s.parent); assert.equal(s.part.parentSlot, s.parentSlot); assert.equal(s.part.ownSlot, s.ownSlot); }
  assert.ok([...demo.soft.values()].every(s => s.panel.plasticBeams === 0)); world.dispose();
}
await mkdir('local', { recursive: true }); await writeFile(`local/vehicle-3d${process.argv[2] ? '-' + process.argv[2] : ''}-verification.json`, JSON.stringify(reports, null, 2));
