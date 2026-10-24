import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { Box3, Matrix4, Vector3 } from 'three';
import assert from 'node:assert/strict';
import { Assets } from '../src/assets';
import { PartFactory, poseMatrix } from '../src/engine/world';
import { modelMatrix } from '../src/engine/model-transform';
import { parseScx } from '../src/formats/scx';
import { Vehicle3D } from '../src/engine/vehicle-3d';
import { loadPartCollision } from '../src/engine/part-collision';
import { gameRoot, walk, relativeGamePath, safeGamePath } from './game-files';
const assets = new Assets((await walk(gameRoot)).map(f => ({ path: relativeGamePath(f), size: 0 })), async p => new Uint8Array(await readFile(await safeGamePath(p))));
const reports = [];
const scenarios = ['idle', 'crash', 'rear', 'roof', 'jump', 'roll'] as const;
if (process.argv[2] && !scenarios.some(s => s === process.argv[2])) throw new Error(`Expected ${scenarios.join(', ')}`);
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
    const physical = await loadPartCollision(assets, p.definition);
    data.set(p, { samples, triangles: physical.length ? physical : triangles });
  }
  const b = new Box3(); for (let i = 0; i < data.get(root)!.samples.length; i += 3) b.expandByPoint(new Vector3().fromArray(data.get(root)!.samples, i));
  const demo = new Vehicle3D(root, hood, data.get(hood)!.samples, b), triangles: number[] = [];
  for (const [p, d] of data) if (p !== hood) { demo.register(p, d.samples, d.triangles); const frame = root.matrix().invert().multiply(p.matrix()); for (let i = 0; i < d.triangles.length; i += 3) triangles.push(...new Vector3().fromArray(d.triangles, i).applyMatrix4(frame).toArray()); }
  demo.setBodyTriangles(triangles);
  if (scenario === 'crash') demo.reset(50 / 3.6); else if (scenario === 'rear') demo.rearCrash(); else if (scenario === 'roof') demo.dropOnRoof(); else if (scenario === 'jump') demo.jump(); else if (scenario === 'roll') demo.roll(); else demo.reset();
  let maxY = -Infinity, minUp = 1, airborne = 0;
  let maxGuardIntrusion = 0;
  const stepTimes: number[] = [];
  for (let i = 0; i < 240 * 4; i++) {
    const start = performance.now();
    const beforePanels = scenario === 'crash' ? [...demo.soft.values()].map(s => ({ part: s.part, center: s.activity.motion().center, attached: !!s.part.parent, rigid: !s.activity.deforming })) : [];
    demo.advance(1 / 240, { throttle: 0, steer: 0, brake: false });
    for (const before of beforePanels) {
      const state = demo.soft.get(before.part)!, delta = state.activity.motion().center.distanceTo(before.center);
      if (before.attached && !before.part.parent) assert.ok(delta < 0.35, `${before.part.definition.cfgPath} jumped ${delta.toFixed(3)} m on release`);
      if (!before.rigid && !state.activity.deforming) assert.ok(delta < 0.2, `${before.part.definition.cfgPath} jumped ${delta.toFixed(3)} m on rigid transition`);
    }
    if (scenario === 'crash') for (const state of demo.soft.values()) if (state.guard && !state.part.parent) {
      const guard = state.guard, inverse = demo.body.matrix().invert();
      for (let n = 0; n < state.panel.positions.length; n += 3) {
        const local = new Vector3().fromArray(state.panel.positions, n).applyMatrix4(inverse);
        maxGuardIntrusion = Math.max(maxGuardIntrusion, guard.minimum[n / 3] - guard.sign * local.getComponent(guard.axis));
      }
    }
    stepTimes.push(performance.now() - start);
    maxY = Math.max(maxY, demo.driving.position.y); minUp = Math.min(minUp, new Vector3(0, 1, 0).applyQuaternion(demo.body.orientation).y);
    if (demo.suspension.wheels.every(w => !w.contact)) airborne++;
    assert.ok(demo.body.position.toArray().every(Number.isFinite));
    if (i % 240 === 0) console.log(scenario, i / 240, 'position', demo.driving.position.toArray(), 'up', new Vector3(0, 1, 0).applyQuaternion(demo.body.orientation).y, 'wheel', demo.suspension.wheels.map(w => w.force.toFixed(0)));
  }
  const chassisPanel = demo.soft.get(root)!.panel;
  let chassisMaxDent = 0;
  for (let n = 0; n < chassisPanel.positions.length; n += 3) {
    chassisMaxDent = Math.max(chassisMaxDent, Math.hypot(
      chassisPanel.positions[n] - chassisPanel.rest[n],
      chassisPanel.positions[n + 1] - chassisPanel.rest[n + 1],
      chassisPanel.positions[n + 2] - chassisPanel.rest[n + 2],
    ));
  }
  let chassisVisibleDentP90 = 0;
  if (scenario === 'crash' || scenario === 'rear') {
    const samples = data.get(root)!.samples, front = scenario === 'crash', frame = root.matrix(), visible: number[] = [];
    for (let i = 0; i < samples.length; i += 3) {
      const z = samples[i + 2], edge = b.min.z + (b.max.z - b.min.z) * (front ? 0.2 : 0.8);
      if (front ? z > edge : z < edge) continue;
      const position = [0, 0, 0]; chassisPanel.skin(chassisPanel.bind(samples.slice(i, i + 3)), position);
      visible.push(new Vector3().fromArray(position).distanceTo(new Vector3().fromArray(samples, i).applyMatrix4(frame)));
    }
    visible.sort((a, b) => a - b);
    chassisVisibleDentP90 = visible[Math.floor(visible.length * 0.9)] ?? 0;
  }
  const report = { scenario, maxY, minUp, airborne, chassisMaxDent, chassisVisibleDentP90, position: demo.driving.position.toArray(), soft: demo.soft.size, rigid: demo.rigid.size, detached: [...demo.soft.keys(), ...demo.rigid.keys()].filter(p => p !== root && !p.parent).map(p => p.definition.cfgPath.split('/').at(-1)), damaged: [...demo.soft.values()].filter(s => s.panel.plasticBeams > 0).map(s => s.part.definition.cfgPath.split('/').at(-1)), wheelForces: demo.suspension.wheels.map(w => w.force), springs: root.definition.config.wheels.map(w => w.spring) };
  const structure = { condition: root.condition, wheels: demo.suspension.wheels.map(w => ({ shift: w.hardpoint.distanceTo(w.originalHardpoint), condition: w.mountCondition })), partConditions: [...world.parts.values()].map(p => ({ cfg: p.definition.cfgPath, condition: p.condition })) };
  if (scenario === 'idle') { assert.equal(report.detached.length, 0); assert.equal(report.damaged.length, 0); assert.ok(demo.suspension.wheels.every(w => w.contact && w.force > 0)); }
  if (scenario === 'crash') { assert.equal(hood.parent, undefined); assert.ok(report.damaged.length > 1); assert.ok([...demo.rigid.keys()].some(p => /headlight/i.test(p.definition.cfgPath) && !p.parent)); }
  if (scenario === 'crash') assert.ok(maxGuardIntrusion < 0.15, `detached panels penetrated ${maxGuardIntrusion.toFixed(3)} m past their release side`);
  if (scenario === 'crash' || scenario === 'rear') { assert.ok(chassisPanel.plasticBeams > 0); assert.ok(chassisMaxDent > 0.1 && chassisMaxDent < 0.5, `chassis deformation ${chassisMaxDent.toFixed(3)} m`); assert.ok(chassisVisibleDentP90 > (scenario === 'crash' ? 0.2 : 0.1), `visible chassis deformation ${chassisVisibleDentP90.toFixed(3)} m`); assert.ok(structure.wheels.some(w => w.shift > 0.005)); }
  if (scenario === 'rear') assert.ok(report.damaged.some(p => /r_bumper|trunk/.test(p ?? '')));
  if (scenario === 'roof') assert.ok(demo.bodySurface!.hits > 0);
  if (scenario === 'jump') { assert.ok(maxY > 1.5); assert.ok(airborne > 20); }
  if (scenario === 'roll') assert.ok(minUp < -0.8);
  for (const r of demo.rigid.values()) { assert.equal(demo.soft.has(r.part), false); const m = r.part.matrix(), x = new Vector3().setFromMatrixColumn(m, 0), y = new Vector3().setFromMatrixColumn(m, 1); assert.ok(Math.abs(x.dot(y)) < 1e-8); assert.ok(Math.abs(x.length() - 1) < 1e-8 && Math.abs(y.length() - 1) < 1e-8); }
  const wallMs = stepTimes.reduce((sum, ms) => sum + ms, 0), sorted = [...stepTimes].sort((a, b) => a - b);
  const performanceReport = { simulatedSeconds: 4, wallMs, realTimeFactor: 4000 / wallMs, stepP95Ms: sorted[Math.floor(sorted.length * 0.95)], stepMaxMs: sorted.at(-1) };
  console.log(report, structure.wheels, performanceReport); reports.push({ ...report, structure, performance: performanceReport });
  demo.reset(); assert.equal(world.parts.size, 33); assert.equal(hood.parent, root);
  for (const s of originalTree) { assert.equal(s.part.parent, s.parent); assert.equal(s.part.parentSlot, s.parentSlot); assert.equal(s.part.ownSlot, s.ownSlot); assert.equal(s.part.condition, 1); }
  assert.ok(demo.suspension.wheels.every(w => w.mountCondition === 1 && w.hardpoint.equals(w.originalHardpoint)));
  assert.ok([...demo.soft.values()].every(s => s.panel.plasticBeams === 0)); world.dispose();
}
await mkdir('local', { recursive: true }); await writeFile(`local/vehicle-3d${process.argv[2] ? '-' + process.argv[2] : ''}-verification.json`, JSON.stringify(reports, null, 2));
