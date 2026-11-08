import test from 'node:test';
import assert from 'node:assert/strict';
import {brakingClutchHelp,steeringHelpStep,lowSpeedClutchHelp,LaunchHelping,absBrakeStep} from '../src/engine/driving-helping';
import {MechanicalSystem} from '../src/engine/mechanical-system';
import {EngineWorld} from '../src/engine/world';
import {parsePartConfig} from '../src/formats/cfg';

function drivetrain(native:boolean){
  const world=new EngineWorld();
  const root=world.create({key:{pack:'test.rpk',id:1},alias:'root',cfgPath:'root.cfg',config:parsePartConfig('slot 0 0 0 0 0 0 1')});
  for(const [id,script,values] of [
    [2,'block.java',{cylinders:4,bore:80,rpm_idle:900,RPM_limit:6500}],
    [3,'crank.java',{stroke:90}], [4,'head.java',{intake_valve_diam:32}],
    [5,'transmission.java',{gears:3,'ratio[1]':3.5,'ratio[2]':2.1,'ratio[3]':1.4,end_ratio:3}],
    [6,'clutch.java',{}], [7,'fuel_rail.java',{}],
  ] as const){
    root.definition.config.slots.push({id,position:[0,0,0],rotation:[0,0,0],attach:[],compatible:[]});
    const part=world.create({key:{pack:'test.rpk',id},alias:script,script,cfgPath:script,config:parsePartConfig('slot 0 0 0 0 0 0 1'),
      mechanics:{kind:'engine',source:script,values:{...values},drive:id===5?'DT_RWD':undefined}});
    world.install(root,id,part,1);
  }
  if(native)world.javaPowertrain={curve:{rpmStep:1000,torque:[0,100,200,220,210,180,100,0],watts:[],nitroTorque:[],nitroWatts:[]},
    state:{revision:1,parameters:{engine_inertia:7,engine_mass:40,engine_rpm_idle:900,RPM_limit:6500,rearend_ratio:3,ClutchF:500},ratios:[0,3.5,2.1,1.4,0,0,0,-3],descendantPartIds:[]}};
  const system=new MechanicalSystem(root);system.reset();system.manual=true;system.gear=1;
  return {world,system};
}

test('brake help is proportional and only opens the clutch during heavy braking near stall',()=>{
  assert.equal(brakingClutchHelp(0,1,900,0,900,20),0);
  assert.ok(Math.abs(brakingClutchHelp(.5,1,900,0,900,20)-.5)<1e-10);
  assert.equal(brakingClutchHelp(1,.5,900,0,900,20),0);
  assert.equal(brakingClutchHelp(1,1,3000,3000,900,20),0);
  assert.equal(brakingClutchHelp(1,1,3000,0,900,20),1,'locked wheels are detected before the engine is dragged down');
});

for(const native of [false,true])test(`brake helping prevents a manual braking stall without changing RPM directly (${native?'native':'fallback'})`,()=>{
  const off=drivetrain(native),on=drivetrain(native);
  on.system.helping.brake=1;
  for(let tick=0;tick<240;tick++){
    off.system.advance(1/120,{throttle:0,brake:true,brakeAxis:1},[0,0,0,0],[0,0,0,0],20);
    const result=on.system.advance(1/120,{throttle:0,brake:true,brakeAxis:1},[0,0,0,0],[0,0,0,0],20);
    assert.ok(result.torque.every(value=>value===0),'fully opened clutch cannot transmit torque to locked wheels');
  }
  assert.equal(off.system.running,false,'zero help retains manual stall behavior');
  assert.equal(on.system.running,true);assert.ok(on.system.rpm>700&&on.system.rpm<1200);
  on.system.running=false;on.system.rpm=0;
  on.system.advance(1/120,{throttle:0,brake:true},[0,0,0,0],[0,0,0,0],20);
  assert.equal(on.system.running,false,'brake help does not restart a stopped engine');
  off.world.dispose();on.world.dispose();
});


test('brake helping leaves low speeds to clutch helping and fades in using chassis speed',()=>{
  for(const speed of [0,5,19,20])assert.equal(brakingClutchHelp(1,1,900,0,900,speed/3.6),0);
  assert.ok(Math.abs(brakingClutchHelp(1,1,900,0,900,25/3.6)-.5)<1e-10);
  assert.equal(brakingClutchHelp(1,1,900,0,900,30/3.6),1);
  assert.equal(brakingClutchHelp(1,1,900,0,900,-30/3.6),1);
  for(const native of [false,true]){
    const {world,system}=drivetrain(native);system.helping.brake=1;
    for(let i=0;i<240;i++)system.advance(1/120,{throttle:0,brake:true,brakeAxis:1},[0,0,0,0],[0,0,0,0],2);
    assert.equal(system.brakeHelpClutch,0);assert.equal(system.running,false,'brake help must not take over low-speed clutch control');
    world.dispose();
  }
});


test('button steering rate depends on speed and helping strength without limiting the final angle',()=>{
  const low=steeringHelpStep(0,.6,0,.1,1,true),fast=steeringHelpStep(0,.6,100/3.6,.1,1,true);
  assert.equal(low,.2);assert.ok(fast<low/3);
  const partial=steeringHelpStep(0,.6,100/3.6,.1,.5,true);
  assert.ok(partial>fast&&partial<low);
  assert.equal(steeringHelpStep(0,.6,100/3.6,.1,0,true),low);
  assert.equal(steeringHelpStep(0,.6,100/3.6,.1,1,false),low,'analogue input retains its original response');
  assert.equal(steeringHelpStep(0,.6,-100/3.6,.1,1,true),fast);
  assert.equal(steeringHelpStep(.5,0,100/3.6,.1,1,true),.3,'centering remains responsive');
  let angle=0;for(let i=0;i<1200;i++)angle=steeringHelpStep(angle,.6,200/3.6,1/120,1,true);
  assert.equal(angle,.6,'sustained input can still reach the full steering lock');
  const steer=(hz:number)=>{let value=0;for(let i=0;i<hz;i++)value=steeringHelpStep(value,.6,100/3.6,1/hz,1,true);return value;};
  assert.ok(Math.abs(steer(30)-steer(120))<1e-9,'rate is measured per second');
});


test('clutch helping strength fades out from 20 to 30km/h and works in reverse',()=>{
  assert.equal(lowSpeedClutchHelp(0,0),0);assert.equal(lowSpeedClutchHelp(.5,0),.5);
  assert.equal(lowSpeedClutchHelp(1,20/3.6),1);
  assert.ok(Math.abs(lowSpeedClutchHelp(1,25/3.6)-.5)<1e-9);
  assert.equal(lowSpeedClutchHelp(1,30/3.6),0);
  assert.equal(lowSpeedClutchHelp(1,-10/3.6),1);
});

for(const native of [false,true]){
  test(`clutch helping prevents low-speed stall, permits launch and respects the manual pedal (${native?'native':'fallback'})`,()=>{
    const raw=drivetrain(native),helped=drivetrain(native);helped.system.helping.clutch=1;
    for(let i=0;i<240;i++){
      raw.system.advance(1/120,{throttle:0},[0,0,0,0],[0,0,0,0],0);
      const step=helped.system.advance(1/120,{throttle:0},[0,0,0,0],[0,0,0,0],0);
      assert.ok(step.torque.every(t=>t===0),'idle assistance opens the clutch, rather than driving against a stopped wheel');
    }
    assert.equal(raw.system.running,false,'0 keeps manual stalling');assert.equal(helped.system.running,true);
    assert.ok(helped.system.rpm>700&&helped.system.rpm<1200);
    const wheels=[0,0,0,0];
    for(let i=0;i<1200;i++){
      const speed=(wheels[2]+wheels[3])*.5*.3;
      const step=helped.system.advance(1/120,{throttle:.5},wheels,wheels,speed);
      for(let wheel=0;wheel<4;wheel++)wheels[wheel]+=step.torque[wheel]/1.6/120;
      assert.equal(helped.system.running,true,`assisted launch stalled at tick ${i}`);
    }
    assert.ok(wheels[2]>3,'clutch progressively transfers torque and launches the vehicle');
    const disengaged=helped.system.advance(1/120,{throttle:.5,clutch:true},wheels,wheels,5);
    assert.ok(disengaged.torque.every(t=>t===0),'explicit clutch pedal remains authoritative');
    helped.system.running=false;helped.system.rpm=0;
    helped.system.advance(1/120,{throttle:0},[0,0,0,0]);assert.equal(helped.system.running,false,'help does not restart a stopped engine');
    raw.world.dispose();helped.world.dispose();
  });
  test(`brake and clutch helping cover the entire braking slowdown (${native?'native':'fallback'})`,()=>{
    const {world,system}=drivetrain(native);system.helping.brake=system.helping.clutch=1;
    for(let i=0;i<600;i++){
      const speed=Math.max(0,12-i*.025);
      const step=system.advance(1/120,{throttle:0,brake:true,brakeAxis:1},[0,0,0,0],[0,0,0,0],speed);
      assert.ok(step.torque.every(t=>t===0));assert.equal(system.running,true,`stall at ${speed*3.6}km/h`);
    }
    world.dispose();
  });
}


test('launch helping cuts slip only for a fast first-gear start and releases afterwards',()=>{
  const control=new LaunchHelping();
  assert.equal(control.step(.01,1,0,0,0,1),1);assert.equal(control.active,false);
  assert.equal(control.step(.01,1,15,2,1,1),1);assert.equal(control.active,false,'rolling acceleration is not a launch');
  for(let i=0;i<60;i++)control.step(1/120,1,0,1,1,1);
  assert.equal(control.active,true);assert.ok(control.factor<.1);
  const cut=control.factor;
  for(let i=0;i<120;i++)control.step(1/120,1,3,.05,1,1);
  assert.ok(control.factor>cut&&control.factor>.99,'traction recovery restores driver demand');
  assert.equal(control.step(.01,1,3,1,1,2),1);assert.equal(control.active,false,'a gear change ends launch control');
  control.step(.1,1,0,1,1,1);assert.equal(control.step(.01,1,10,1,1,1),1);
  assert.equal(control.active,false,'above 30km/h launch control disengages');
});

test('ABS reduces only requested wheel deceleration and bypasses low speed and airborne wheels',()=>{
  const full=absBrakeStep(100,0,20,.3,1);
  assert.ok(Math.abs(full-20/.3*.85)<1e-9);
  assert.equal(absBrakeStep(100,0,20,.3,0),0);
  assert.ok(Math.abs(absBrakeStep(100,0,20,.3,.5)-full*.5)<1e-9);
  assert.equal(absBrakeStep(100,0,2,.3,1),0);
  assert.equal(absBrakeStep(100,0,20,.3,1,false),0);
  assert.equal(absBrakeStep(5,0,20,.3,1),5,'releasing pressure does not artificially spin up an already locked wheel');
  assert.equal(absBrakeStep(20,30,20,.3,1),30,'ABS never cuts acceleration');
  assert.ok(Math.abs(absBrakeStep(-100,0,-20,.3,1)+full)<1e-9);
});

for(const native of [false,true])test(`launch control reduces combustion demand under wheelspin (${native?'native':'fallback'})`,()=>{
  const raw=drivetrain(native),helped=drivetrain(native);helped.system.helping.acceleration=1;
  for(let tick=0;tick<120;tick++){
    for(const {system} of [raw,helped]){
      system.rpm=4000;system.running=true;
      system.advance(1/120,{throttle:1},[0,0,40,40],[0,0,0,0],0);
    }
  }
  assert.ok(helped.system.launchThrottleFactor<.1);
  assert.equal(raw.system.launchThrottleFactor,1);
  assert.ok(helped.system.rpm<raw.system.rpm,'torque reduction is applied to combustion, not just the displayed pedal');
  raw.world.dispose();helped.world.dispose();
});
