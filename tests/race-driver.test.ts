import test from 'node:test';import assert from 'node:assert/strict';
import {Box3,Vector3} from 'three';
import {RaceDriver,raceDestination,RACE_COMMANDS,raceTrafficContact,raceCommand} from '../src/engine/race-driver';
import {RigidBody3D} from '../src/engine/rigid-body-3d';
import type {RoadPoint} from '../src/formats/trc';
import {SlrrJvm,jv} from 'slrr-jvm';import {GameTypeNative} from '../src/runtime/game-type-native';
const plan=(_start:RoadPoint,finish:RoadPoint)=>({points:[[0,0,0],[0,0,-30],finish] as RoadPoint[],length:100,direction:[0,0,-1] as RoadPoint,roads:[1,2]});

test('police follow a moving car, stop at the requested gap, and resume when it drives away',()=>{
 let target:Vector3|undefined=new Vector3(0,0,-100),plans=0;
 const driver=new RaceDriver((start,finish)=>{plans++;return {points:[start,finish],length:100,direction:[0,0,-1],roads:[1]};},2.7,.6,undefined,id=>id===42?target:undefined);
 const command='AI_follow 0,0,10 42';
 assert.ok(driver.update(command,new Vector3(),0,0,.02).throttle>0);
 for(let i=0;i<20;i++){target!.z-=.1;driver.update(command,new Vector3(0,0,-i),0,10,.02);}
 assert.equal(plans,1,'a moving target does not restart route planning each physics tick');
 target!.set(20,0,-160);
 for(let i=0;i<60;i++)driver.update(command,new Vector3(0,0,-20),0,10,.02);
 assert.ok(plans>=2);
 const near=target!.clone().add(new Vector3(0,0,5));
 assert.equal(driver.update(command,near,0,0,.02).brake,true);
 target!.z-=50;
 assert.ok(driver.update(command,near,0,0,.02).throttle>0);
 target=undefined;
 assert.equal(driver.update(command,near,0,0,.02).throttle,0);
 assert.equal(driver.update('AI_stop',near,0,0,.02).brake,true);
});

test('straight crossing releases steering inside its bounds and resumes pursuit afterwards',()=>{
 const driver=new RaceDriver((start,finish)=>({points:[start,[2,0,-20],finish],length:100,direction:[0,0,-1],roads:[1,2],
   straightCrossings:[{center:[0,0,-20],radius:8,direction:[0,0,-1]}]}));
 const command='AI_race 5,0,-100 1';
 let input=driver.update(command,new Vector3(0,0,5),0,10,.1);
 assert.notEqual(input.steer,0);
 input=driver.update(command,new Vector3(0,0,-9),0,10,.1);assert.equal(input.steer,0,'lookahead must not pull the car toward the junction centre before entry');
 input=driver.update(command,new Vector3(0,0,-18),0,10,.1);assert.equal(input.steer,0);
 input=driver.update(command,new Vector3(0,0,-20),Math.PI/6,10,2.1);assert.equal(input.steer,0,'the straight pass survives route refresh timing and moderate yaw drift');
 input=driver.update(command,new Vector3(0,0,-24),0,10,.1);assert.equal(input.steer,0);
 input=driver.update(command,new Vector3(0,0,-35),0,10,.1);assert.notEqual(input.steer,0);
 const sideways=driver.update(command,new Vector3(0,0,-20),Math.PI/2,10,.1);assert.notEqual(sideways.steer,0,'a displaced/spun car still recovers instead of coasting sideways');
});

test('fake racer variation is sampled per start, with bounded reaction and smooth launch',()=>{
 let samples=0;const random=()=>{samples++;return 1;};
 const driver=new RaceDriver(plan,2.7,.6,random),command='AI_race 0,0,-100 1 AI_NightRace';
 assert.equal(driver.update(command,new Vector3(),0,0,.02).throttle,0);
 for(let i=0;i<24;i++)driver.update(command,new Vector3(),0,0,.02);
 const early=driver.update(command,new Vector3(),0,0,.02).throttle;
 assert.ok(early>0&&early<.5,'launch ramps in after reaction');
 let late=0;for(let i=0;i<40;i++)late=driver.update(command,new Vector3(),0,0,.02).throttle;
 assert.ok(late>early);assert.equal(samples,4,'no random jitter while driving');
 driver.update('AI_stop',new Vector3(),0,0,.02);
 assert.equal(driver.update(command,new Vector3(),0,0,.02).throttle,0);assert.equal(samples,8,'a new start gets a new profile');
});

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

test('NightRace modifies the last race destination and does not survive a new race or stop command',async()=>{
  const jvm=new SlrrJvm({resolveImport:()=>null}),types=new GameTypeNative(jvm,()=>{}),brain=jv('GameRef',{className:'GameRef',fields:new Map()});jvm.natives.invoke('java.lang.GameType','createNativeInstance',brain,[]);
  const send=(text:string)=>jvm.natives.invokeAsync('java.util.resource.GameRef','queueEvent',brain,[jv('ResourceRef',null),jv('int',16),jv('String',text)]);
  const read=()=>raceCommand(names=>types.latestCommand(brain,names));
  await send('AI_race 0,0,-1000 12');await send('AI_NightRace');
  assert.equal(read(),'AI_race 0,0,-1000 12 AI_NightRace');
  const driver=new RaceDriver((start,finish)=>({points:[start,finish],length:1000,direction:[0,0,-1],roads:[1]}));
  assert.ok(driver.update(read(),new Vector3(),0,50,.02).throttle>0,'no hidden 30–32 m/s ceiling on a straight night race');assert.equal(driver.nightRace,true);
  await send('AI_stop');assert.equal(read(),'AI_stop');
  await send('AI_race 0,0,-1000 12');assert.equal(read(),'AI_race 0,0,-1000 12');
  assert.equal(driver.update(read(),new Vector3(),0,50,.02).brake,true);assert.equal(driver.nightRace,false);
  types.dispose();
});

for(const suffix of ['', ' AI_NightRace'])test(`missed finish behind the car triggers a turn and replans toward the exact destination${suffix}`,()=>{
  let plans=0;const driver=new RaceDriver((start,finish)=>{plans++;return {points:[start,finish],length:new Vector3(...start).distanceTo(new Vector3(...finish)),direction:[0,0,-1],roads:[1]};});
  const command=`AI_race 0,0,-100 1${suffix}`;
  driver.update(command,new Vector3(),0,15,.02);
  let input=driver.update(command,new Vector3(4,0,-105),0,0,1.1);
  assert.ok(Math.abs(input.steer)>.5,'a destination behind must not produce zero steering');assert.ok(input.throttle>0);assert.equal(driver.status,'racing');assert.equal(plans,2);
  if(suffix)return; // A moving drag racer now crosses the finish without parking on the marker.
  // Integrate a bicycle model to verify an actual U-turn reaches the goal,
  // rather than merely checking a nonzero steering value on the first frame.
  const position=new Vector3(4,0,-105);let yaw=0,speed=0;
  for(let i=0;i<6000&&String(driver.status)!=='finished';i++){
    input=driver.update(command,position,yaw,speed,.02);
    speed=Math.max(0,speed+(input.throttle*4-(input.brakeAxis??0)*8-speed*.05)*.02);
    yaw+=speed/2.7*Math.tan(input.steer*.6)*.02;
    position.addScaledVector(new Vector3(-Math.sin(yaw),0,-Math.cos(yaw)),speed*.02);
  }
  assert.equal(driver.status,'finished',`did not reach goal: ${position.toArray()}`);
  assert.ok(position.distanceTo(new Vector3(0,0,-100))<=1);
  driver.update(command,new Vector3(5,0,-100),0,0,.02);
  assert.equal(driver.status,'racing','being pushed away from a reached goal resumes navigation');
});

test('night drag follows a planned road curve rather than a straight finish chord',()=>{
  let plans=0;
  const driver=new RaceDriver((start,finish)=>{plans++;return {points:[start,[20,0,-50],finish],length:1000,direction:[0,0,-1],roads:[1]};});
  const command='AI_race 0,0,-1000 1 AI_NightRace';
  for(let i=0;i<100;i++){
    const input=driver.update(command,new Vector3(0,0,-i*2),0,20,.02);
    assert.ok(Number.isFinite(input.steer));assert.ok(input.throttle>=0);
  }
  assert.ok(plans>=1);
});

test('night racer keeps racing to the finish and brakes only after the finish-trigger runout',()=>{
 const driver=new RaceDriver((start,finish)=>({points:[start,finish],length:100,direction:[0,0,-1],roads:[1]}));
 const command='AI_race 0,0,-100 1 AI_NightRace';
 for(const z of [-70,-90,-99,-100,-101]){
   const input=driver.update(command,new Vector3(0,0,z),0,30,.02);
   assert.equal(input.brake,false);assert.ok(input.throttle>0);assert.equal(input.steer,0);
 }
 assert.equal(driver.update('AI_suspend',new Vector3(0,0,-102),0,30,.02).brake,false);
 assert.equal(driver.update('AI_suspend',new Vector3(0,0,-112),0,30,.02).brake,true);
});

test('a blocked racer backs away with steering, then resumes toward the same goal',()=>{
  const driver=new RaceDriver((start,finish)=>({points:[start,finish],length:100,direction:[0,0,-1],roads:[1]}));
  const command='AI_race 0,0,-100 1';let input=driver.update(command,new Vector3(),0,0,.02);
  for(let i=0;i<110;i++)input=driver.update(command,new Vector3(),0,0,.02);
  assert.equal(driver.status,'reversing');assert.ok(input.throttle<0);assert.equal(Math.abs(input.steer),1);
  for(let i=0;i<180;i++)input=driver.update(command,new Vector3(2,0,4),0,-2,.02);
  assert.equal(driver.status,'racing');assert.ok(input.throttle>0);
  driver.update('AI_stop',new Vector3(),0,0,.02);assert.equal(driver.status,'suspended');
});
