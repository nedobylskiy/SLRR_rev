import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SlrrJvm, jv } from 'slrr-jvm';
import { StringNative } from '../src/runtime/string-native';
import { parseTelemetry, compareTelemetry, stageTelemetry } from '../tools/stock-telemetry.mjs';

const meta = 'SLRR_PHYSICS|v=1|kind=meta|run=1|chassis_type=6|vehicle_codes=68,117,104,101,110|mass_kg=1200|transmission_config=1';
const shift = 'SLRR_PHYSICS|v=1|kind=shift|run=1|seq=2|from=1|to=2|t_before=1|t_after=1.1|rpm_before=6000|rpm_after=4200';
test('telemetry rejects malformed samples and separates repeated run numbers from appended game sessions', () => {
  const report = parseTelemetry(`normal game log\n${meta}\n${shift}\nSLRR_PHYSICS|v=1|kind=sample|run=1|seq=3|t=NaN\n${meta}\n${shift}`);
  assert.equal(report.runs.length, 2); assert.equal(report.rejected, 1);
  assert.equal(report.runs[0].model, 'Duhen');
  assert.equal(report.runs[0].shifts.length, 1); assert.equal(report.runs[1].shifts.length, 1);
  assert.notEqual(report.runs[0].key, report.runs[1].key);
});

test('telemetry comparison matches configurations and reports sampled RPM and torque deltas', () => {
  const curve = 'SLRR_PHYSICS|v=1|kind=curve|run=1|rpm=3000|torque_nm=150|power_w=47123';
  const reference = parseTelemetry([meta, shift, curve].join('\n'));
  const measured = parseTelemetry([meta, shift.replace('6000', '6500'), curve.replace('torque_nm=150', 'torque_nm=140')].join('\n'));
  const comparison = compareTelemetry(reference, measured);
  assert.equal(comparison.matched[0].shifts[0].deltaRPM, 500);
  assert.equal(comparison.matched[0].torque[0].deltaNm, -10);
  const differentCar = parseTelemetry(meta.replace('mass_kg=1200', 'mass_kg=1400'));
  assert.equal(compareTelemetry(reference, differentCar).matched.length, 0);
});

test('staging adds exact Track hooks outside the game and preserves original sources', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'slrr-telemetry-')), game = join(folder, 'game');
  const source = 'public class Track { public void animate() { } public void exit(GameState next) { } }';
  await mkdir(join(game, 'sl/Scripts/game/src'), { recursive: true });
  const original = join(game, 'sl/Scripts/game/src/Track.java'); await writeFile(original, source);
  await assert.rejects(stageTelemetry(game, join(game, 'mod')), /outside/);
  const output = join(folder, 'mod'); await stageTelemetry(game, output);
  assert.equal(await readFile(original, 'utf8'), source);
  const patched = await readFile(join(output, 'sl/Scripts/game/src/Track.java'), 'utf8');
  assert.equal(patched.match(/PhysicsTelemetry.sample/g)?.length, 1);
  assert.equal(patched.match(/PhysicsTelemetry.stop/g)?.length, 1);
  await assert.rejects(stageTelemetry(game, output), /exist/i);
});

test('Java logger executes sample throttling, shift bracketing and clock resets through the source interpreter', async () => {
  const logger = await readFile(new URL('../tools/stock-telemetry/PhysicsTelemetry.java', import.meta.url), 'utf8');
  const sources: Record<string, string> = {
    'java.game.PhysicsTelemetry': logger,
    'java.lang.System': 'package java.lang; class System { public static native void log(String text); public static native float currentTime(); }',
    'java.lang.GameType': 'package java.lang; class GameType { static int GII_TYPE=6; }',
    'java.game.Config': 'package java.game; class Config { static int player_transmission=1; }',
    'java.game.Vehicle': `package java.game; class Vehicle { java.game.parts.bodypart.Chassis chassis;
      public float getSpeed() { return 10.0; } }`,
    'java.game.parts.Part': 'package java.game.parts; class Part { String name="engine"; public int getInfo(int key){return 6;} public float getWear(){return 1.0;} public float getTear(){return 1.0;} }',
    'java.game.parts.enginepart.Block': 'package java.game.parts.enginepart; class Block extends java.game.parts.Part { java.game.parts.DynoData dynodata; }',
    'java.game.parts.DynoData': `package java.game.parts; class DynoData {
      float Displacement=2.0,Compression=10.0,maxTorque=150.0,maxHP=100000.0,RPM_maxTorque=4000.0,RPM_maxHP=6000.0,bore=.082,stroke=.09,cylinders=4.0;
      public float getTorque(float rpm,float nitro){return 150.0;} public float getHP(float rpm,float nitro){return 100000.0;} }`,
    'java.game.parts.bodypart.Chassis': `package java.game.parts.bodypart; class Chassis extends java.game.parts.Part {
      static int ENGINE_SLOT=401; String vehicleName="Duhen", modelName="DVC",vendorName="Duhen";
      float engine_rpm_idle=850.0,RPM_limit=6500.0,engine_inertia=1.0,engine_mass=100.0,rearend_ratio=3.3,ClutchF=500.0;
      int gears=5; float[] ratio=new float[8]; float rpm=6000.0; int gear=1; java.game.parts.Part engine;
      public java.game.parts.Part partOnSlot(int slot){return engine;}
      public float getMassPatch(){return 1200.0;} public float getRPM(){return rpm;}
      public int getAIparam_int(int key){return gear;} public float getAIparam_float(int key){return .5;}
      public int getShifting(){return 0;} public float getEngineTemp(){return 80.0;} }`,
  };
  for (const name of Object.keys(sources)) if (name !== 'java.game.PhysicsTelemetry') {
    for (const type of ['java.game.parts.bodypart.Chassis', 'java.game.parts.Part', 'java.game.parts.DynoData'])
      sources[name] = sources[name].replaceAll(type, type.split('.').at(-1)!);
    sources[name] = sources[name].replace(/(package [\w.]+;)/,
      '$1 import java.game.parts.*; import java.game.parts.bodypart.*;');
    sources[name] = sources[name].replace(/class\s+(\w+)[^{]*\{/, (header, simple) => `${header} public ${simple}() { }`);
  }
  const jvm = new SlrrJvm({ resolveImport: ({className: name}) => sources[name] ? { path: name + '.java', source: sources[name] } : null });
  new StringNative(jvm);
  const lines: string[] = []; let now = 1;
  jvm.natives.register('java.lang.System', 'log', ['String'], ({args}) => { lines.push(String(args[0].value)); return jv('void', undefined); });
  jvm.natives.register('java.lang.System', 'currentTime', [], () => jv('float', now));
  for (const name of Object.keys(sources)) await jvm.loadClass(name);
  const car = await jvm.constructAsync('java.game.Vehicle', []), chassis = await jvm.constructAsync('java.game.parts.bodypart.Chassis', []);
  const block = await jvm.constructAsync('java.game.parts.enginepart.Block', []), dyno = await jvm.constructAsync('java.game.parts.DynoData', []);
  jvm.set(block, 'dynodata', dyno); jvm.set(chassis, 'engine', block); jvm.set(car, 'chassis', chassis);
  const telemetry = jv('class', 'java.game.PhysicsTelemetry');
  await jvm.loadClass('java.game.PhysicsTelemetry'); await jvm.globalAsync('java.game.PhysicsTelemetry');
  await jvm.invokeAsync(telemetry, 'sample', [car]);
  now = 1.01; await jvm.invokeAsync(telemetry, 'sample', [car]);
  now = 1.2; jvm.set(chassis, 'gear', jv('int', 2)); jvm.set(chassis, 'rpm', jv('float', 4200));
  await jvm.invokeAsync(telemetry, 'sample', [car]);
  const report = parseTelemetry(lines.join('\n'));
  assert.equal(report.rejected, 0); assert.equal(report.runs[0].samples.length, 2);
  assert.equal(report.runs[0].shifts[0].rpm_before, '6000');
  assert.equal(report.runs[0].shifts[0].rpm_after, '4200');
  assert.equal(report.runs[0].model, 'Duhen'); assert.ok(report.runs[0].curves.length > 10);
  now = .1; await jvm.invokeAsync(telemetry, 'sample', [car]);
  jvm.set(jv('class', 'java.game.Config'), 'player_transmission', jv('int', 2));
  now = .2; await jvm.invokeAsync(telemetry, 'sample', [car]);
  await jvm.invokeAsync(telemetry, 'stop', []);
  const sessions = parseTelemetry(lines.join('\n')).runs;
  assert.equal(sessions.length, 3);
  assert.equal(sessions[2].metadata.transmission_config, '2');
});
