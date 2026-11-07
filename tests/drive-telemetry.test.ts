import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import {parsePhysicsFrames,summarizePhysicsFrames} from '../tools/report-physics-frames';
import { DriveTelemetry } from '../src/engine/drive-telemetry';
import type { Vehicle3D } from '../src/engine/vehicle-3d';
// @ts-expect-error Archived original-game exporter is intentionally plain JavaScript.
import { parse } from '../data/telemetry/original-game/2026-11-05/provenance/exporter/extract.mjs';

function fixture() {
  const mechanics = { idleRpm: 850, redlineRpm: 6500, manual: true, rpm: 3000, gear: 2, shifting: false,
    temperature: 35, running: true, starting: false, power: 1, boost: 0.4, displacement: 0.0018,
    block: { condition: 0.95, definition: { alias: 'test engine' } }, estimateFlywheelTorqueAt: () => 150 };
  const vehicle = { physicsDt: 1/240, root: { definition: { alias: 'test car', config: {}, key: { pack: 'cars/test.rpk', id: 6 } },
    world: { experimentalHubGeometry: false } }, body: { mass: 1200, position: new Vector3(1,2,3),
      velocity: new Vector3(2,0,-10), omega: new Vector3(0,0.5,0), orientation: new Quaternion() },
    suspension: { mechanics, steer: 0.2, tireModel: { model: 'sl2' }, wheels: Array.from({length:4}, () => ({
      center: new Vector3(), omega: 40, radius: 0.3, slip: 0.2, slipSpeed: 2, lateralSpeed: 1, contact: true, force: 3000, length: 0.2, steering: 1 })) } };
  return { recorder: new DriveTelemetry(vehicle as unknown as Vehicle3D), vehicle };
}
const input = { throttle: 0.75, throttleMode: 'pedal' as const, steer: -0.2, brake: false };

test('physics capture is opt-in, uses simulation time and round-trips through original v2 exporter', () => {
  const { recorder, vehicle } = fixture();
  recorder.tick(1/240,input); assert.equal(recorder.text(),'');
  recorder.start({ map_pack: 'maps/test_track.rpk' });
  for (let tick=0;tick<480;tick++) {
    vehicle.suspension.mechanics.rpm = 3000+tick;
    recorder.tick(1/240,input);
  }
  recorder.stop();
  const report = parse(recorder.text());
  assert.equal(report.rejected,0); assert.equal(report.incompletePackets,0);
  const session = report.sessions[0];
  assert.equal(session.samples.length,20); assert.ok(session.ended);
  assert.equal(session.model,'test car'); assert.equal(session.engineName,'test engine');
  assert.equal(session.metadata.source,'redline-rebuilt'); assert.equal(session.metadata.map_pack,'maps/test_track.rpk');
  assert.equal(session.metadata.mass_kg,'1200'); assert.equal(session.metadata.stop_reason,'button');
  assert.equal(session.samples[0].rpm,'3023');
  assert.equal(session.samples[0].wheel_0_omega_rad_s,'40');
  assert.equal(session.samples[0].wheel_0_contact,'1');
  assert.equal(session.samples[0].longitudinal_mps,'10');
  assert.equal(session.samples[0].lateral_mps,'2');
  assert.equal(session.samples[0].throttle_param0,'0.75');
  assert.equal(session.samples[0].starter_active,'0');
  session.samples.forEach((sample: Record<string,string>, i: number) => {
    assert.ok(Math.abs(Number(sample.t)-(i+1)*0.1)<1e-10);
    assert.equal(sample.seq,String(i));
  });
  const saved = recorder.text(); recorder.tick(1/240,input); assert.equal(recorder.text(),saved);
});

test('different render batching preserves identical sample times and values', () => {
  const record = (batch: number) => {
    const { recorder } = fixture(); recorder.start();
    for (let frame=0; frame<480/batch; frame++) for (let tick=0;tick<batch;tick++) recorder.tick(1/240,input);
    recorder.stop(); return parse(recorder.text()).sessions[0].samples;
  };
  assert.deepEqual(record(4),record(8));
});

test('stop retains a completed recording; restart clears samples and the safety limit stops capture', () => {
  const { recorder } = fixture(); recorder.start();
  assert.throws(() => recorder.start(),/already/);
  for (let i=0;i<24;i++) recorder.tick(1/240,input);
  recorder.stop('vehicle_reset'); assert.equal(recorder.status.samples,1);
  assert.equal(parse(recorder.text()).sessions[0].metadata.stop_reason,'vehicle_reset');
  recorder.start(); assert.equal(recorder.status.samples,0);
  for (let i=0;i<recorder.maxSamples+10;i++) recorder.tick(0.1,input);
  assert.equal(recorder.status.samples,recorder.maxSamples);
  assert.equal(recorder.status.recording,false); assert.equal(recorder.status.reason,'sample_limit');
});


test('per-frame CPU trace shares the download, preserves stalls, resets on restart and keeps the v2 exporter compatible',()=>{
  const {recorder,vehicle}=fixture();
  const timed=vehicle as typeof vehicle & {advanceVersion:number;timings:Record<string,number>;simulationPendingSeconds:number;soft:Map<unknown,unknown>};
  Object.assign(timed,{advanceVersion:0,timings:{ticks:0,activePanels:0,nodeSteps:0,beamIterations:0,surfaceUpdates:0,surfaceTriangles:0,surfaceParts:0,surfaceVertices:0,surfaceBuilds:0,surfaceRefits:0,panelConstraints:0,panelContacts:0,panelUpload:0,panelIntegration:0,looseContacts:0,contacts:0,panelSurface:0,panels:0,other:0,suspension:0},simulationPendingSeconds:.02,soft:new Map()});
  recorder.recordPerformanceFrame(0,{});assert.equal(recorder.text(),'');
  Object.assign(timed,{contactProfile:{queries:64,cacheHits:63,timedQueries:2,queryMs:.5}});
  recorder.start();recorder.tick(.1,input);timed.advanceVersion++;
  Object.assign(timed.timings,{ticks:4,panelConstraints:2,panelContacts:3,panelSurface:4,panelSurfaceContacts:1.2,panelGround:.3});
  recorder.recordPerformanceFrame(100,{ 'Vehicle render geometry CPU':5,'Render callback CPU':20 });
  timed.advanceVersion++;Object.assign(timed.timings,{ticks:64,panelConstraints:100});
  recorder.recordPerformanceFrame(600,{'Render callback CPU':450});
  // No advance since the last render: paused frames must not repeat old physics work.
  recorder.recordPerformanceFrame(616,{});
  recorder.recordPerformanceFrame(10000,{},true);recorder.recordPerformanceFrame(10020,{});
  recorder.stop();const text=recorder.text();
  const frames=text.split('\n').filter(l=>l.startsWith('SLRR_FRAME|v=1|')).map(l=>JSON.parse(l.slice('SLRR_FRAME|v=1|'.length)));
  assert.equal(frames[0].contact_queries,64);assert.equal(frames[0].contact_queryMs,.5);assert.equal(frames[0].panel_surface_contacts_ms,1.2);assert.equal(frames[0].panel_ground_sampling_ms,.3);
  assert.equal(frames[2].contact_queries,0);assert.equal(frames[2].panel_surface_contacts_ms,0);
  assert.equal(frames.length,4);assert.equal(recorder.status.frames,4);
  assert.equal(frames[0].constraints_ms,2);assert.equal(frames[0].panel_contacts_ms,3);assert.equal(frames[0].body_collision_geometry_ms,4);
  assert.equal(frames[0].cpu_vehicle_render_geometry_cpu_ms,5);assert.equal(frames[1].frame_interval_ms,500);assert.equal(frames[1].physics_ticks,64);
  assert.equal(frames[1].constraints_ms,100);assert.equal(frames[2].physics_ticks,0);assert.equal(frames[2].constraints_ms,0);assert.equal(frames[3].frame_interval_ms,0);
  const parsed=parsePhysicsFrames(text);assert.equal(parsed.rejected,0);assert.equal(parsed.frames.length,4);assert.equal(summarizePhysicsFrames(parsed.frames).worst_frames[0].previous?.constraints_ms,2);
  assert.equal(parsePhysicsFrames('SLRR_FRAME|v=1|bad').rejected,1);
  const original=parse(text);assert.equal(original.rejected,0);assert.equal(original.sessions[0].samples.length,1);
  recorder.recordPerformanceFrame(11000,{});assert.equal(recorder.text(),text);
  recorder.start();assert.equal(recorder.status.frames,0);Object.defineProperty(recorder,'maxFrames',{value:2});
  recorder.recordPerformanceFrame(0,{});recorder.recordPerformanceFrame(16,{});assert.equal(recorder.status.reason,'frame_limit');assert.equal(recorder.status.recording,false);
});
