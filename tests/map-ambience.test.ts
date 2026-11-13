import test from 'node:test';import assert from 'node:assert/strict';import {Vector3} from 'three';
import {parsePartConfig} from '../src/formats/cfg';
import {MapAmbience,parseMapAmbience,ambientInWindow,ambientAudible,type AmbientVoice} from '../src/audio/map-ambience';
import {ambientSignalPeak} from '../src/audio/ambient-audio';
const flush=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
test('silent audio is detected across the complete sample without rejecting sparse or opposite-phase stereo',()=>{
  const samples=[new Float32Array(11025),new Float32Array(11025)],buffer={numberOfChannels:2,getChannelData:(channel:number)=>samples[channel]};
  assert.equal(ambientSignalPeak(buffer),0);
  samples[0][11024]=.25;samples[1][11024]=-.25;assert.equal(ambientSignalPeak(buffer),.25);
});
test('known silent resources do not consume voices or issue repeated play requests',async()=>{
  let requests=0,silent=false;
  const a=new MapAmbience({unavailable:()=>silent,play:async()=>{requests++;silent=true;return undefined;},pause:()=>{},dispose:()=>{}},()=>0);
  a.add('objects.rpk',new Vector3(),parseMapAmbience(parsePartConfig('sfx_loop 1')));
  a.update(0,new Vector3(),0);await flush();a.update(2000,new Vector3(),0);await flush();a.update(3000,new Vector3(),0);
  assert.equal(requests,1);assert.equal(a.stats.voices,0);a.dispose();
});
test('map ambient CFG keeps the last loop, sound resource namespace, random delays and wrapping hours',()=>{
  const c=parseMapAmbience(parsePartConfig('sfx_loop 0x10001 2 8 18\nsfx_loop 0x20002 5 18 8\nsfx_random 0x30003 10 5 20 4 21'));
  assert.equal(c.loop?.id,0x20002);assert.equal(c.randoms[0].min,5);assert.equal(c.randoms[0].max,20);
  assert.ok(ambientInWindow(c.loop!,23*3600));assert.ok(ambientInWindow(c.loop!,7*3600));assert.equal(ambientInWindow(c.loop!,8*3600),false);
  assert.ok(ambientAudible(250**2+5**2,5));assert.equal(ambientAudible(251**2,0),false);
});
test('ambient loops stop on range/hour changes and pending loads cannot resurrect an old world',async()=>{
  const calls:{id:number;voice:AmbientVoice}[]=[];let paused=false;
  const output={play:async(_pack:string,id:number)=>{let stopped=false;const voice={stop:()=>{stopped=true;},ended:()=>stopped};calls.push({id,voice});return voice;},pause:(p:boolean)=>{paused=p;},dispose:()=>{}};
  const a=new MapAmbience(output,()=>0),c=parseMapAmbience(parsePartConfig('sfx_loop 1 0 8 18'));
  a.add('objects.rpk',new Vector3(),c);a.update(0,new Vector3(),9*3600);await flush();assert.equal(calls.length,1);
  a.update(500,new Vector3(),20*3600);assert.ok(calls[0].voice.ended());
  a.update(1500,new Vector3(),10*3600);await flush();assert.equal(calls.length,2);
  a.update(2000,new Vector3(1000,0,0),10*3600);assert.ok(calls[1].voice.ended());
  a.update(2500,new Vector3(),10*3600,0);assert.equal(paused,true);assert.equal(calls.length,2);a.dispose();
  let resolve!:(v:AmbientVoice)=>void;let stopped=false;
  const b=new MapAmbience({...output,play:()=>new Promise(r=>{resolve=r;})});b.add('x',new Vector3(),c);b.update(0,new Vector3(),10*3600);b.dispose();resolve({stop:()=>{stopped=true;},ended:()=>stopped});await flush();assert.ok(stopped);
});
test('nearby random emitters share a bounded voice budget and duplicate-cue coalescing',async()=>{
  let requests=0;const a=new MapAmbience({play:async()=>{requests++;return {stop:()=>{},ended:()=>false};},pause:()=>{},dispose:()=>{}},()=>0);
  const config=parseMapAmbience(parsePartConfig('sfx_random 1 0 0 0'));
  for(let i=0;i<10000;i++)a.add('objects.rpk',new Vector3(i*10,0,0),config);
  for(let now=0;now<4000;now+=250){a.update(now,new Vector3(),0);await flush();}
  assert.equal(requests,2,'no more than two copies of one random cue');assert.ok(a.stats.nearby<30,'distant emitters are excluded by the spatial index');a.dispose();
});
