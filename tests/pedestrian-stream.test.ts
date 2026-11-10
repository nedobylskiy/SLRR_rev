import {test} from 'node:test';import assert from 'node:assert/strict';import {Vector3} from 'three';
import {PedestrianSpawnIndex} from '../src/engine/pedestrian-stream';import type {PedestrianWalk} from '../src/formats/pedestrian';
const row:PedestrianWalk={id:1,box:[0,0,0,200,3,4],origin:[0,0,0,0],width:0,tag:4,links:[],records:[{kind:22,id:2,quad:[0,0,0,4],child:{kind:23,points:[[0,0,0],[200,0,0]]}},{kind:22,id:3,quad:[200,0,200,4],child:{kind:23,points:[[200,0,4],[0,0,4]]}}]};
test('pedestrian streaming samples real zones, prefers blind spawns and never fills unsafe space',()=>{
 const index=new PedestrianSpawnIndex([row]),focus=new Vector3(100,0,2),spawn=index.choose(focus,80,[],p=>p.x<100,()=>0);assert.ok(spawn);assert.ok(spawn.position.x<100);assert.ok(spawn.position.distanceTo(focus)>=12&&spawn.position.distanceTo(focus)<=80);
 const visible=index.choose(focus,80,[],()=>false,()=>0);assert.ok(visible);assert.ok(visible.position.distanceTo(focus)>=35);
 assert.equal(index.choose(focus,10,[],()=>true),undefined);
 assert.equal(index.choose(focus,80,[{position:focus,radius:200}],()=>true),undefined);
 const walker=index.walker(spawn,()=>.5);assert.ok(walker.position.distanceTo(spawn.position)<1e-6);assert.equal(walker.zone.id,1);
 const moved=index.choose(new Vector3(20,0,2),70,[],()=>true,()=>0);assert.ok(moved);assert.ok(moved.position.x<90);assert.equal(index.zones[0],spawn.zone);
});
