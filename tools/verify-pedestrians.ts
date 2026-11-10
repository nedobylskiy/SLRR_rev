import {RigidBody3D} from '../src/engine/rigid-body-3d';
import {Box3} from 'three';
import {setImmediate} from 'node:timers/promises';
import {insideTransition} from '../src/engine/pedestrian-transition';
import {WalkingPedestrian,buildWalkingZones,spawnWalkingPedestrians,zonePoint} from '../src/engine/pedestrian-walking';
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
for(let frame=0;frame<6000;frame++)for(const walker of walkers){const before=walker.position.clone(),was=!!walker.transition,polygons=walker.transition?.polygons;walker.step(.1,[]);if(polygons)assert.ok(polygons.some(p=>insideTransition(walker.position,p)),'stock transition stays inside authored walls');assert.ok(before.distanceTo(walker.position)<.5,'walking route must not teleport');if(!was&&walker.transition)transitions++;}
assert.ok(transitions>0,'stock links must connect corridors');
const stockZones=buildWalkingZones(data.walk),chainWalker=new WalkingPedestrian(stockZones.find(z=>z.id===2)!,1,1,.75,stockZones,new Map(data.walk.map(r=>[r.id,r])),()=>.5);
chainWalker.step(.1,[]);assert.deepEqual(chainWalker.transition?.via,[198,199],'adjacent yellow cells are a route, not a dead end');
for(let i=0;i<300&&chainWalker.zone.id===2;i++){const polygons=chainWalker.transition?.polygons,before=chainWalker.position.clone();chainWalker.step(.1,[]);assert.ok(before.distanceTo(chainWalker.position)<.4);if(polygons)assert.ok(polygons.some(p=>insideTransition(chainWalker.position,p)));}
assert.equal(chainWalker.zone.id,200);
const crowd=await PedestrianCrowd.create(assets,data.walk,new Vector3(),async()=>new Texture());
try{
  assert.equal(crowd.count,6);for(let t=0;t<=1000;t+=50)crowd.update(t,[]);
  const feet=crowd.inspectionPoint!,car=new RigidBody3D(1200,new Box3(new Vector3(-1,0,-2),new Vector3(1,1.4,2)));
  car.position.copy(feet).add(new Vector3(-3,.7,0));car.velocity.set(30,0,0);crowd.update(1000,[car]);
  car.position.x+=6;crowd.update(1100,[car]);for(let i=0;i<10&&!crowd.ragdollCount;i++)await setImmediate();
  assert.ok(crowd.ragdollCount>0,'a swept car contact activates an original pedestrian ragdoll');
  const start=crowd.inspectionPoint!;for(let i=1;i<=120;i++){car.position.addScaledVector(car.velocity,1/60);crowd.update(1100+i*1000/60,[car]);}
  assert.ok(car.velocity.x>24,'a yielding pedestrian must not stop the car like a post');
  assert.ok(crowd.inspectionPoint!.distanceTo(start)>1,'impact moves the body instead of following its old graph');
  console.log(JSON.stringify({contactRagdolls:crowd.ragdollCount,displacement:crowd.inspectionPoint!.distanceTo(start)}));
  const cached=crowd.cachedCount,relocation=zonePoint(buildWalkingZones(data.walk).find(zone=>zonePoint(zone,.5).distanceTo(feet)>600)!, .5);
  crowd.configure(3,100);
  for(let i=0;i<10;i++){crowd.update(4000+i*300,[],relocation,()=>true);await setImmediate();assert.ok(crowd.count<=3);}
  assert.ok(crowd.count>0,'stream refills near a moved player');assert.ok(crowd.inspectionPoint!.distanceTo(relocation)<=150);assert.equal(crowd.cachedCount,cached,'stream reuses loaded actors and skeletons');
  crowd.configure(0,100);crowd.update(8000,[],relocation);assert.equal(crowd.count,0);assert.equal(crowd.ragdollCount,0);
  console.log(JSON.stringify({streamingPool:cached,relocated:true,zeroDensity:true,carSpeedAfterContact:car.velocity.x}));

}finally{crowd.dispose();}
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
