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
