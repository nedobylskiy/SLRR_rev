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
