import assert from 'node:assert/strict';
import test from 'node:test';
import { CombustionModel } from '../src/engine/combustion-model';
import { clutchExchange, effectiveTireLoad, engineLimiter, engineTemperatureStep, nativeSuspensionForce, nativeTireForces, STOCK_WHEEL_PARAMETERS, updateSlip, wheelBrake, wheelCurve } from '../src/engine/native-vehicle-physics';
import { parsePartConfig } from '../src/formats/cfg';
const near = (actual:number,expected:number,tolerance=1e-5) => assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);

test('recovered combustion model agrees with the original-executable published low-RPM witness', () => {
  // sl-remastered tests/dyno_native_test.cpp: dyno-original-step-v2 case0/sample1.
  const curve = new CombustionModel().calculate({maxRPM:7000},16);
  near(curve.displacement,0.0019011663971468806,1e-9);
  near(curve.compression,10.50583267211914,2e-6);
  near(curve.torque[1],82.08709716796875,0.002);
  near(curve.watts[1],4781.27294921875,0.05);
  assert.equal(curve.rpmStep,437);
  assert.equal(curve.torque.length,16);
});
test('valve timing, mixture, turbo and nitrous alter the combustion cycle, retaining the nitrous bank on recalculation', () => {
  const model=new CombustionModel(), base=model.calculate({maxRPM:7000},28);
  const turbo=model.calculate({maxRPM:7000,rpm_turbo_mul:1,rpm_turbo_opt:3500,rpm_turbo_range:3000,P_turbo_max:0.8},28);
  assert.ok(turbo.torque[14]>base.torque[14]);
  const nitro=model.calculate({maxRPM:7000,nitro_H:1.2,nitro_cooling:0.9},28);
  assert.ok(nitro.nitroTorque[14]>nitro.torque[14]);
  const kept=model.calculate({maxRPM:7000},28); assert.deepEqual(kept.nitroTorque,nitro.nitroTorque);
  const timing=new CombustionModel().calculate({maxRPM:7000,time_in_close:0.35,time_spark_min:0.45},28);
  assert.notEqual(timing.torque[14],base.torque[14]);
  assert.throws(()=>model.calculate({stroke:1},28),/geometry/);
  assert.throws(()=>model.calculate({},0),/table size/);
});
test('native wheel curve uses the indexed load-dependent formula and signed aligning curve', () => {
  const curve=[1,0,1,0,1,0,0,0,0,0,0];
  near(wheelCurve(curve,1,2),Math.sqrt(2));
  assert.equal(wheelCurve(curve,-1,2),0);
  near(wheelCurve(curve,-1,2,true),-Math.sqrt(2));
  assert.equal(wheelCurve([0,0,1,0,1,0,0,0,0,0,0],1,2),0);
  assert.ok(effectiveTireLoad(16000,8000,0.4)<8000);
  const positive=nativeTireForces(3500,22,20,0,1/240,{longitudinal:0,angle:0},STOCK_WHEEL_PARAMETERS);
  const negative=nativeTireForces(3500,18,20,0,1/240,{longitudinal:0,angle:0},STOCK_WHEEL_PARAMETERS);
  assert.ok(positive.longitudinal>0 && negative.longitudinal<0);
  const corner=nativeTireForces(3500,20,20,3,1/240,{longitudinal:0,angle:0},STOCK_WHEEL_PARAMETERS);
  assert.ok(corner.lateral<0 && Number.isFinite(corner.aligning));
});
test('native slip relaxation works at rest and reaches direct slip at speed', () => {
  const rest=updateSlip(10,0,1,1/240,{longitudinal:0,angle:0});
  assert.ok(rest.longitudinal>0 && rest.angle>0);
  const speed=updateSlip(22,20,2,1/240,{longitudinal:0,angle:0});
  near(speed.longitudinal,0.1); near(speed.angle,Math.atan(0.1));
  assert.throws(()=>updateSlip(0,0,0,-1,{longitudinal:0,angle:0}));
});
test('native suspension has asymmetric bump/rebound damping and no tensile force', () => {
  const bump=nativeSuspensionForce(0.5,0.6,-0.1,0.9,0.9,1000,200,140);
  near(bump.force,440); near(bump.work,4);
  near(nativeSuspensionForce(0.5,0.6,0.1,0.9,0.9,1000,200,140).force,372);
  assert.equal(nativeSuspensionForce(1,0.6,0,0.9,0.9,1000,200,140).force,0);
});
test('native clutch exchange couples both inertias while an open clutch preserves independent speeds', () => {
  const input={engineSpeed:200,wheelSpeed:10,engineImpulse:0,engineInertia:4,transmissionInertia:700,engineInertiaFactor:1,gearRatio:3,finalDrive:3,clutch:0,previousDisplayedSpeed:200,drivenWeightSum:1};
  const closed=clutchExchange(input),open=clutchExchange({...input,clutch:1});
  assert.ok(closed.engineSpeed<200 && closed.wheelSpeed>10);
  near(open.engineSpeed,200);near(open.wheelSpeed,10);
  near(engineLimiter(3000,2800,3100),0.5); assert.equal(engineLimiter(3200,3100,3100),0);
  near(wheelBrake(0.1,1/240,0.1,1,0,20,0,0),0);
  near(wheelBrake(-10,1/240,0.1,1,0,20,0,0),-10+(1/240)*500*0.1*20);
});
test('native cooling responds to road speed and each car retains its engine/brake CFG values', () => {
  const hot=engineTemperatureStep(105,20,800000,150,0,[10,50,0.01],0.1);
  assert.ok(engineTemperatureStep(105,20,800000,150,50,[10,50,0.01],0.1)<hot);
  const cfg=parsePartConfig('enginepower 100 4 0.00006 0.003 700 32\nbrakepower 1000 2000');
  assert.deepEqual(cfg.enginePower,[100,4,0.00006,0.003,700,32]);assert.deepEqual(cfg.brakePower,[1000,2000]);
});
