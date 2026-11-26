import test from 'node:test';import assert from 'node:assert/strict';import {Matrix4,Vector3} from 'three';
import {EngineWorld,type PartDefinition} from '../src/engine/world';import {parsePartConfig} from '../src/formats/cfg';
import {trafficWheelFrame} from '../src/engine/traffic-running-gear';
test('traffic spin uses the installed hub frame including mirrored axes, calibration and Java overrides',()=>{
 const world=new EngineWorld(),def:PartDefinition={key:{pack:'test.rpk',id:1},alias:'chassis',cfgPath:'chassis.cfg',config:parsePartConfig('wheel 0.8 0.1 -1.2 0 0 0 1 0 1 0\nslot 0 0 0 0 0 0 1\nslottype 101\n')};
 const root=world.create(def);root.wheelFrameOffsetY=.14;root.wheelFrameOffsets=[[.055,0,0]];
 const frame=trafficWheelFrame(root,0),hub=new Vector3().setFromMatrixPosition(frame);assert.ok(hub.distanceTo(new Vector3(.855,.24,-1.2))<1e-10);
 const localMesh=new Matrix4().makeTranslation(.855,.24,-1.2),relative=frame.clone().invert().multiply(localMesh);
 for(const angle of [0,.3,1,Math.PI]){const mesh=frame.clone().multiply(new Matrix4().makeRotationX(angle)).multiply(relative);assert.ok(new Vector3().setFromMatrixPosition(mesh).distanceTo(hub)<1e-10,'spin must not orbit around the old CFG sample');}
 root.slotRotations.set(1,[Math.PI,0,0]);assert.ok(new Vector3(1,0,0).transformDirection(trafficWheelFrame(root,0)).x<0);world.dispose();
});
