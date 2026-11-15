import test from 'node:test';import assert from 'node:assert/strict';
import {Box3,Vector3} from 'three';
import {RaceDriver,raceDestination,RACE_COMMANDS,raceTrafficContact} from '../src/engine/race-driver';
import {RigidBody3D} from '../src/engine/rigid-body-3d';
import type {RoadPoint} from '../src/formats/trc';
import {SlrrJvm,jv} from 'slrr-jvm';import {GameTypeNative} from '../src/runtime/game-type-native';
const plan=(_start:RoadPoint,finish:RoadPoint)=>({points:[[0,0,0],[0,0,-30],finish] as RoadPoint[],length:100,direction:[0,0,-1] as RoadPoint,roads:[1,2]});

test('a racer exchanges collision impulses with traffic and invokes its physical wake-up path',()=>{
  const bounds=new Box3(new Vector3(-1,-.5,-2),new Vector3(1,.5,2));
  const a=new RigidBody3D(1200,bounds.clone()),b=new RigidBody3D(1500,bounds.clone());
  b.position.z=-3.8;a.velocity.z=-14;let damaged=false,woken=false;
  const car={body:a,vehicleContact:(impulse:Vector3,point:Vector3)=>{damaged=true;a.impulse(impulse,point);}};
  const traffic={body:b,hit:(impulse:Vector3,point:Vector3)=>{woken=true;b.impulse(impulse,point);}};
  const momentum=a.velocity.clone().multiplyScalar(a.mass).addScaledVector(b.velocity,b.mass);
  assert.equal(raceTrafficContact(car,traffic),true);assert.ok(damaged&&woken);
  assert.ok(b.velocity.z<0);assert.ok(a.velocity.z>-14);
  assert.ok(a.velocity.clone().multiplyScalar(a.mass).addScaledVector(b.velocity,b.mass).distanceTo(momentum)<1e-6);
  b.position.z=-100;assert.equal(raceTrafficContact(car,traffic),false);
});
test('race controller waits for AI_race, follows its chosen route and brakes at the finish',()=>{
  let plans=0;const driver=new RaceDriver((a,b)=>{plans++;return plan(a,b);});
  assert.equal(driver.update('AI_BeginRace 0.5',new Vector3(),0,0,.02).throttle,0);assert.equal(plans,0);
  const start=driver.update('AI_race -40,0,-30 123',new Vector3(),0,0,.02);assert.ok(start.throttle>0);assert.equal(start.brake,false);assert.equal(plans,1);
  for(let i=0;i<30;i++)driver.update('AI_race -40,0,-30 123',new Vector3(0,0,-25),0,10,.02);
  assert.equal(plans,1,'reuse the route while driving');
  const turn=driver.update('AI_race -40,0,-30 123',new Vector3(0,0,-29),0,10,.02);assert.ok(turn.steer>0,'turn onto the planned left street');
  driver.update('AI_race -40,0,-30 123',new Vector3(-30,0,-30),Math.PI/2,8,.02);
  const stop=driver.update('AI_race -40,0,-30 123',new Vector3(-39,0,-30),Math.PI/2,1,.02);assert.equal(stop.throttle,0);assert.equal(stop.brake,true);assert.equal(driver.status,'finished');
  assert.equal(driver.update('AI_suspend',new Vector3(),0,0,.02).throttle,0);
  assert.equal(raceDestination('AI_race NaN,0,3 5'),undefined);assert.deepEqual(raceDestination('AI_race -1, 2, 3 5'),[-1,2,3]);
});
test('a disconnected race destination holds the brakes instead of using random traffic routes',()=>{
  const driver=new RaceDriver(()=>undefined);const input=driver.update('AI_race 100,0,100 42',new Vector3(),0,0,.02);
  assert.equal(input.throttle,0);assert.equal(input.brake,true);assert.equal(driver.status,'no route');
});
test('repeated AI commands retain issue order, so suspend can override a previous race and vice versa',async()=>{
  const jvm=new SlrrJvm({resolveImport:()=>null}),types=new GameTypeNative(jvm,()=>{});
  const brain=jv('GameRef',{className:'java.util.resource.GameRef',fields:new Map()});
  jvm.natives.invoke('java.lang.GameType','createNativeInstance',brain,[]);
  const send=(text:string)=>jvm.natives.invokeAsync('java.util.resource.GameRef','queueEvent',brain,[jv('ResourceRef',null),jv('int',16),jv('String',text)]);
  await send('AI_suspend');await send('AI_race 0,0,-100 1');await send('AI_suspend');
  assert.equal(types.latestCommand(brain,RACE_COMMANDS),'AI_suspend');
  await send('AI_race 0,0,-100 1');await send('renderinstance 123');assert.equal(types.latestCommand(brain,RACE_COMMANDS),'AI_race 0,0,-100 1');types.dispose();
});
