import {insideTransition} from '../src/engine/pedestrian-transition';
import {buildWalkingZones,spawnWalkingPedestrians} from '../src/engine/pedestrian-walking';
import {PedestrianCrowd} from '../src/render/pedestrian-crowd';
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import path from 'node:path';import {Texture,Vector3} from 'three';
import {Assets} from '../src/assets';import {loadMapPedestrians} from '../src/engine/map-pedestrians';import {bootGame} from '../src/runtime/game-boot';import {loadSkinnedCharacter} from '../src/render/skinned-character';import type {RenderObject} from '../src/runtime/render-object';import {gameRoot,walk,relativeGamePath} from './game-files';
const init=`package java.game; import java.util.resource.*; public class Init extends GameType { public Init(int id) {
  Spectator spectator = new Spectator(new ResourceRef(0), humans:0x002fr, humans:0x0014r, new Vector3(10,2,30), new Ypr(0.25,0,0), "pedestrian_verify"); spectator.beginAnim();
} }`;
const files=await walk(gameRoot),assets=new Assets(files.map(file=>({path:relativeGamePath(file),size:0})),async file=>file.toLowerCase()==='sl/scripts/game/src/init.java'?new TextEncoder().encode(init):new Uint8Array(await readFile(path.join(gameRoot,file))));
const data=await loadMapPedestrians(assets,'maps/city.rpk');assert.ok(data);assert.equal(data.walk.length,1799);assert.equal(data.rest.length,755);
const walkers=spawnWalkingPedestrians(data.walk,new Vector3());assert.equal(walkers.length,6);
let transitions=0;
for(let frame=0;frame<6000;frame++)for(const walker of walkers){const before=walker.position.clone(),was=!!walker.transition,polygon=walker.transition?.polygon;walker.step(.1,[]);if(polygon)assert.ok(insideTransition(walker.position,polygon),'stock transition stays inside authored walls');assert.ok(before.distanceTo(walker.position)<.5,'walking route must not teleport');if(!was&&walker.transition)transitions++;}
assert.ok(transitions>0,'stock links must connect corridors');
const crowd=await PedestrianCrowd.create(assets,data.walk,new Vector3(),async()=>new Texture());
try{assert.equal(crowd.count,6);for(let t=0;t<=1000;t+=50)crowd.update(t,[new Vector3()]);}finally{crowd.dispose();}
console.log(JSON.stringify({walkingZones:buildWalkingZones(data.walk).length,walkers:walkers.length,transitions}));
const renders=new Map<number,RenderObject>(),result=await bootGame(assets,()=>{},undefined,node=>renders.set(node.id,node));
try{
  if(result.error)throw result.error;
  const spectators=[...renders.values()].filter(node=>node.alias==='pedestrian_verify');assert.equal(spectators.length,1,'original Java creates exactly one render instance');
  const node=spectators[0];assert.deepEqual(node.position,{x:10,y:2,z:30});assert.equal(node.orientation.y,.25);assert.equal(node.renderResource?.id,0x2f);assert.equal(node.animation?.id,0x14);assert.equal(node.animation?.loop,true);assert.equal(node.animation?.playing,true);assert.ok(node.animation!.speed>=.5&&node.animation!.speed<1.5);
  const character=await loadSkinnedCharacter(assets,async()=>new Texture(),node.renderResource!.pack,node.renderResource!.id);
  try{
    const {clip}=await character.loadOriginalClip(assets,node.animation!.id,false,node.animation!.pack);character.playClip(clip,true,true);character.setPlaybackSpeed(node.animation!.speed);
    const p=new Vector3();const sample=()=>character.meshes.flatMap(mesh=>Array.from({length:mesh.geometry.getAttribute('position').count},(_,i)=>mesh.getVertexPosition(i,p).toArray()).flat());
    const before=sample();character.update(0);for(let t=50;t<=500;t+=50)character.update(t);const after=sample();assert.ok(before.some((p,i)=>Math.abs(p-after[i])>1e-4),'original jitter changes weighted skin');
    console.log(JSON.stringify({walk:data.walk.length,rest:data.rest.length,spectators:spectators.length,position:node.position,render:node.renderResource,animation:node.animation,tracks:clip.tracks.length},null,2));
  }finally{character.dispose();}
}finally{result.dispose();}
