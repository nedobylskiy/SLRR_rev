import test from 'node:test';
import assert from 'node:assert/strict';
import {FramePacer,autoPacingLevels,pacingLevels,parseFramePacing} from '../src/render/frame-pacer';

const REFRESH=1000/60;
/** A fixed-refresh display: a rendered frame taking `work` ms delays the next callback to the next vsync after it. */
function run(pacer:FramePacer,frames:number,work:(i:number)=>number){
  let vsync=0,i=0;const rendered:number[]=[];
  while(rendered.length<frames){
    const now=vsync*REFRESH;
    if(pacer.shouldRender(now)){const ms=work(i++);rendered.push(now);pacer.recordWork(ms);vsync+=Math.max(1,Math.ceil(ms/REFRESH-1e-9));}
    else vsync++;
  }
  return rendered.slice(1).map((t,k)=>Math.round(t-rendered[k]));
}

test('frames that miss 60 Hz settle on an even 30 fps cadence instead of a 17/33 ms mix',()=>{
  const pacer=new FramePacer();
  const uneven=run(new FramePacer(),60,i=>i%3?14:22);pacer.setMode('vsync');
  assert.ok(new Set(run(pacer,60,i=>i%3?14:22)).size>1,'unpaced frames alternate between one and two refreshes');
  assert.ok(new Set(uneven).size>1);
  const auto=new FramePacer();
  const gaps=run(auto,200,i=>i%3?14:22).slice(-100);
  assert.deepEqual([...new Set(gaps)],[33],'auto keeps every gap at two refreshes');
  assert.ok(Math.abs(auto.refreshInterval-REFRESH)<.01);
});

test('auto pacing returns to 60 fps after a long clean run and keeps 60 fps when frames fit',()=>{
  const fits=new FramePacer();
  assert.deepEqual([...new Set(run(fits,120,()=>8))],[17]);
  const pacer=new FramePacer();
  run(pacer,100,()=>24);
  assert.equal(pacer.period,2);
  const gaps=run(pacer,400,()=>6).slice(-60);
  assert.equal(pacer.period,1);assert.deepEqual([...new Set(gaps)],[17]);
});

test('fixed 30 fps mode and too-slow frames never pace below 30 fps',()=>{
  const fixed=new FramePacer();fixed.setMode('fps:30');
  assert.deepEqual([...new Set(run(fixed,60,()=>5).slice(5))],[33]);
  const slow=new FramePacer();
  run(slow,200,()=>45);
  assert.equal(slow.period,2,'a 50 ms cadence is worse than an occasional miss at 30 fps');
});

test('late, jittered callback stamps never push auto pacing below 30 fps and it recovers to 60',()=>{
  // Under load Chrome stamps a late callback with its real start, then the next on the vsync: short gaps.
  const pacer=new FramePacer();let vsync=0,i=0,late=0;const rendered:number[]=[];
  while(rendered.length<650){
    const now=vsync*REFRESH+late;late=0;
    if(pacer.shouldRender(now)){const ms=i++<250?22:6;rendered.push(now);pacer.recordWork(ms);const next=Math.max(1,Math.ceil(ms/REFRESH-1e-9));vsync+=next;if(i%5===0){late=7;}}
    else vsync++;
  }
  assert.ok(Math.abs(pacer.refreshInterval-REFRESH)<.5,`refresh stays 60 Hz (estimated ${pacer.refreshInterval.toFixed(2)} ms)`);
  const heavy=rendered.slice(60,240).map((t,k,a)=>k?t-a[k-1]:33).slice(1);
  assert.ok(heavy.every(gap=>gap<45),'never a 50 ms (20 fps) cadence while frames take 22 ms; 40 ms gaps are the simulated late stamps');
  assert.equal(pacer.period,1,'light frames bring back 60 fps');
});

test('frames of 13 ms that fit one refresh bring auto back to 60 fps after a heavy start',()=>{
  const pacer=new FramePacer();
  run(pacer,60,()=>24);
  assert.equal(pacer.period,2);
  const gaps=run(pacer,300,()=>13).slice(-100);
  assert.equal(pacer.period,1);assert.deepEqual([...new Set(gaps)],[17]);
});

test('a GPU-bound scene with light CPU work tries 60 fps, backs off, and stays mostly at an even 30',()=>{
  // The frame occupies two refreshes but reports only 8 ms of main-thread work.
  const pacer=new FramePacer();let vsync=0;const rendered:number[]=[];
  while(rendered.length<2000){const now=vsync*REFRESH;if(pacer.shouldRender(now)){rendered.push(now);pacer.recordWork(8);vsync+=2;}else vsync++;}
  const gaps=rendered.slice(200).map((t,k,a)=>k?t-a[k-1]:33).slice(1);
  const uneven=gaps.filter(gap=>Math.round(gap)!==33).length;
  assert.equal(uneven,0,'missing frames still land every two refreshes; only the target changes');
  assert.equal(pacer.period,2);
});

test('even levels follow the screen: 60 Hz offers 30/20/15, 144 Hz offers 72/48/36/29/24',()=>{
  const round=(levels:{fps:number}[])=>levels.map(l=>Math.round(l.fps));
  assert.deepEqual(round(pacingLevels(1000/60)),[30,20,15]);
  assert.deepEqual(round(pacingLevels(1000/144)),[72,48,36,29,24]);
  assert.deepEqual(autoPacingLevels(1000/60).map(Math.round),[60,30]);
  assert.deepEqual(autoPacingLevels(1000/144).map(Math.round),[144,72,48,36,29]);
  assert.equal(parseFramePacing('30'),'fps:30','the old fixed-30 setting still loads');
  assert.equal(parseFramePacing('fps:48'),'fps:48');assert.equal(parseFramePacing('junk'),undefined);
});

test('a fixed level on a 144 Hz screen renders on every third refresh, evenly',()=>{
  const R=1000/144,pacer=new FramePacer();pacer.setMode('fps:48');let vsync=0;const rendered:number[]=[];
  while(rendered.length<120){const now=vsync*R;if(pacer.shouldRender(now)){rendered.push(now);pacer.recordWork(4);}vsync++;}
  assert.ok(Math.abs(pacer.refreshRate-144)<1,`measures 144 Hz (got ${pacer.refreshRate.toFixed(1)})`);
  const gaps=rendered.slice(20).map((t,k,a)=>k?t-a[k-1]:0).slice(1).map(g=>g.toFixed(1));
  assert.deepEqual([...new Set(gaps)],[(3*R).toFixed(1)]);
});
