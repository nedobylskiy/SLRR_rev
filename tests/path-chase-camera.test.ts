import test from 'node:test';
import assert from 'node:assert/strict';
import {Group,Vector3} from 'three';
import {PathChaseCamera} from '../src/render/path-chase-camera';
import {PedestrianCrowd} from '../src/render/pedestrian-crowd';

test('chase follows the travelled corner instead of retaining a world-space offset',()=>{
  const camera=new PathChaseCamera(),eye=new Vector3(),target=new Vector3(),focus=new Vector3(),offset=new Vector3(0,2,12);
  camera.update(eye,target,focus,offset,0,true);
  for(let i=1;i<=240;i++){
    focus.set(0,0,-i/12);camera.update(eye,target,focus,offset,1/60);
  }
  for(let i=1;i<=360;i++){
    focus.set(i/12,0,-20);camera.update(eye,target,focus,offset,1/60);
  }
  assert.ok(eye.x>15&&eye.x<focus.x,'camera follows behind the car after the turn');
  assert.ok(Math.abs(eye.z+20)<.01,'camera has joined the new road instead of staying south of it');
  assert.deepEqual(target,focus);
  const before=eye.clone();
  for(let i=0;i<180;i++)camera.update(eye,target,focus,offset,1/60);
  assert.ok(eye.distanceTo(focus.clone().add(new Vector3(-12,2,0)))<.01,'resting camera stays on the travelled path');
  assert.ok(eye.distanceTo(before)<3,'stopping settles the inertial movement');
});

test('walking crowd is absent at night even when enabled, and resumes at dawn',()=>{
  const crowd=new PedestrianCrowd();crowd.configure(0,100);
  crowd.root.add(new Group());
  crowd.update(0,[],undefined,undefined,1,true);assert.equal(crowd.root.visible,true);
  crowd.update(1000,[],undefined,undefined,1,false);assert.equal(crowd.root.visible,false);
  crowd.update(3600000,[],undefined,undefined,1,true);assert.equal(crowd.root.visible,true);
  crowd.dispose();
});
