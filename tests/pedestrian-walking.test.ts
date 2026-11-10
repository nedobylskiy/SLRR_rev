import test from 'node:test';import assert from 'node:assert/strict';import {Vector3} from 'three';
import {buildWalkingZones,spawnWalkingPedestrians,WalkingPedestrian,zonePoint} from '../src/engine/pedestrian-walking';
import {transitionWallClearance,constrainedTransition,insideTransition} from '../src/engine/pedestrian-transition';
import type {PedestrianWalk} from '../src/formats/pedestrian';
const corridor=(id:number,start:number,end:number,z=0):PedestrianWalk=>({id,box:[0,0,z,20,3,z+2],origin:[0,0,0,0],width:0,tag:4,links:[],records:[{kind:22,id:start,quad:[0,z,0,z+2],child:{kind:23,points:[[0,0,z],[20,0,z]]}},{kind:22,id:end,quad:[20,z,20,z+2],child:{kind:23,points:[[20,0,z+2],[0,0,z+2]]}}]});
test('paired boundaries stay inside the walking zone and car avoidance reverses a walker away from the car',()=>{
 const rows=[corridor(1,10,20)],zones=buildWalkingZones(rows);assert.equal(zones.length,1);assert.equal(zonePoint(zones[0],.5).x,10);
 const walker=new WalkingPedestrian(zones[0],.5,1,.5,zones,new Map(),()=>.5),x=walker.position.x;
 walker.step(.1,[new Vector3(x+3,0,1)]);assert.equal(walker.fleeing,true);assert.equal(walker.sign,-1);assert.ok(walker.position.x<x);
 for(let i=0;i<200;i++){walker.step(.1,[]);assert.ok(walker.position.x>=0&&walker.position.x<=20);assert.equal(walker.position.z,1);}
 assert.deepEqual(spawnWalkingPedestrians([],new Vector3()),[]);
});
test('crossing transitions follow explicit junction links on a continuous curve',()=>{
 const a=corridor(1,10,20),b=corridor(2,20,30,8);
 // Second corridor joins the first at its x=20 end.
 b.records[0].id=30;b.records[1].id=20;
 const junction:PedestrianWalk={id:20,box:[0,0,0,20,3,10],origin:[25,5,0,0],width:0,tag:4,records:[{kind:21,quad:[-5.5,-5,1,-5]},{kind:22,id:2,quad:[1,-5,1,5]},{kind:21,quad:[1,5,-5.5,5]},{kind:22,id:1,quad:[-5.5,5,-5.5,-5]}],links:[1,2]},zones=buildWalkingZones([a,b,junction]);
 const walker=new WalkingPedestrian(zones[0],.999,1,.5,zones,new Map([[20,junction]]),()=>.5);
 for(let i=0;i<5&&!walker.transition;i++)walker.step(.1,[]);assert.ok(walker.transition);assert.equal(walker.transition.target.id,2);
 let last=walker.position.clone(),curved=false;
 for(let i=0;i<150&&walker.zone.id!==2;i++){const polygon=walker.transition?.polygon;walker.step(.1,[]);if(polygon)assert.ok(insideTransition(walker.position,polygon));assert.ok(walker.position.distanceTo(last)<.4);curved ||=walker.position.x>20.01;last.copy(walker.position);}
 assert.equal(walker.zone.id,2);assert.equal(curved,true);assert.equal(walker.sign,-1);
});

test('a concave transition follows its walls instead of cutting through the outside and preserves endpoint heights',()=>{
 const vertices=[[100,200],[106,200],[106,202],[102,202],[102,206],[100,206]];
 const row:PedestrianWalk={id:1,box:[100,0,200,106,3,206],origin:[103,203,0,0],width:0,tag:4,links:[],records:vertices.map((p,i)=>({kind:21,quad:[p[0]-103,p[1]-203,vertices[(i+1)%vertices.length][0]-103,vertices[(i+1)%vertices.length][1]-203]}))};
 const from=new Vector3(105,4,201),to=new Vector3(101,6,205),route=constrainedTransition(row,from,to);assert.ok(route);
 assert.deepEqual(route.points[0].toArray(),from.toArray());assert.deepEqual(route.points.at(-1)!.toArray(),to.toArray());
 for(let i=1;i<route.points.length;i++)for(let j=0;j<=20;j++)assert.ok(insideTransition(route.points[i-1].clone().lerp(route.points[i],j/20),route.polygon));
 assert.equal(constrainedTransition({...row,records:[]},from,to),undefined);
 assert.equal(constrainedTransition(row,new Vector3(105,0,205),to),undefined);
});

test('escaping during a transition reverses the same bounded path without a position jump',()=>{
 const a=corridor(1,10,20),b=corridor(2,30,20,8),junction:PedestrianWalk={id:20,box:[20,0,0,26,3,10],origin:[25,5,0,0],width:0,tag:4,records:[{kind:21,quad:[-5.5,-5,1,-5]},{kind:22,id:2,quad:[1,-5,1,5]},{kind:21,quad:[1,5,-5.5,5]},{kind:22,id:1,quad:[-5.5,5,-5.5,-5]}],links:[1,2]};
 const zones=buildWalkingZones([a,b]),walker=new WalkingPedestrian(zones[0],1,1,.5,zones,new Map([[20,junction]]),()=>.5);
 walker.step(.1,[]);assert.ok(walker.transition);for(let i=0;i<10;i++)walker.step(.1,[]);
 const tr=walker.transition!,before=walker.position.clone(),car=tr.to.clone();walker.step(.1,[car]);
 assert.equal(walker.transition!.target.id,1);assert.ok(walker.position.distanceTo(before)<.4);assert.ok(insideTransition(walker.position,tr.polygon));
 for(let i=0;i<100&&walker.transition;i++){walker.step(.1,[]);assert.ok(insideTransition(walker.position,tr.polygon));}
 assert.equal(walker.zone.id,1);assert.equal(walker.transition,undefined);
});

test('walkers keep 30 cm from corridor sides while blue gates remain passable',()=>{
 const row=corridor(1,10,20),zone=buildWalkingZones([row])[0];
 // Narrow the corridor to one metre; the earlier percentage clamp allowed 15 cm.
 zone.sides[1].points.forEach(p=>p.z=1);
 assert.ok(Math.abs(zonePoint(zone,.5,0).z-.3)<1e-8);assert.ok(Math.abs(zonePoint(zone,.5,1).z-.7)<1e-8);
 const junction:PedestrianWalk={id:2,box:[100,0,200,110,3,204],origin:[105,202,0,0],width:0,tag:4,links:[],records:[{kind:21,quad:[-5,-2,5,-2]},{kind:22,id:3,quad:[5,-2,5,2]},{kind:21,quad:[5,2,-5,2]},{kind:22,id:1,quad:[-5,2,-5,-2]}]};
 const route=constrainedTransition(junction,new Vector3(100,0,202),new Vector3(110,0,202));assert.ok(route,'offset walls must not close entry/exit spans');
 for(const p of route.points)assert.ok(transitionWallClearance(p,junction)>=.3-1e-6);
});

const cell=(id:number,left:number,right:number,x:number):PedestrianWalk=>({id,box:[x,0,0,x+3,3,2],origin:[x+1.5,1,0,0],width:0,tag:4,links:[left,right],records:[{kind:21,quad:[-1.5,-1,1.5,-1]},{kind:22,id:right,quad:[1.5,-1,1.5,1]},{kind:21,quad:[1.5,1,-1.5,1]},{kind:22,id:left,quad:[-1.5,1,-1.5,-1]}]});
function translate(row:PedestrianWalk,x:number){for(const r of row.records){if(r.quad){r.quad[0]+=x;r.quad[2]+=x;}r.child?.points?.forEach(p=>p[0]+=x);}return row;}
test('a forward goal crosses successive yellow cells and their doubled blue seams without turning back',()=>{
 const a=corridor(1,9,10),b=translate(corridor(2,11,30),26),first=cell(10,1,11,20),second=cell(11,10,2,23),rows=[a,b,first,second],zones=buildWalkingZones(rows);
 const walker=new WalkingPedestrian(zones[0],.99,1,.75,zones,new Map(rows.map(r=>[r.id,r])),()=>.5);
 for(let i=0;i<20&&!walker.transition;i++)walker.step(.1,[]);assert.ok(walker.transition);assert.deepEqual(walker.transition.via,[10,11]);
 let previous=walker.position.clone(),enteredSecond=false;
 for(let i=0;i<100&&walker.zone.id!==2;i++){const polygons=walker.transition?.polygons;walker.step(.1,[]);if(polygons)assert.ok(polygons.some(p=>insideTransition(walker.position,p)));assert.ok(walker.position.distanceTo(previous)<.4);assert.ok(walker.position.x>=previous.x-1e-6);enteredSecond ||=walker.position.x>23;previous.copy(walker.position);}
 assert.ok(enteredSecond);assert.equal(walker.zone.id,2);assert.equal(walker.sign,1);assert.equal(walker.transition,undefined);
});
test('forward continuation wins over a backward exit regardless of random branch selection',()=>{
 const a=corridor(1,9,10),ahead=translate(corridor(2,10,30),23),back=corridor(3,40,10,2),junction=cell(10,1,2,20);junction.records[2]={kind:22,id:3,quad:[1.5,1,-1.5,1]};const rows=[a,ahead,back,junction],zones=buildWalkingZones(rows);
 const walker=new WalkingPedestrian(zones[0],1,1,.5,zones,new Map(rows.map(r=>[r.id,r])),()=>0);walker.step(.1,[]);assert.equal(walker.transition?.target.id,2);
});
