import {test} from 'node:test';import assert from 'node:assert/strict';import {Bone,Group,Quaternion,Vector3} from 'three';
import {solveDriverLimb,wristPivot} from '../src/render/driver-ik';import {parsePartConfig} from '../src/formats/cfg';
test('driver CFG retains seat orientation and pedal position',()=>{const cfg=parsePartConfig('seat -0.4 -0.3 0.1 0 0.6 0\npedals -0.4 -0.35 -0.7');assert.deepEqual(cfg.seat,{position:[-.4,-.3,.1],rotation:[0,.6,0]});assert.deepEqual(cfg.pedals,[-.4,-.35,-.7]);});
test('driver limb reaches its goal without changing bone lengths under a transformed parent',()=>{
 const root=new Group(),upper=new Bone(),lower=new Bone(),hand=new Bone();root.position.set(4,2,-3);root.rotation.y=.8;root.scale.setScalar(2);root.add(upper);upper.add(lower);lower.add(hand);lower.position.x=.35;hand.position.x=.3;root.updateMatrixWorld(true);
 const lengths=[lower.position.length(),hand.position.length()],target=new Vector3(.3,-.2,-.35).applyMatrix4(root.matrixWorld);solveDriverLimb(upper,lower,hand,target,new Vector3(0,-1,0));assert.ok(hand.getWorldPosition(new Vector3()).distanceTo(target)<1e-6);assert.deepEqual([lower.position.length(),hand.position.length()],lengths);
 const far=new Vector3(20,2,-3);solveDriverLimb(upper,lower,hand,far,new Vector3(0,-1,0));assert.ok(hand.getWorldPosition(new Vector3()).distanceTo(upper.getWorldPosition(new Vector3()))<=1.3+1e-6);assert.ok(upper.quaternion.toArray().every(Number.isFinite));
});

test('wrist freedom rotates only around the configured grip axis and respects its angular limit',()=>{
 const grip=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.4),axis=new Vector3(0,0,1),preferred=new Quaternion().setFromAxisAngle(axis,1.2).multiply(grip);
 const solved=wristPivot(grip,preferred,axis,.7),delta=solved.clone().multiply(grip.clone().invert());assert.ok(Math.abs(delta.angleTo(new Quaternion())-.7)<1e-6);assert.ok(Math.abs(delta.x)<1e-6&&Math.abs(delta.y)<1e-6);
 assert.ok(wristPivot(grip,preferred,axis,0).angleTo(grip)<1e-6);
});
