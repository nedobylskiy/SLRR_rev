import {test} from 'node:test';import assert from 'node:assert/strict';import {Box3,Vector3} from 'three';
import {RigidBody3D} from '../src/engine/rigid-body-3d';import {pedestrianCarContact} from '../src/engine/pedestrian-contact';
const makeCar=()=>new RigidBody3D(1200,new Box3(new Vector3(-1,0,-2),new Vector3(1,1.4,2)));
test('vehicle sweep catches a pedestrian between frames, while near misses and a different deck do not trigger ragdoll',()=>{
 const car=makeCar();car.position.set(-5,.7,0);const previous=car.matrix();car.position.x=5;car.velocity.x=30;
 const hit=pedestrianCarContact(new Vector3(),1.8,.25,new Vector3(),car,previous);assert.ok(hit);assert.ok(hit.fraction>0&&hit.fraction<1);assert.ok(hit.impulse.x>0);assert.ok(hit.point.toArray().every(Number.isFinite));
 assert.equal(pedestrianCarContact(new Vector3(0,0,4),1.8,.25,new Vector3(),car,previous),undefined);
 assert.equal(pedestrianCarContact(new Vector3(0,8,0),1.8,.25,new Vector3(),car,previous),undefined);
 car.velocity.set(0,0,0);assert.equal(pedestrianCarContact(new Vector3(5,0,0),1.8,.25,new Vector3(),car,car.matrix()),undefined);
});
test('side/reverse contacts follow the car orientation and walking into a parked vehicle is a physical contact',()=>{
 const car=makeCar();car.orientation.setFromAxisAngle(new Vector3(0,1,0),Math.PI/2);car.position.set(0,.7,-5);const previous=car.matrix();car.position.z=5;car.velocity.z=15;
 const hit=pedestrianCarContact(new Vector3(),1.8,.25,new Vector3(),car,previous);assert.ok(hit);assert.ok(hit.impulse.z>0);assert.ok(Math.abs(hit.impulse.x)<1e-6);
 car.orientation.identity();car.position.set(0,.7,0);car.velocity.set(0,0,0);
 assert.ok(pedestrianCarContact(new Vector3(1.2,0,0),1.8,.25,new Vector3(-1,0,0),car,car.matrix()));
 assert.equal(pedestrianCarContact(new Vector3(1.2,0,0),1.8,.25,new Vector3(1,0,0),car,car.matrix()),undefined);
});
