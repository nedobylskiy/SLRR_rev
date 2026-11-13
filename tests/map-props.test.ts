import test from 'node:test';
import assert from 'node:assert/strict';
import {Box3,Matrix4,Vector3} from 'three';
import {MapProps} from '../src/engine/map-props';
import {MapCollision} from '../src/engine/map-collision';
import {MapTerrain} from '../src/engine/map-terrain';
import {RigidBody3D} from '../src/engine/rigid-body-3d';

test('untouched props have no solver body; a car transfers momentum instead of hitting a static wall',()=>{
  const collision=new MapCollision(),props=new MapProps(collision,new MapTerrain(collision));
  let changes=0,last=new Matrix4();
  const prop=props.add(new Matrix4(),new Box3(new Vector3(-.2,0,-.2),new Vector3(.2,1,.2)),50,delta=>{changes++;last.copy(delta);});
  props.update(10);assert.equal(!!prop.body,false);assert.equal(changes,0);
  const car=new RigidBody3D(1200,new Box3(new Vector3(-1,0,-2),new Vector3(1,1,2)));
  car.setFrame(new Matrix4().makeTranslation(0,0,2.1));car.velocity.z=-10;
  assert.equal(collision.bodyContact(car),undefined,'movable props must not produce the static-wall response');
  assert.equal(props.awake,1);assert.ok(prop.body);assert.ok(prop.body.velocity.z<0);assert.ok(car.velocity.z<-8);
  assert.ok(Math.abs(car.mass*car.velocity.z+prop.body.mass*prop.body.velocity.z+12000)<1e-7,'linear momentum is conserved');
  props.update(1/60);assert.ok(changes>0);assert.ok(last.elements[14]<0,'render delta follows the impacted prop');
  props.dispose();assert.equal(collision.boxes,0);
});

test('sleeping moved props retain their final transform and wake without returning to spawn',()=>{
  const collision=new MapCollision();
  const terrain={sample:()=>({height:0,normal:new Vector3(0,1,0)})} as unknown as MapTerrain;
  const props=new MapProps(collision,terrain),bounds=new Box3(new Vector3(-.3,0,-.3),new Vector3(.3,.6,.3));
  let last=new Matrix4();const prop=props.add(new Matrix4(),bounds,50,m=>last.copy(m));
  const car=new RigidBody3D(1200,new Box3(new Vector3(-1,0,-1),new Vector3(1,1,1)));
  car.setFrame(new Matrix4().makeTranslation(0,0,1.2));car.velocity.z=-1;collision.bodyContact(car);
  for(let i=0;i<1800&&props.awake;i++)props.update(1/60);
  assert.equal(props.awake,0,'settled debris stops consuming solver work');
  const position=prop.body!.position.clone();assert.ok(position.z<-.01);
  assert.ok(last.equals(prop.body!.matrix()),'the final sleeping pose is published');
  car.setFrame(new Matrix4().makeTranslation(position.x,0,position.z+1.2));car.velocity.z=-1;collision.bodyContact(car);
  assert.equal(props.awake,1);assert.ok(prop.body!.position.distanceTo(position)<.2,'wake keeps the settled location');props.dispose();
});
