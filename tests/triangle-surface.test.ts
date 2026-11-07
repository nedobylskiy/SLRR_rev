import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Vector3 } from 'three';
import { TriangleSurface, createContactProfile } from '../src/engine/triangle-surface';
import { DeformablePanel } from '../src/engine/deformable-panel';

const plane = [-10, 0.5, -10, 10, 0.5, -10, 10, 0.5, 10, -10, 0.5, -10, 10, 0.5, 10, -10, 0.5, 10];
const surface = () => new TriangleSurface(plane, () => true, () => new Vector3(), () => {});
test('refit moves contacts outside old BVH bounds and invalidates cached candidates', () => {
  const s = surface(), old = new Float64Array([0, 1, 0]), p = new Float64Array([0, -1, 0]);
  assert.ok(s.project(p, old, 0));
  const moved = plane.map((v, i) => v + (i % 3 === 0 ? 30 : 0)); s.refit(moved);
  p.set([0, -1, 0]); assert.equal(s.project(p, old, 0), undefined);
  old.set([30, 1, 0]); p.set([30, -1, 0]); assert.ok(s.project(p, old, 0));
  const rebuilt = new TriangleSurface(moved, () => true, () => new Vector3(), () => {}), expected = new Float64Array([30, -1, 0]);
  rebuilt.project(expected, old, 0); assert.deepEqual(p, expected);
  assert.throws(() => s.refit(moved.slice(3)), /topology/);
  assert.throws(() => s.refit(moved.map((v, i) => i === 0 ? NaN : v)), /Invalid/);
});

test('refit can revive an initially degenerate face', () => {
  const s = new TriangleSurface([...plane, ...Array(9).fill(0)], () => true, () => new Vector3(), () => {});
  s.refit([...plane, 29, 2, -1, 31, 2, -1, 30, 2, 1]);
  const p = new Float64Array([30, 0, 0]); assert.ok(s.project(p, new Float64Array([30, 3, 0]), 0)); assert.ok(p[1] > 2);
});
test('triangle contact is two-sided, swept, bounded and cannot flip sides from inside its contact shell', () => {
  const s = surface(); s.setFrames(new Matrix4(), new Matrix4());
  for (const [fromY, toY, sign] of [[1, -4, 1], [0, 4, -1], [0.52, 0.2, 1]]) {
    const p = new Float64Array([0, toY, 0]), old = new Float64Array([0, fromY, 0]);
    const contact = s.project(p, old, 0); assert.ok(contact); assert.equal(Math.sign(contact.normal[1]), sign); assert.ok(Math.abs(p[1] - (0.5 + sign * s.radius)) < 1e-10);
  }
  assert.equal(s.project(new Float64Array([12, -1, 0]), new Float64Array([12, 1, 0]), 0), undefined);
});

test('moving body frame sweeps against a stationary world point', () => {
  const s = surface(); s.setFrames(new Matrix4(), new Matrix4().makeTranslation(0, 1, 0));
  const p = new Float64Array([0, 1, 0]); const contact = s.project(p, p.slice(), 0);
  assert.ok(contact); assert.ok(Math.abs(p[1] - (1.5 + s.radius)) < 1e-10);
});

test('a diagonal high-speed sweep stops on the finite triangle, not beyond its edge', () => {
  const s = new TriangleSurface([-1, 0, -1, 1, 0, -1, 0, 0, 1], () => true, () => new Vector3(), () => {});
  const p = new Float64Array([8, -8, 0]); assert.ok(s.project(p, new Float64Array([0, 0.1, 0]), 0));
  assert.ok(p[0] < 0.1); assert.ok(p[1] >= s.radius - 1e-10);
});

test('a free panel bounces, transfers opposite impulse and remains supported above a roof', () => {
  const p = new DeformablePanel([-0.7, 1.3, -0.7, 0.7, 1.3, -0.7, -0.7, 1.3, 0.7, 0.7, 1.3, 0.7], { mass: 38.5, mount: [0, 1.3, 0.7], yieldStrain: 100 });
  p.mounts.forEach(m => { m.broken = true; }); let reactionY = 0, peakUpward = 0;
  const s = new TriangleSurface(plane, () => true, () => new Vector3(), j => { reactionY -= j[1]; }); s.setFrames(new Matrix4(), new Matrix4()); p.surfaces.push(s);
  for (let i = 1; i < p.velocities.length; i += 3) p.velocities[i] = -3;
  for (let tick = 0; tick < 720; tick++) { p.advance(1 / 240); const mean = p.velocities.filter((_, i) => i % 3 === 1).reduce((a, b) => a + b, 0) / (p.velocities.length / 3); if (s.hits) peakUpward = Math.max(peakUpward, mean); }
  assert.ok(peakUpward > 0.1); assert.ok(reactionY < -10); assert.ok(s.hits > 0);
  for (let i = 1; i < p.positions.length; i += 3) assert.ok(p.positions[i] >= 0.5 + s.radius - 1e-6);
});


test('inactive detached triangle slots leave BVH bounds and cached contacts without rebuilding, and can be restored',()=>{
  const other=plane.map((v,i)=>v+(i%3===0?30:i%3===1?2:0));
  const s=new TriangleSurface([...plane,...other],()=>true,()=>new Vector3(),()=>{}),tree=(s as any).tree;
  const old=new Float64Array([30,4,0]),p=new Float64Array([30,0,0]);assert.ok(s.project(p,old,0));
  s.refit([...plane,...other.map(()=>0)]);assert.equal((s as any).tree,tree);
  p.set([30,0,0]);assert.equal(s.project(p,old,0),undefined,'removed triangles cannot collide through cached candidates');
  assert.ok((s as any).tree.bounds.max.x<=10,'inactive faces do not expand the root bounds');
  assert.ok(Math.abs(s.roofPoint().y-.5)<1e-10);
  const live=new Float64Array([0,0,0]);assert.ok(s.project(live,new Float64Array([0,2,0]),0));
  s.refit([...plane,...other]);p.set([30,0,0]);assert.ok(s.project(p,old,0));assert.equal((s as any).tree,tree);
});


test('partial refit updates sparse triangle ranges and ancestor bounds with the same contacts as a full refit',()=>{
  const coords:number[]=[];for(let i=0;i<32;i++)coords.push(i*3,0,0,i*3+1,0,0,i*3,0,1);
  const sparse=new TriangleSurface(coords,()=>true,()=>new Vector3(),()=>{}),full=new TriangleSurface(coords,()=>true,()=>new Vector3(),()=>{});
  const moved=coords.slice();moved.fill(0,3*9,4*9);
  for(let k=17*9;k<18*9;k++)moved[k]+=k%3===0?100:k%3===1?2:0;
  sparse.refit(moved,[{start:3*9,count:9},{start:17*9,count:9}]);full.refit(moved);
  assert.equal(sparse.lastRefitTriangles,2);assert.ok(sparse.lastRefitBranches<full.lastRefitBranches);
  assert.deepEqual((sparse as any).tree.bounds,(full as any).tree.bounds);
  for(const x of [.2,9.2,51.2,151.2,93.2]){
    const a=new Float64Array([x,-1,.2]),b=a.slice(),previous=new Float64Array([x,4,.2]);
    assert.equal(!!sparse.project(a,previous,0),!!full.project(b,previous,0));assert.deepEqual(a,b);
  }
  const bounds=(sparse as any).tree.bounds.clone();
  assert.throws(()=>sparse.refit(coords,[{start:0,count:9},{start:1,count:9}]),/range/);assert.deepEqual((sparse as any).tree.bounds,bounds);
  sparse.refit(moved,[]);assert.equal(sparse.lastRefitTriangles,0);assert.equal(sparse.lastRefitBranches,0);
});


test('contact profiling counts BVH work and cache reuse without changing projections',()=>{
  const measured=surface(),baseline=surface(),profile=createContactProfile();measured.profile=profile;
  const previous=new Float64Array([0,1,0]);
  for(let i=0;i<64;i++){
    const a=new Float64Array([0,-1,0]),b=a.slice();
    const hit=measured.project(a,previous,0),expected=baseline.project(b,previous,0);
    assert.deepEqual(a,b);assert.deepEqual(hit?.normal,expected?.normal);
  }
  assert.equal(profile.queries,64);assert.equal(profile.hits,64);
  assert.equal(profile.cacheMisses,1);assert.equal(profile.cacheHits,63);
  assert.equal(profile.branches,1);assert.equal(profile.leaves,1);assert.equal(profile.faceBounds,2);
  assert.equal(profile.candidates,128);assert.equal(profile.triangleTests,128);
  assert.equal(profile.timedQueries,2);assert.equal(profile.timedCacheMisses,1);
  for(const key of ['queryMs','traversalMs','narrowMs'] as const)assert.ok(Number.isFinite(profile[key])&&profile[key]>=0);
  measured.refit(plane);measured.project(new Float64Array([0,-1,0]),previous,0);
  assert.equal(profile.cacheMisses,2,'geometry revision forces a new tree query');
  const saved={...profile};measured.profile=undefined;measured.project(new Float64Array([0,-1,0]),previous,0);
  assert.deepEqual(profile,saved,'normal gameplay does not collect counters or timers');
});
