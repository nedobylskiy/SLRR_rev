import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {Group,Texture,Vector3} from 'three';
import {loadSkinnedCharacter} from '../src/render/skinned-character';
import {Assets} from '../src/assets';import {PartFactory} from '../src/engine/world';import {DriverIk} from '../src/render/driver-ik';import {gameRoot,relativeGamePath,walk,safeGamePath} from './game-files';
const assets=new Assets((await walk(gameRoot)).map(p=>({path:relativeGamePath(p),size:0})),async p=>new Uint8Array(await readFile(await safeGamePath(p))));
const {world,root}=await new PartFactory(assets).stock({pack:'cars/racers/Baiern.rpk',id:6});
const driver=await DriverIk.create(root,assets,async()=>new Texture()),parent=new Group();parent.add(driver.root);
try{
  const bones=driver.character.skeleton.bones,restLengths=bones.map(b=>b.position.length());let maxError=0;
  for(const transformed of [false,true]){
    if(transformed){parent.position.set(5,2,-4);parent.scale.setScalar(2);root.local.makeRotationY(.7).setPosition(10,1,-4);}
    for(const wristFree of [false,true]){driver.setWristPivot(wristFree);for(const degrees of [-540,-360,-180,-90,0,90,180,360,540,0]){
      driver.setSteeringAngle(degrees*Math.PI/180);driver.update();
      for(const [side,target] of [['L',driver.leftTarget],['R',driver.rightTarget]] as const){const hand=bones.find(b=>b.name===`Bip01 ${side} Hand`)!;const error=driver.gripPosition(side).distanceTo(target)/parent.scale.x;maxError=Math.max(maxError,error);assert.ok(error<.002,`${side} palm grip reaches the rotating rim at ${degrees}°: ${error}`);}
      const armPose=bones.filter(b=>!/ Hand$/.test(b.name)).map(b=>({bone:b,position:b.getWorldPosition(new Vector3()),rotation:b.getWorldQuaternion(b.quaternion.clone()).normalize()}));
      driver.setWristPivot(!wristFree);driver.update();
      for(const {bone,position,rotation} of armPose){assert.ok(bone.getWorldPosition(new Vector3()).distanceTo(position)<1e-8,'wrist freedom never moves upstream bones');assert.ok(bone.getWorldQuaternion(bone.quaternion.clone()).normalize().angleTo(rotation)<1e-6,`wrist freedom never rotates ${bone.name}`);}
      driver.setWristPivot(wristFree);driver.update();const pose=bones.map(b=>b.quaternion.clone());driver.update();
      bones.forEach((b,i)=>assert.ok(b.quaternion.clone().normalize().angleTo(pose[i].clone().normalize())<1e-6,'repeated frames must not drift'));
      bones.forEach((b,i)=>{assert.ok(Math.abs(b.position.length()-restLengths[i])<1e-8,'IK never stretches bone translations');assert.ok(b.quaternion.toArray().every(Number.isFinite));});
    }}
  }
  console.log(JSON.stringify({model:driver.character.source,seat:root.definition.config.seat,wheelRadius:driver.radius,maxGripErrorCm:maxError*100,rotatingWheel:true,transformedCar:true},null,2));
}finally{driver.dispose();}
try{
 const character=await loadSkinnedCharacter(assets,async()=>new Texture()),javaModel=new Group();javaModel.add(character.root);
 const originalMatrix=character.root.matrix.clone();let disposed=false;character.meshes[0].geometry.addEventListener('dispose',()=>{disposed=true;});
 const borrowed=await DriverIk.create(root,assets,async()=>new Texture(),character);
 parent.add(borrowed.root);borrowed.setSteeringAngle(.5);borrowed.update();const wheelMatrix=borrowed.wheel.local.clone();
 assert.equal(character.root.parent,borrowed.root,'reuse the Java character instead of creating a second mesh');
 borrowed.dispose();assert.equal(character.root.parent,javaModel);assert.equal(disposed,false,'IK does not own the Java model');
 assert.ok(character.root.matrix.equals(originalMatrix));assert.ok(borrowed.wheel.local.equals(wheelMatrix),'unbinding never resets physical steering');
 character.dispose();assert.equal(disposed,true);
 console.log('Java character reuse, cleanup and steering ownership: PASS');
}finally{world.dispose();}
