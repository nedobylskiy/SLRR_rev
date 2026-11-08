import test from 'node:test';
import assert from 'node:assert/strict';
import {Box3,Matrix4,Vector3} from 'three';
import {RigidBody3D} from '../src/engine/rigid-body-3d';
import {Vehicle3D} from '../src/engine/vehicle-3d';
import {VehiclePairTest,vehiclePairContact,type VehiclePairScenario} from '../src/engine/vehicle-pair-test';
import {EngineWorld} from '../src/engine/world';
import {parsePartConfig} from '../src/formats/cfg';

const bounds=()=>new Box3(new Vector3(-.9,-.4,-2),new Vector3(.9,.6,2));
function rigid(x:number,z:number,yaw=0,mass=1000){
  const body=new RigidBody3D(mass,bounds());body.setFrame(new Matrix4().makeRotationY(yaw).setPosition(x,0,z));return body;
}
function resolve(a:RigidBody3D,b:RigidBody3D){
  const before=a.velocity.clone().multiplyScalar(a.mass).addScaledVector(b.velocity,b.mass);
  const kinetic=(body:RigidBody3D)=>.5*body.mass*body.velocity.lengthSq()+.5*body.momentum.dot(body.omega);
  const energy=kinetic(a)+kinetic(b),contact=vehiclePairContact(a,b);assert.ok(contact);
  a.impulse(contact.impulse,contact.point);b.impulse(contact.impulse.clone().negate(),contact.point);
  assert.ok(a.velocity.clone().multiplyScalar(a.mass).addScaledVector(b.velocity,b.mass).distanceTo(before)<1e-8,'equal/opposite impulses preserve linear momentum');
  assert.ok(kinetic(a)+kinetic(b)<=energy+1e-7,'contact does not manufacture kinetic energy');
  return contact;
}
test('two finite-mass cars exchange momentum with 50% overlap at 50 km/h each',()=>{
  const a=rigid(0,1.9),b=rigid(.9,-1.9,Math.PI);a.velocity.z=-50/3.6;b.velocity.z=50/3.6;
  const hit=resolve(a,b);assert.ok(hit.closing>27);
  assert.ok(Math.abs(a.omega.y)>.1&&Math.abs(b.omega.y)>.1,'offset contact rotates both vehicles');
  assert.ok(a.velocity.z>-50/3.6&&b.velocity.z<50/3.6);
});
test('a 50 km/h side strike accelerates a stationary perpendicular car',()=>{
  const a=rigid(0,2.5),b=rigid(0,0,Math.PI/2,1400);a.velocity.z=-50/3.6;
  resolve(a,b);assert.ok(b.velocity.z<-1,'target receives the impact instead of acting like a fixed obstacle');
});
test('separated cars do not exchange impulses',()=>assert.equal(vehiclePairContact(rigid(0,10),rigid(0,-10)),undefined));

function car(){
  const world=new EngineWorld();
  const make=(id:number,file:string,cfg:string)=>world.create({key:{pack:'test.rpk',id},alias:file,cfgPath:file,config:parsePartConfig(cfg)});
  const slots=[101,102,103,104].map((type,i)=>`slot 0 0 0 0 0 0 ${20+i}\nslottype ${type}`).join('\n');
  const wheels=[[-.7,-1.3],[.7,-1.3],[-.7,1.3],[.7,1.3]].map(([x,z],i)=>`type 10 sphere 0.3\nspring 0.29 0.1 0.05\nwheel ${x} -0.6 ${z} 0 0 0 ${i<2?1:0} 0 1 0`).join('\n');
  const root=make(1,'car.cfg',`body 0 -.2 0 0 0 0 1000 sphere 1\n${wheels}\n${slots}\nslot 0 .2 -1.4 0 0 0 601`);
  for(let i=0;i<4;i++)world.install(root,20+i,make(i+2,'wheel.cfg','slot 0 0 0 0 0 0 1'),1);
  const hood=make(7,'hood.cfg','slot 0 0 0 0 0 0 1\nbody 0 0 0 0 0 0 38.5 sphere 1');world.install(root,601,hood,1);
  const samples:number[]=[];for(const x of [-.7,.7])for(const y of [0,.12])for(const z of [-.6,.6])samples.push(x,y,z);
  const vehicle=new Vehicle3D(root,hood,samples,bounds(),undefined,undefined,120);
  const shell:number[]=[];for(const x of [-.9,.9])for(const y of [-.4,.6])for(const z of [-2,2])shell.push(x,y,z);
  vehicle.register(root,shell,[]);return {world,vehicle};
}
for(const scenario of ['offset','side'] as VehiclePairScenario[])test(`${scenario} stand damages both cars and reset restores both assemblies`,()=>{
  const a=car(),b=car();try{
    const pair=new VehiclePairTest(a.vehicle,b.vehicle,scenario);
    assert.equal(pair.a.velocity().length(),50/3.6);assert.equal(pair.b.velocity().length(),scenario==='offset'?50/3.6:0);
    for(let i=0;i<3*120;i++)pair.advance(1/120);
    assert.ok(pair.contacts>0,'the chosen approach actually reaches the other car');
    assert.ok(pair.a.root.condition<1&&pair.b.root.condition<1,'both cars receive damage');
    for(const vehicle of [pair.a,pair.b])assert.ok([...vehicle.body.position.toArray(),...vehicle.body.velocity.toArray()].every(Number.isFinite));
    pair.reset();assert.equal(pair.contacts,0);assert.equal(pair.time,0);assert.equal(pair.a.root.condition,1);assert.equal(pair.b.root.condition,1);
  }finally{a.world.dispose();b.world.dispose();}
});
for(const scenario of ['offset','rear-chain'] as VehiclePairScenario[])test(`${scenario} shared clock gives the same trajectory at different render rates`,()=>{
  const cars=[car(),car(),car(),car()];try{
    const a=new VehiclePairTest(cars[0].vehicle,cars[1].vehicle,scenario),b=new VehiclePairTest(cars[2].vehicle,cars[3].vehicle,scenario);
    for(let i=0;i<60;i++)a.advance(1/30);for(let i=0;i<240;i++)b.advance(1/120);
    assert.equal(a.contacts,b.contacts);assert.deepEqual(a.a.body.position,b.a.body.position);assert.deepEqual(a.b.body.position,b.b.body.position);
  }finally{cars.forEach(car=>car.world.dispose());}
});

for(const scale of [1,.25])test(`both chain cars move immediately with a one-second following gap at scale ${scale}`,()=>{
  const a=car(),b=car();try{
    const pair=new VehiclePairTest(a.vehicle,b.vehicle,'rear-chain'),dt=1/60;
    const gap=()=>pair.b.body.bounds.clone().applyMatrix4(pair.b.body.matrix()).min.z-pair.a.body.bounds.clone().applyMatrix4(pair.a.body.matrix()).max.z;
    assert.ok(Math.abs(gap()-100/3.6)<.01,'initial bumper clearance is one second of B travel');
    assert.equal(pair.a.body.velocity.z,-50/3.6);assert.equal(pair.b.body.velocity.z,-100/3.6);
    const za=pair.a.body.position.z,zb=pair.b.body.position.z;
    pair.advance(.1*scale);
    assert.ok(pair.a.body.position.z<za&&pair.b.body.position.z<zb,'both cars move before the barrier hit');
    assert.equal(pair.a.simulationTime,pair.b.simulationTime,'both cars integrate from the first tick');
    assert.equal(Boolean(pair.obstacleImpact),false);
    for(let frame=0;frame<5*60/scale&&!pair.rearImpact;frame++)pair.advance(dt*scale);
    assert.ok(pair.obstacleImpact,'A must first strike the actual barrier');assert.ok(pair.rearImpact,'B must then strike A');
    assert.ok(pair.rearImpact.time>pair.obstacleImpact.time,'barrier contact precedes the natural rear impact');
    assert.ok(pair.rearImpact.speed>0&&pair.rearImpact.speed<100/3.6,'B coasts physically rather than having its impact speed overwritten');
    assert.ok(pair.b.root.condition<1,'rear car also receives physical damage');
    pair.reset();assert.equal(pair.time,0);assert.equal(pair.obstacleImpact,undefined);assert.equal(pair.rearImpact,undefined);assert.ok(Math.abs(gap()-pair.followingGap)<.01);
  }finally{a.world.dispose();b.world.dispose();}
});
