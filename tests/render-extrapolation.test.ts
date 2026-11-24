import test from 'node:test';
import assert from 'node:assert/strict';
import {Box3,Quaternion,Vector3} from 'three';
import {RigidBody3D} from '../src/engine/rigid-body-3d';
import {extrapolationMatrix} from '../src/render/render-extrapolation';

function body(){return new RigidBody3D(1200,new Box3(new Vector3(-1,-.5,-2),new Vector3(1,.5,2)),new Vector3(0,0,0));}

test('render extrapolation is the identity with no pending time',()=>{
  const b=body();b.velocity.set(30,0,0);
  assert.deepEqual(extrapolationMatrix(b,0).elements,[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  assert.deepEqual(extrapolationMatrix(b,-1).elements,[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
});

test('render extrapolation matches advancing the body by the same time',()=>{
  const b=body();b.position.set(5,1,-3);b.velocity.set(20,-1,4);b.setAngularVelocity(new Vector3(.3,1.5,-.2));
  const seconds=1/200,carry=extrapolationMatrix(b,seconds),before=b.matrix();
  // One solver-style step: translate by velocity, rotate about the centre of mass.
  const omega=b.omega,angle=omega.length()*seconds;
  b.position.addScaledVector(b.velocity,seconds);
  b.orientation.premultiply(new Quaternion().setFromAxisAngle(omega.normalize(),angle)).normalize();
  const after=b.matrix(),carried=before.clone().premultiply(carry);
  for(let i=0;i<16;i++)assert.ok(Math.abs(carried.elements[i]-after.elements[i])<1e-9,`element ${i}`);
});
