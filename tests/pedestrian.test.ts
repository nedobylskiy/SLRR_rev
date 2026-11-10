import {test} from 'node:test';import assert from 'node:assert/strict';
import {parsePedestrianWalk,parsePedestrianRest} from '../src/formats/pedestrian';
import {MapPedestrianDebug} from '../src/render/map-pedestrian-debug';import {Group} from 'three';
const words=(values:number[],floats=false)=>{const b=Buffer.alloc(values.length*4);values.forEach((v,i)=>floats?b.writeFloatLE(v,i*4):b.writeUInt32LE(v,i*4));return b;};
function walk(link=1){const body=Buffer.concat([words([0,0,3,3,1],true),words([3,23,3]),...Array.from({length:4},(_,i)=>words([i,0,i,1,0,1],true)),words([0,0,3,3],true),words([0xffffffff,1,link])]);const data=Buffer.concat([words([body.length]),body]);return `0,0,0,3,2,3 1;${[...data].map(b=>String.fromCharCode(65+(b>>4),65+(b&15))).join('')}`;}
test('pedestrian AI decodes framed sidewalk directions, links and rest groups, rejecting broken records',()=>{
 const lines=parsePedestrianWalk(walk());assert.equal(lines.length,1);assert.deepEqual(lines[0].links,[1]);assert.deepEqual(lines[0].records[0].points?.[3],[3,0,3]);assert.deepEqual(lines[0].records[0].directions?.[0],[1,0,1]);
 assert.throws(()=>parsePedestrianWalk(walk(2)),/outside/);assert.throws(()=>parsePedestrianWalk(walk()+'Z'),/nibble/);assert.throws(()=>parsePedestrianWalk(walk()+'AA'),/length/);assert.throws(()=>parsePedestrianWalk(walk()+'\n'+walk()),/Duplicate/);
 const rest=parsePedestrianRest('0,0,0,3,2,3 1;1,0\n4,0,0,6,2,3 2;1,0');assert.deepEqual(rest.map(r=>r.area),[1,2]);assert.throws(()=>parsePedestrianRest('0,0,0,3,2,3 1;2,0'),/payload/);assert.throws(()=>parsePedestrianRest('3,0,0,0,2,3 1;1,0'),/bounds/);
 const scene=new Group(),debug=new MapPedestrianDebug(scene,lines,rest);assert.equal(debug.graph.visible,false);debug.show('graph',true);debug.show('rest',true);assert.ok(debug.graph.visible&&debug.rest.visible);debug.dispose();assert.equal(scene.children.length,0);
});
