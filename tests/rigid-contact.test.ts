import test from 'node:test';
import assert from 'node:assert/strict';
import {Box3,Vector3} from 'three';
import {RigidBody3D} from '../src/engine/rigid-body-3d';

const body=(mass:number)=>new RigidBody3D(mass,new Box3(new Vector3(-1,-1,-1),new Vector3(1,1,1)));

test('co-moving debris receives no collision impulse from a translating chassis',()=>{
  const fragment=body(10),carrier=body(1000);
  fragment.velocity.set(12,0,0);carrier.velocity.copy(fragment.velocity);
  const impulse=fragment.contact(new Vector3(),new Vector3(-1,0,0),.01,.18,.6,false,carrier);
  assert.equal(impulse.length(),0);assert.equal(fragment.velocity.x,12);
});

test('moving carrier contacts resolve relative velocity and conserve linear momentum including friction',()=>{
  const fragment=body(10),carrier=body(1000),point=new Vector3(),normal=new Vector3(-1,0,0);
  fragment.velocity.set(12,3,0);carrier.velocity.set(10,0,0);
  const momentum=fragment.velocity.clone().multiplyScalar(fragment.mass).addScaledVector(carrier.velocity,carrier.mass);
  const before=fragment.pointVelocity(point).sub(carrier.pointVelocity(point));
  const impulse=fragment.contact(point,normal,0,0,.6,false,carrier);
  carrier.impulse(impulse.clone().negate(),point);
  const after=fragment.pointVelocity(point).sub(carrier.pointVelocity(point));
  assert.ok(Math.abs(after.dot(normal))<1e-10,'normal approach is resolved in the carrier frame');
  assert.ok(Math.abs(after.y)<Math.abs(before.y),'friction reduces relative sliding');
  assert.ok(fragment.velocity.clone().multiplyScalar(fragment.mass).addScaledVector(carrier.velocity,carrier.mass).distanceTo(momentum)<1e-9);
});
