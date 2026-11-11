import test from 'node:test';
import assert from 'node:assert/strict';
import {Box3,Vector3} from 'three';
import {EngineWorld} from '../src/engine/world';
import {parsePartConfig} from '../src/formats/cfg';
import {Vehicle3D} from '../src/engine/vehicle-3d';
import {MapTerrain} from '../src/engine/map-terrain';
import {MapCollision} from '../src/engine/map-collision';
import type {ScxModel} from '../src/formats/scx';
function curbModel(height=.15):ScxModel {
  const positions:number[]=[],indices:number[]=[];
  const quad=(a:number[],b:number[],c:number[],d:number[])=>{const n=positions.length/3;for(const p of [a,b,c,d])positions.push(...p.map(v=>v*100));indices.push(n,n+1,n+2,n,n+2,n+3);};
  quad([-80,0,20],[80,0,20],[80,0,-4],[-80,0,-4]);
  quad([-80,height,-4],[80,height,-4],[80,height,-80],[-80,height,-80]);
  quad([-80,0,-4],[80,0,-4],[80,height,-4],[-80,height,-4]);
  return {version:3,warnings:[],meshes:[{name:'road-curb-sidewalk',positions:new Float32Array(positions),indices:new Uint32Array(indices),normals:new Float32Array(positions.length),uv:new Float32Array(positions.length/3*2),diffuse:[1,1,1,1],textureIndex:0}]};
}
function car(terrain:MapTerrain,collision:MapCollision,yaw=0){
  const world=new EngineWorld(),create=(id:number,cfg:string)=>world.create({key:{pack:'test.rpk',id},alias:String(id),cfgPath:`${id}.cfg`,config:parsePartConfig(cfg)});
  const wheels=[[-.7,-1.3],[.7,-1.3],[-.7,1.3],[.7,1.3]].map(([x,z],i)=>`type 10 sphere .3\nspring .29 .1 .05\nwheel ${x} -.6 ${z} 0 0 0 ${i<2?1:0} 0 1 0\nslot 0 0 0 0 0 0 ${101+i}\nslottype ${101+i}`).join('\n');
  const root=create(1,`body 0 -.2 0 0 0 0 1200 sphere 1\n${wheels}\nslot 0 .21 -.807 0 0 0 601`);
  for(let i=0;i<4;i++)world.install(root,101+i,create(2+i,'slot 0 0 0 0 0 0 1'),1);
  const hood=create(6,'slot 0 .191 .696 0 0 0 601\nbody 0 0 0 0 0 0 20 sphere 1');world.install(root,601,hood,601);
  const samples=[-.7,.04,-.7,.7,.04,-.7,-.7,.04,.7,.7,.04,.7];
  const vehicle=new Vehicle3D(root,hood,samples,new Box3(new Vector3(-.85,-.55,-2.1),new Vector3(.85,.6,2.1)),terrain,collision,120);
  vehicle.placeAt(new Vector3(),yaw);vehicle.disableObstacle();vehicle.settleSpawn();return{world,vehicle,root,hood};
}
for(const yaw of [0,Math.PI/4,Math.PI/3])test(`car rolls onto a 15 cm curb at 10 km/h, ${Math.round(yaw*180/Math.PI)} degree approach`,()=>{
  const collision=new MapCollision(),terrain=new MapTerrain(collision),model=curbModel();collision.add(model);terrain.add(model);terrain.prepare();
  const {world,vehicle,root,hood}=car(terrain,collision,yaw);
  vehicle.body.velocity.set(-Math.sin(yaw),0,-Math.cos(yaw)).multiplyScalar(10/3.6);
  let lowest=Infinity;
  for(let i=0;i<480;i++){
    vehicle.advance(1/60,{throttle:.15,steer:0,brake:false});
    const frame=vehicle.body.matrix(),down=new Vector3(0,-1,0).applyQuaternion(vehicle.body.orientation);
    for(const wheel of vehicle.suspension.wheels){
      const center=wheel.hardpoint.clone().applyMatrix4(frame).addScaledVector(down,wheel.length);
      lowest=Math.min(lowest,center.y-wheel.radius-terrain.height(center.x,center.z,center.y));
    }
  }
  assert.ok(lowest>-.01,`wheel must not stay inside road/sidewalk: ${lowest}`);
  assert.ok(vehicle.body.position.z<-7,`car must reach sidewalk: ${vehicle.body.position.toArray()}`);
  assert.ok(vehicle.impactSpeed<1,`clearance above curb must not count as a wall impact: ${vehicle.impactSpeed}`);
  assert.ok(vehicle.suspension.wheels.every(w=>w.contact&&Math.abs(w.contactPoint.y-.162)<.02),'all wheels are supported by the sidewalk');
  assert.equal(hood.parent,root);world.dispose();
});

test('chassis lateral padding cannot reach down to a curb, while real body and wall contacts remain',()=>{
  const collision=new MapCollision();collision.add(curbModel());
  const above=new Vector3(0,.28,-3.9);
  assert.ok(collision.contact(above,.2,false),'ordinary sphere queries still include their full radius');
  assert.equal(collision.contact(above,.2,false,.02),undefined,'chassis clearance is measured at its real lower edge');
  const hit=collision.contact(new Vector3(0,.08,-3.9),.2,false,.02);
  assert.ok(hit&&hit.normal.z>.99,'a genuinely low bumper still contacts the curb face');
  const wall=new MapCollision();wall.add(curbModel(2));
  assert.ok(wall.contact(above,.2,false,.02),'tall walls still stop the car');
});

test('fully compressed suspension cannot leave a stationary wheel below the road',()=>{
  const collision=new MapCollision(),terrain=new MapTerrain(collision);terrain.add(curbModel());terrain.prepare();
  const {world,vehicle}=car(terrain,collision);
  vehicle.body.position.y-=.15;const before=vehicle.body.position.y;
  vehicle.suspension.resolveGroundContacts();vehicle.suspension.sync();
  assert.ok(vehicle.body.position.y>before+.05,'bump stops support the chassis, rather than merely raising the wheel mesh');
  const frame=vehicle.body.matrix(),down=new Vector3(0,-1,0).applyQuaternion(vehicle.body.orientation);
  for(const wheel of vehicle.suspension.wheels){
    const center=wheel.hardpoint.clone().applyMatrix4(frame).addScaledVector(down,wheel.length);
    assert.ok(center.y-wheel.radius>-.005,'rendered tyre stays above the actual road');
  }
  assert.ok(vehicle.body.velocity.y<.01,'positional correction does not launch a resting car');world.dispose();
});

test('removed wheels and an overturned car do not create suspension bump-stop support',()=>{
  const collision=new MapCollision(),terrain=new MapTerrain(collision);terrain.add(curbModel());terrain.prepare();
  const {world,vehicle}=car(terrain,collision);
  vehicle.body.orientation.setFromAxisAngle(new Vector3(0,0,1),Math.PI);
  let before=vehicle.body.position.clone();vehicle.suspension.resolveGroundContacts();assert.deepEqual(vehicle.body.position,before);
  vehicle.body.orientation.identity();vehicle.body.position.y-=.15;
  for(const wheel of vehicle.suspension.wheels)world.detach(wheel.part);
  before=vehicle.body.position.clone();vehicle.suspension.resolveGroundContacts();assert.deepEqual(vehicle.body.position,before);world.dispose();
});


test('a graded curb cannot block a chassis above its local top',()=>{
  const model=curbModel();
  const positions=model.meshes[0].positions;
  // Twenty percent grade along X; distant triangle vertices are much higher.
  for(let i=0;i<positions.length;i+=3)positions[i+1]+=positions[i]*.2;
  const collision=new MapCollision();collision.add(model);
  assert.equal(collision.contact(new Vector3(0,.28,-3.9),.2,false,.02),undefined);
  assert.ok(collision.contact(new Vector3(0,.08,-3.9),.2,false,.02));
});
