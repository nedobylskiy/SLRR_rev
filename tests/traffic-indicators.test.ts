import {test} from 'node:test';
import assert from 'node:assert/strict';
import {trafficIndicatorMask,TrafficIndicators,completeTrafficIndicators,type TrafficLamp} from '../src/render/traffic-lamps';
import {Matrix4} from 'three';
import {drivingLightMask} from '../src/render/vehicle-lights';

test('traffic indicators follow actual wheel yaw beyond 5 degrees only while driving forward, including daytime',()=>{
  assert.equal(trafficIndicatorMask(5*Math.PI/180,3,0),0);
  assert.equal(trafficIndicatorMask(2*Math.PI/180,3,0),0,'small steering corrections stay dark');
  assert.equal(trafficIndicatorMask(6*Math.PI/180,3,0),16);
  assert.equal(trafficIndicatorMask(-6*Math.PI/180,3,0),32);
  assert.equal(trafficIndicatorMask(.27,3,0),16);assert.equal(trafficIndicatorMask(-.27,3,0),32);
  assert.equal(trafficIndicatorMask(.27,0,0),0);assert.equal(trafficIndicatorMask(.27,-3,0),0);
  assert.equal(trafficIndicatorMask(.27,3,.6),0);assert.equal(trafficIndicatorMask(.27,3,1.1),16);
  assert.equal(drivingLightMask(16,true,false,true,12*3600),17,'daytime blinking and brake channels coexist');
});

test('short steering pulses start lit and remain visible; reversing cancels them and opposite steering starts a fresh flash',()=>{
 const indicators=new TrafficIndicators();
 assert.equal(indicators.update(.3,3,.7),16,'first frame is lit regardless of global blink phase');
 assert.equal(indicators.update(0,3,.8),16);assert.equal(indicators.update(0,3,1.3),0);assert.equal(indicators.update(0,3,1.6),0);
 assert.equal(indicators.update(-.3,3,1.7),32);assert.equal(indicators.update(.3,3,1.8),16);
 assert.equal(indicators.update(.3,-1,1.9),0);
});

test('stock CFGs with front-only indicators gain amber rear flares without replacing brake or reverse lamps',()=>{
 const source={texture:'flare.ptx',color:[1,1,1] as [number,number,number],alpha:1,position:[0,0,0] as [number,number,number],direction:[0,0,1] as [number,number,number],cone:Math.PI,size:10,offset:0};
 const lamps:TrafficLamp[]=[{source,matrix:new Matrix4().makeTranslation(-.9,0,2.5),flags:2},{source,matrix:new Matrix4().makeTranslation(.9,0,2.5),flags:2},{source,matrix:new Matrix4().makeTranslation(-.8,0,-2.4),flags:16}];
 const complete=completeTrafficIndicators(lamps);assert.equal(complete.length,5);assert.equal(lamps.length,3);
 assert.deepEqual(complete.slice(-2).map(l=>l.flags),[16,32]);assert.deepEqual(complete.at(-1)!.source.color,[1,.6,0]);
 assert.equal(completeTrafficIndicators(complete).length,5,'authored or completed rear lamps are not duplicated');
});
