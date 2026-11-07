import test from 'node:test';
import assert from 'node:assert/strict';
import {FrameProfiler} from '../src/render/frame-profiler';

function fixture(){
  let active=false,checks=0,deleted=0,disjoint=false,ready=true;
  const gl={getExtension:()=>({TIME_ELAPSED_EXT:1,GPU_DISJOINT_EXT:2}),
    getParameter:()=>{checks++;return disjoint;},createQuery:()=>({}),
    beginQuery:()=>{assert.equal(active,false,'timer queries cannot nest');active=true;},
    endQuery:()=>{assert.ok(active);active=false;},
    getQueryParameter:(_:unknown,key:number)=>key===3?ready:2e6,
    deleteQuery:()=>{deleted++;},QUERY_RESULT_AVAILABLE:3,QUERY_RESULT:4};
  const profiler=new FrameProfiler({getContext:()=>gl,info:{render:{calls:0,triangles:0},memory:{textures:0,geometries:0}}} as any);
  const sample=()=>{for(let i=0;i<17;i++)profiler.beginGpu();};
  return {profiler,sample,get checks(){return checks;},get deleted(){return deleted;},get active(){return active;},
    disjoint:(value:boolean)=>{disjoint=value;},ready:(value:boolean)=>{ready=value;}};
}
test('GPU queries are asynchronous and control-plane reads are sampled, not issued every frame',()=>{
  const f=fixture();f.sample();assert.equal(f.checks,1);assert.ok(f.active);f.profiler.endGpu();
  f.sample();f.profiler.endGpu();assert.equal(f.checks,2);
  assert.ok(f.profiler.lines().some(line=>line.startsWith('GPU: 2.0 ms')));f.profiler.dispose();
});
test('detailed passes never nest timer queries and disjoint invalidates pending results',()=>{
  const f=fixture();f.profiler.detailedGpu=true;f.sample();assert.equal(f.active,false);
  f.profiler.gpuSection('GPU reflections',()=>f.profiler.gpuSection('nested',()=>assert.ok(f.active)));
  assert.equal(f.active,false);f.ready(false);f.disjoint(true);f.sample();assert.equal(f.deleted,1);
  assert.equal(f.active,false);f.profiler.dispose();
});
test('detailed mode alternates pass samples with a total GPU sample',()=>{
  const f=fixture();f.profiler.setDetailedGpu(true);f.sample();assert.equal(f.active,false);
  f.profiler.gpuSection('GPU main color',()=>assert.ok(f.active));
  f.sample();assert.ok(f.active);
  f.profiler.gpuSection('nested pass',()=>assert.ok(f.active));assert.ok(f.active);
  f.profiler.endGpu();f.sample();
  assert.ok(f.profiler.lines().some(line=>line.startsWith('GPU total:')));f.profiler.dispose();
});

test('slow interval history separates the previous render callback from work between frames without double-counting nested scopes',context=>{
  let now=0;context.mock.method(performance,'now',()=>now);
  const {profiler:p}=fixture();p.setDetailedGpu(true);p.beginFrame(0);
  p.measure('Render CPU',()=>{now+=2;p.measure('Nested CPU',()=>{now+=3;});now+=5;});
  now=12;p.endFrame();p.measure('Dealer poll CPU',()=>{now+=20;});
  now=66.7;p.beginFrame(now);p.endFrame();
  const report=p.lines().join('\n');
  assert.match(report,/interval 66.7 ms · previous callback 12.0 · gap 54.7/);
  assert.match(report,/callback sections: Render CPU 10.0 · between callbacks measured CPU: Dealer poll CPU 20.0/);
  assert.match(report,/Uninstrumented callback CPU: .*max session 2.0/);
  now=70;p.measure('Late timer CPU',()=>{now+=80;});p.beginFrame(83.4);p.endFrame();
  assert.ok(p.lines().some(l=>l.includes('RAF timestamp delta 16.7')&&l.includes('Late timer CPU 80.0')),
    'a stale RAF timestamp cannot hide an actual main-thread stall');
  for(let i=0;i<25;i++){now+=50;p.beginFrame(now);p.endFrame();}
  assert.equal(p.lines().filter(l=>l.includes('s ago · interval')).length,12,'history stays bounded');
  now+=120001;assert.equal(p.lines().filter(l=>l.includes('s ago · interval')).length,0,'old stalls expire');
  p.dispose();
});

test('session maximum survives the short peak window and invalid samples are ignored',context=>{
  let now=0;context.mock.method(performance,'now',()=>now);
  const {profiler:p}=fixture();p.setDetailedGpu(true);p.record('Probe',50);now=3000;p.record('Probe',1);p.record('Probe',NaN);
  assert.ok(p.lines().some(l=>l.startsWith('Probe:')&&l.includes('peak 1.0')&&l.includes('max session 50.0')&&l.includes('samples 2')));
  p.dispose();
});

test('route summary averages the whole measurement period and reset removes the warmup',()=>{
  const {profiler:p}=fixture();p.record('Probe',101);for(let i=0;i<200;i++)p.record('Probe',1);
  const row=p.summary().Probe;assert.equal(row.samples,201);assert.ok(Math.abs(row.mean_ms-301/201)<1e-12);
  assert.equal(row.max_ms,101);assert.equal(row.recent_p95_ms,1);
  p.resetMeasurements();assert.deepEqual(p.summary(),{});p.dispose();
});


test('CPU frame snapshots include same-frame nested physics and exclude delayed GPU results and between-frame work',context=>{
  let now=0;context.mock.method(performance,'now',()=>now);
  const {profiler:p}=fixture();p.captureCpuFrame=true;p.beginFrame(0);
  p.measure('Simulation CPU',()=>{p.record('Physics panels',4);now=10;});
  p.record('GPU main color',50);now=12;p.endFrame();
  const frame=p.frameTimings();assert.equal(frame['Simulation CPU'],10);assert.equal(frame['Physics panels'],4);assert.equal(frame['Render callback CPU'],12);assert.equal(frame['GPU main color'],undefined);
  p.record('Outside CPU',99);assert.deepEqual(p.frameTimings(),frame);
  now=20;p.beginFrame(16);p.endFrame();assert.equal(p.frameTimings()['Physics panels'],undefined);assert.equal(p.frameTimings()['RAF scheduling delay (wall)'],4);
  p.captureCpuFrame=false;p.beginFrame(20);p.record('Physics panels',8);p.endFrame();assert.deepEqual(p.frameTimings(),{});p.dispose();
});
