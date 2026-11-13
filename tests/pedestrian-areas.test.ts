import test from 'node:test';import assert from 'node:assert/strict';import {Vector3} from 'three';
import {AreaWalker,PedestrianAreas} from '../src/engine/pedestrian-areas';
import {pedestrianRun} from '../src/engine/pedestrian-run';
import {pedestrianFloor,type PedestrianWalk} from '../src/formats/pedestrian';
function row(id:number,x:number,left:number,right:number):PedestrianWalk{return {id,origin:[0,0],height:0,slopeX:0,slopeZ:0,box:[x,0,0,x+20,3,4],links:[],records:[
  {kind:21,id:-1,quad:[x,0,x+20,0]},{kind:22,id:right,quad:[x+20,0,x+20,4]},
  {kind:21,id:-1,quad:[x+20,4,x,4]},{kind:22,id:left,quad:[x,4,x,0]},
]};}
test('free walkers cross explicit gates, retain heading and cannot leave through walls',()=>{
  const a=row(1,0,-1,2),b=row(2,20,1,-1),network=new PedestrianAreas([a,b]);
  const w=new AreaWalker(network,{id:1},new Vector3(10,0,2),new Vector3(1,0,0));
  for(let i=0;i<450;i++){w.step(1/30,[]);assert.ok(w.position.z>=.3-1e-5&&w.position.z<=3.7+1e-5);}
  assert.equal(w.zone.id,2);assert.ok(w.position.x>22,'walker continues beyond the seam');
  for(let i=0;i<2000;i++){w.step(1/30,[]);assert.ok(w.position.x>=.3-1e-5&&w.position.x<=39.7+1e-5);assert.ok(w.ok);}
});
test('junction height uses the authored slope and fast cars trigger avoidance before reaching the pedestrian',()=>{
  const area=row(1,0,-1,-1);area.origin=[100,200];area.height=12;area.slopeX=.1;area.slopeZ=.2;
  area.records.forEach(r=>{if(r.quad){r.quad[0]-=100;r.quad[1]-=200;r.quad[2]-=100;r.quad[3]-=200;}});
  assert.ok(Math.abs(pedestrianFloor(area,10,2)+36.6)<1e-6);
  area.origin=[0,0];area.height=0;area.slopeX=area.slopeZ=0;area.records=row(1,0,-1,-1).records;
  const network=new PedestrianAreas([area]),w=new AreaWalker(network,{id:1},new Vector3(10,0,2),new Vector3(1,0,0));
  w.step(.05,[{position:new Vector3(-30,0,2),velocity:new Vector3(15,0,0)}]);assert.ok(w.fleeing);assert.ok(w.position.z>2);
});
test('run Hermite curves preserve corners smoothly and ignore stored tangent magnitudes',()=>{
  const base={kind:23 as const,points:[[0,0,0],[10,2,10]],directions:[[100,0,0],[0,0,200]]};
  const curve=pedestrianRun(base),unit=pedestrianRun({...base,directions:[[1,0,0],[0,0,1]]});
  assert.deepEqual(curve.map(p=>p.toArray()),unit.map(p=>p.toArray()));
  assert.deepEqual(curve[0].toArray(),[0,0,0]);assert.deepEqual(curve.at(-1)!.toArray(),[10,2,10]);
  assert.ok(curve.some(p=>Math.abs(p.x-p.z)>1),'curve does not use a straight chord through the street');
});
