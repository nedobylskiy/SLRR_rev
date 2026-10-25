import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Box3, Matrix4, Vector3 } from 'three';
import { Assets } from '../src/assets';
import { DrivingDemo } from '../src/engine/driving-demo';
import { RigidBody3D } from '../src/engine/rigid-body-3d';
import { Suspension3D, TestTerrain } from '../src/engine/suspension-3d';
import { vehicleAssemblyCenter, vehicleAssemblyMass } from '../src/engine/vehicle-3d';
import { PartFactory } from '../src/engine/world';
import { gameRoot, relativeGamePath, safeGamePath, walk } from './game-files';

const reference = JSON.parse(await readFile(new URL('../benchmarks/baiern-coupesport-2.5/reference.json', import.meta.url), 'utf8'));
const assets = new Assets((await walk(gameRoot)).map(path => ({ path: relativeGamePath(path), size: 0 })),
  async path => new Uint8Array(await readFile(await safeGamePath(path))));
const { root, world } = await new PartFactory(assets).stock({ pack: 'cars/racers/Baiern.rpk', id: 6 }, { mechanical: true });

try {
  const mass = vehicleAssemblyMass(world.parts.values());
  const rawMass = [...world.parts.values()].reduce((sum, part) => sum + part.definition.config.bodies.reduce((bodySum, body) => bodySum + body.mass, 0), 0);
  const wheel = root.definition.config.wheels;
  const chassisBounds = new Box3(
    new Vector3(Math.min(...wheel.map(w => w.position[0])) - 0.3, -0.55, Math.min(...wheel.map(w => w.position[2])) - 0.6),
    new Vector3(Math.max(...wheel.map(w => w.position[0])) + 0.3, 0.55, Math.max(...wheel.map(w => w.position[2])) + 0.6),
  );
  const body = new RigidBody3D(mass, chassisBounds, vehicleAssemblyCenter(root));
  body.setFrame(new Matrix4().makeTranslation(0, new DrivingDemo(root).position.y, 0));
  const suspension = new Suspension3D(root, body, new TestTerrain()); suspension.reset();
  const dt = 1 / 240, input = { throttle: 0, steer: 0, brake: false };
  assert.equal(suspension.mechanics!.gear, 0, 'the stock car starts in neutral');
  suspension.step(dt, { ...input, gearUp: true }); body.integrate(dt);
  for (let i = 1; i < 480; i++) { suspension.step(dt, input); body.integrate(dt); }
  assert.equal(suspension.mechanics!.gear, 1, 'first gear is selected before timing the run');
  const start = body.position.clone(), samples: object[] = [], tireTrace: object[] = [];
  const shifts: { seconds: number; from: number; to: number; speedKph: number; rpm: number }[] = [];
  let previousGear = suspension.mechanics!.gear, zeroTo100Seconds: number | null = null;
  let quarterMile: { seconds: number; trapKph: number } | null = null, mile: { seconds: number; trapKph: number } | null = null;
  for (let step = 1; step <= 240 * 45; step++) {
    suspension.step(dt, { ...input, throttle: 1 }); body.integrate(dt);
    const t = step * dt, speedKph = Math.max(0, -body.velocity.z * 3.6), distance = start.z - body.position.z, gear = suspension.mechanics!.gear;
    if (process.argv.includes('--tire-trace') && step % 60 === 0 && t <= 4) tireTrace.push({ seconds: t, speedKph: Number(speedKph.toFixed(1)), wheels: suspension.wheels.map(w => ({ slip: Number(w.slip.toFixed(2)), slipSpeed: Number(w.slipSpeed.toFixed(1)), lateralSpeed: Number(w.lateralSpeed.toFixed(1)), load: Math.round(w.force) })) });
    if (gear !== previousGear) { shifts.push({ seconds: Number(t.toFixed(3)), from: previousGear, to: gear, speedKph: Number(speedKph.toFixed(1)), rpm: Math.round(suspension.mechanics!.rpm) }); previousGear = gear; }
    if (step % 240 === 0 && (t <= 10 || t % 5 === 0)) samples.push({ seconds: t, speedKph: Number(speedKph.toFixed(1)), rpm: Math.round(suspension.mechanics!.rpm), gear, rearSlip: suspension.wheels.slice(2).map(w => Number(w.slip.toFixed(2))), contacts: suspension.wheels.filter(w => w.contact).length });
    if (zeroTo100Seconds === null && speedKph >= 100) zeroTo100Seconds = t;
    if (!quarterMile && distance >= 402.336) quarterMile = { seconds: t, trapKph: speedKph };
    if (!mile && distance >= 1609.344) { mile = { seconds: t, trapKph: speedKph }; break; }
  }
  const report = { zeroTo100: { gameSeconds: reference.testTrackResults.zeroTo100Seconds, modelSeconds: zeroTo100Seconds }, quarterMile: { gameSeconds: reference.testTrackResults.quarterMileSeconds, gameTrapKph: reference.testTrackResults.quarterMileTrapKph, model: quarterMile }, mile: { gameSeconds: reference.testTrackResults.mileSeconds, gameTrapKph: reference.testTrackResults.mileTrapKph, model: mile }, massKg: mass, cfgBodyMassKg: rawMass, startHeightM: Number(start.y.toFixed(3)), shifts, samples, ...(tireTrace.length ? { tireTrace } : {}) };
  if (process.argv.includes('--verify')) {
    assert.ok(zeroTo100Seconds !== null && Math.abs(zeroTo100Seconds - reference.testTrackResults.zeroTo100Seconds) < 0.25, `0–100 mismatch: ${zeroTo100Seconds}`);
    assert.ok(quarterMile && Math.abs(quarterMile.seconds - reference.testTrackResults.quarterMileSeconds) < 0.6, `quarter mile mismatch: ${quarterMile?.seconds}`);
    assert.ok(mile && Math.abs(mile.seconds - reference.testTrackResults.mileSeconds) < 1.2, `mile mismatch: ${mile?.seconds}`);
    assert.deepEqual(shifts.map(shift => [shift.from, shift.to]), [[1, 2], [2, 3], [3, 4], [4, 5]]);
    assert.ok(mass > reference.chassis.massKg * 0.98 && mass < reference.chassis.massKg * 1.02);
  }
  console.log(JSON.stringify(report, null, 2));
} finally { world.dispose(); }
