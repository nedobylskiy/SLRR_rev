import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Group,Vector3} from 'three';
import {ConeTwistConstraint} from 'cannon-es';
import {createCharacterSkeleton} from '../src/render/skinned-character';
import {CharacterRagdoll} from '../src/render/character-ragdoll';
import type {SkeletonBone} from '../src/formats/skeleton';

function rig(){
  const definitions:SkeletonBone[]=[];
  const add=(name:string,parent:number,position:number[])=>{definitions.push({name:`Bip01${name?' '+name:''}`,parent,position,rotation:[1,0,0,0,1,0,0,0,1],limits:[[-Math.PI,Math.PI],[-Math.PI,Math.PI],[-Math.PI,Math.PI]]});return definitions.length-1;};
  const root=add('',-1,[0,100,0]),pelvis=add('Pelvis',root,[0,0,0]),spine=add('Spine1',pelvis,[0,30,0]);add('Head',spine,[0,30,0]);
  for(const side of ['L','R']){const thigh=add(`${side} Thigh`,pelvis,[side==='L'?-10:10,0,0]),calf=add(`${side} Calf`,thigh,[0,-43,0]),foot=add(`${side} Foot`,calf,[0,-43,0]);add(`${side} Toe0`,foot,[0,-4,13]);}
  const skeleton=createCharacterSkeleton(definitions),group=new Group();group.add(skeleton.root);return {skeleton,group};
}
test('ragdoll preserves activation pose through scaled inspection parents, then falls with connected joints above the floor',()=>{
  const {skeleton,group}=rig(),inspection=new Group();inspection.position.set(5,2,-4);inspection.scale.setScalar(3);inspection.add(group);inspection.updateMatrixWorld(true);
  const before=skeleton.bones.map(b=>b.matrixWorld.clone()),ragdoll=new CharacterRagdoll(skeleton.skeleton,group,0);
  ragdoll.applyPose();group.updateMatrixWorld(true);
  skeleton.bones.forEach((bone,i)=>bone.matrixWorld.elements.forEach((v,j)=>assert.ok(Math.abs(v-before[i].elements[j])<1e-6,'activation does not jump under viewer scale/offset')));
  const start=Math.max(...ragdoll.limbs.map(l=>l.body.position.y));
  ragdoll.step(NaN);ragdoll.step(-1);assert.equal(ragdoll.world.time,0);
  for(let i=0;i<600;i++)ragdoll.step(1/120);
  assert.ok(Math.max(...ragdoll.limbs.map(l=>l.body.position.y))<start-.3,'gravity/toppling lowers body');
  for(const limb of ragdoll.limbs){assert.ok([limb.body.position.x,limb.body.position.y,limb.body.position.z].every(Number.isFinite));limb.body.updateAABB();assert.ok(limb.body.aabb.lowerBound.y>-.025,'collider stays above floor');}
  for(const joint of ragdoll.world.constraints){assert.ok(joint instanceof ConeTwistConstraint);const constraint=joint as ConeTwistConstraint;assert.ok(constraint.bodyA.pointToWorldFrame(constraint.pivotA).distanceTo(constraint.bodyB.pointToWorldFrame(constraint.pivotB))<.06,'joint anchors remain connected');}
  for(const bone of skeleton.bones){assert.ok(bone.position.toArray().every(Number.isFinite));assert.ok(Math.abs(bone.quaternion.length()-1)<1e-6);}
  ragdoll.dispose();assert.equal(ragdoll.world.bodies.length,0);assert.equal(ragdoll.world.constraints.length,0);skeleton.skeleton.dispose();
});
test('ragdoll validates required anatomical anchors without starting a physics simulation',()=>{
  const {skeleton,group}=rig();skeleton.bones.find(b=>b.name==='Bip01 Pelvis')!.name='unknown';assert.throws(()=>new CharacterRagdoll(skeleton.skeleton,group,0),/pelvis/);skeleton.skeleton.dispose();
});

test('world-space impact preserves activation pose and transfers momentum through a rotated character frame',()=>{
 const {skeleton,group}=rig();group.position.set(100,4,-50);group.rotation.y=Math.PI/2;group.updateMatrixWorld(true);
 const momentum=new Vector3(0,0,-250),point=skeleton.bones.find(b=>b.name==='Bip01 Spine1')!.getWorldPosition(new Vector3()),before=skeleton.bones.map(b=>b.matrixWorld.clone());
 const ragdoll=new CharacterRagdoll(skeleton.skeleton,group,0,[],{velocity:new Vector3(0,0,-1),impulse:momentum,point});
 ragdoll.applyPose();group.updateMatrixWorld(true);skeleton.bones.forEach((bone,i)=>bone.matrixWorld.elements.forEach((v,j)=>assert.ok(Math.abs(v-before[i].elements[j])<1e-6)));
 const sum=ragdoll.limbs.reduce((p,l)=>p.addScaledVector(new Vector3(l.body.velocity.x,l.body.velocity.y,l.body.velocity.z),l.body.mass),new Vector3()).applyQuaternion(group.quaternion);
 assert.ok(Math.abs(sum.z-(-250-ragdoll.limbs.reduce((m,l)=>m+l.body.mass,0)))<1e-6);assert.ok(Math.abs(sum.x)<1e-6);
 const start=ragdoll.position;for(let i=0;i<120;i++)ragdoll.step(1/120);assert.ok(ragdoll.position.distanceTo(start)>1);
 ragdoll.dispose();skeleton.skeleton.dispose();
});
test('ragdoll contacts a moving car collider and applies an opposite impulse to the car',()=>{
 const {skeleton,group}=rig(),ragdoll=new CharacterRagdoll(skeleton.skeleton,group,0),reaction=new Vector3();
 const key={},rotation=group.quaternion.clone(),car={key,center:new Vector3(-2,.6,0),rotation,half:new Vector3(.7,.6,1.5),velocity:new Vector3(5,0,0),angularVelocity:new Vector3(),impulse:(j:Vector3)=>reaction.add(j)};
 const start=ragdoll.position.x;
 for(let i=0;i<60;i++){car.center.x=-2+i*5/120;ragdoll.setVehicles([car],1/120);ragdoll.step(1/120);}
 assert.ok(ragdoll.position.x>start+.3);assert.ok(reaction.x<0);assert.ok(reaction.length()<500,'soft contact must not return an anchored-obstacle impulse');assert.ok(reaction.toArray().every(Number.isFinite));
 ragdoll.setVehicles([],0);assert.ok(!ragdoll.world.bodies.some(b=>b.collisionFilterGroup===4));ragdoll.dispose();skeleton.skeleton.dispose();
});

test('sampled map support follows world elevation under a rotated/translated ragdoll',()=>{
 const {skeleton,group}=rig();group.position.set(10,3,-20);group.rotation.y=.6;skeleton.root.position.y=2;group.updateMatrixWorld(true);
 const ragdoll=new CharacterRagdoll(skeleton.skeleton,group,2,[],{ground:point=>{assert.ok(Math.abs(point.y-5)<1e-6,'terrain queries start at the feet even with a model root offset');return 5;}});
 for(let i=0;i<360;i++)ragdoll.step(1/120);
 assert.ok(ragdoll.position.y>4.9);assert.ok(ragdoll.position.y<6);
 for(const limb of ragdoll.limbs){limb.body.updateAABB();assert.ok(limb.body.aabb.lowerBound.y>1.96);}
 ragdoll.dispose();skeleton.skeleton.dispose();
});
