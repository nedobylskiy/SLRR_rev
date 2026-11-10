import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {Texture,Vector3} from 'three';
import {Assets} from '../src/assets';
import {loadCharacterCatalog,skeletonCompatibility} from '../src/render/character-catalog';
import {loadSkinnedCharacter} from '../src/render/skinned-character';
import {gameRoot,relativeGamePath,walk} from './game-files';

const files=await walk(gameRoot),assets=new Assets(files.map(file=>({path:relativeGamePath(file),size:0})),async file=>new Uint8Array(await readFile(path.join(gameRoot,file))));
const catalog=await loadCharacterCatalog(assets);
for(const model of catalog.models){
  const character=await loadSkinnedCharacter(assets,async()=>new Texture(),'humans.rpk',model.id);
  try{
    const animation=catalog.animations.find(a=>a.family===model.family&&!skeletonCompatibility(model.bones,a.bones));
    if(animation){const {clip}=await character.loadOriginalClip(assets,animation.id);character.playClip(clip,false);character.seek(clip.duration/3);}
    const before=character.skeleton.bones.map(b=>({p:b.position.clone(),q:b.quaternion.clone(),s:b.scale.clone()})),time=character.playbackTime;
    character.refresh();const bottom=Math.min(...character.meshes.map(m=>m.boundingBox!.min.y)),top=Math.max(...character.meshes.map(m=>m.boundingBox!.max.y));character.setRagdollFloor(bottom);
    await character.startRagdoll();assert.ok(character.isRagdoll);
    character.skeleton.bones.forEach((b,i)=>{assert.ok(b.position.distanceTo(before[i].p)<1e-10);assert.ok(Math.abs(b.quaternion.dot(before[i].q))>1-1e-6);});
    for(let frame=0;frame<=480;frame++)character.update(frame*1000/60);
    assert.equal(character.playbackTime,time,'animation time is frozen during physics');
    const low=Math.min(...character.meshes.map(m=>m.boundingBox!.min.y)),high=Math.max(...character.meshes.map(m=>m.boundingBox!.max.y));
    assert.ok(Number.isFinite(low)&&Number.isFinite(high)&&high<top-.2,`${model.name}: falls toward floor (${top} -> ${high})`);
    assert.ok(low>bottom-.08,`${model.name}: skin does not fall through plane (${low-bottom})`);
    const point=new Vector3();for(const mesh of character.meshes)for(let i=0;i<mesh.geometry.getAttribute('position').count;i++){mesh.getVertexPosition(i,point);assert.ok(point.toArray().every(Number.isFinite)&&point.length()<10);}
    character.stopRagdoll();assert.equal(character.isRagdoll,false);assert.equal(character.playbackTime,time);
    character.skeleton.bones.forEach((b,i)=>{assert.ok(b.position.distanceTo(before[i].p)<1e-10);assert.ok(b.scale.distanceTo(before[i].s)<1e-10);assert.ok(Math.abs(b.quaternion.dot(before[i].q))>1-1e-6);});
    console.log(`${model.name}: fell ${(top-high).toFixed(2)} m, floor clearance ${(low-bottom).toFixed(3)} m, pose/time restored`);
  }finally{character.dispose();}
}
// A mode change/disposal during the lazy physics import must cancel activation.
const cancelled=await loadSkinnedCharacter(assets,async()=>new Texture());const activation=cancelled.startRagdoll();cancelled.setPose(0,'Z',0);await activation;assert.equal(cancelled.isRagdoll,false);cancelled.dispose();
console.log(`${catalog.models.length} models passed; cancelled activation remains inactive`);
