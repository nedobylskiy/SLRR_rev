import {DRIVING_PHYSICS_HZ,physicsTickBudget} from '../src/engine/physics-timing';
import { readFile } from 'node:fs/promises';
import { Box3, Matrix4, Vector3 } from 'three';
import { Assets } from '../src/assets';
import { PartFactory, poseMatrix } from '../src/engine/world';
import { modelMatrix } from '../src/engine/model-transform';
import { parseScx } from '../src/formats/scx';
import { Vehicle3D } from '../src/engine/vehicle-3d';
import { loadPartCollision } from '../src/engine/part-collision';
import { softBodyRuntime } from '../src/engine/soft-body-wasm';
import { gameRoot, walk, relativeGamePath, safeGamePath } from './game-files';

if (!await softBodyRuntime.load(() => readFile(new URL('../src/engine/wasm/soft-body.wasm', import.meta.url)))) throw new Error(softBodyRuntime.error);
const car=process.argv.find(a=>a.startsWith('--car='))?.slice(6)??'Baiern';
if(!/^[a-z0-9_-]+$/i.test(car))throw Error('Invalid car name');
const idle=process.argv.includes('--idle');
const hz=Number(process.argv.find(a=>a.startsWith('--hz='))?.slice(5)??DRIVING_PHYSICS_HZ);physicsTickBudget(hz);const phaseSteps=3*hz;
const assets = new Assets((await walk(gameRoot)).map(f => ({ path: relativeGamePath(f), size: 0 })), async p => new Uint8Array(await readFile(await safeGamePath(p))));
const { world, root } = await new PartFactory(assets).stock({ pack: `cars/racers/${car}.rpk`, id: 6 },{mechanical:process.argv.includes('--mechanical')});
const hood = [...world.parts.values()].find(p => /\/hood.cfg$/i.test(p.definition.cfgPath))!;
const data = new Map<typeof root, { samples: number[]; triangles: number[] }>();
for (const part of world.parts.values()) {
  if (!part.definition.model) continue;
  const type = part.parent?.definition.config.slots.find(s => s.id === part.parentSlot)?.type;
  if (type === 11 || type !== undefined && type >= 101 && type < 200) continue;
  const model = parseScx(await assets.read(part.definition.model.path));
  const transform = modelMatrix(new Matrix4(), part.definition.config.renderPose && poseMatrix(part.definition.config.renderPose));
  const samples: number[] = [], triangles: number[] = [], point = new Vector3();
  for (const mesh of model.meshes) {
    for (let i = 0; i < mesh.positions.length; i += 3) { point.fromArray(mesh.positions, i).applyMatrix4(transform); samples.push(point.x, point.y, point.z); }
    for (const i of mesh.indices) { point.fromArray(mesh.positions, i * 3).applyMatrix4(transform); triangles.push(point.x, point.y, point.z); }
  }
  const physical = await loadPartCollision(assets, part.definition);
  data.set(part, { samples, triangles: physical.length ? physical : triangles });
}
const bounds = new Box3(), point = new Vector3();
for (let i = 0; i < data.get(root)!.samples.length; i += 3) bounds.expandByPoint(point.fromArray(data.get(root)!.samples, i));
const demo = new Vehicle3D(root, hood, data.get(hood)!.samples, bounds,undefined,undefined,hz), triangles: number[] = [];
for (const [part, geometry] of data) if (part !== hood) {
  demo.register(part, geometry.samples, geometry.triangles);
  const frame = root.matrix().invert().multiply(part.matrix());
  if(!part.definition.mechanics)for (let i = 0; i < geometry.triangles.length; i += 3) { point.fromArray(geometry.triangles, i).applyMatrix4(frame); triangles.push(point.x, point.y, point.z); }
}
demo.setBodyTriangles(triangles);if(idle)demo.disableObstacle();demo.reset(idle?0:50/3.6);
console.log(`${car}: ${triangles.length / 9} body triangles, ${demo.soft.size} panels, C++/WASM, ${hz} Hz`);
for (let phase = 0; phase < 4; phase++) {
  const totals = { wall: 0, solve: 0, surface: 0, sleep: 0, active: 0, refits: 0 };
  for (let tick = 0; tick < phaseSteps; tick++) {
    if (process.argv.includes('--keep-awake')) for (const s of demo.soft.values()) s.activity.resting = false;
    const start = performance.now(); demo.advance(1 / hz, { throttle: 0, steer: 0, brake: phase > 0 }); totals.wall += performance.now() - start;
    totals.solve += demo.timings.panelSolve; totals.surface += demo.timings.panelSurface; totals.sleep += demo.timings.panelSleep;
    totals.active += demo.timings.activePanels; totals.refits += demo.timings.surfaceUpdates;
  }
  console.log(`${phase * 3}-${phase * 3 + 3}s:`, JSON.stringify({ ...totals, msPer30FpsFrame:totals.wall/phaseSteps*hz/30,msPerTick:totals.wall/phaseSteps,active:totals.active/phaseSteps, speed: demo.body.velocity.length() }));
  console.log('active:', [...demo.soft.values()].filter(s => s.activity.deforming).map(s => { const m = s.activity.motion(); return { name: s.part.definition.alias, attached: !!s.part.parent || s.root, vibration: m.internalSpeed, velocity: m.velocity.length(), omega: m.omega.length() }; }));
}
world.dispose();
