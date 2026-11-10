import {Box3,Matrix4,Vector3} from 'three';
import type {EnginePart} from './world';
import {RigidBody3D} from './rigid-body-3d';
import {Suspension3D,type Terrain} from './suspension-3d';
import {vehicleAssemblyMass,vehicleAssemblyCenter} from './vehicle-3d';
import {FixedClock} from '../runtime/fixed-clock';
import {NEUTRAL_INPUT} from './driving-demo';

/** Repeating full-width and staggered bumps, shared by physics and road rendering. */
export class SuspensionTestRoad implements Terrain {
  amplitude=.08;
  height(x:number,z:number){
    const phase=(((-z)%40)+40)%40;
    const bump=(at:number,width:number)=>{const d=Math.abs(phase-at)/width;return d<1?(1+Math.cos(d*Math.PI))*.5:0;};
    const left=(1-Math.tanh(x*4))*.5,right=1-left;
    return this.amplitude*(bump(8,1.1)+bump(24,1.7)+left*bump(16,1.2)+right*bump(32,1.2));
  }
  normal(x:number,z:number){const e=.005;return new Vector3((this.height(x-e,z)-this.height(x+e,z))/(2*e),1,(this.height(x,z-e)-this.height(x,z+e))/(2*e)).normalize();}
}

/** Guided forward speed; vertical motion, pitch/roll, tyres and travel use the live suspension. */
export class SuspensionRoadTest {
  readonly body:RigidBody3D;readonly suspension:Suspension3D;readonly terrain=new SuspensionTestRoad();
  private clock=new FixedClock(120,16);private originals:Map<EnginePart,Matrix4>;
  speed=20/3.6;paused=false;
  constructor(readonly root:EnginePart,bounds:Box3){
    this.originals=new Map([...root.world.parts.values()].map(p=>[p,p.local.clone()]));
    this.body=new RigidBody3D(vehicleAssemblyMass(root.world.parts.values()),bounds,vehicleAssemblyCenter(root));
    this.suspension=new Suspension3D(root,this.body,this.terrain);this.reset();
  }
  reset(){
    for(const [part,matrix] of this.originals)part.local.copy(matrix);
    this.suspension.reset();this.clock=new FixedClock(120,16);
    const clearance=Math.max(...this.suspension.wheels.map(w=>w.radius-w.center.y))+.02;
    this.body.setFrame(new Matrix4().makeTranslation(0,clearance,0));
    for(let i=0;i<240;i++){this.suspension.step(1/120,NEUTRAL_INPUT);this.body.integrate(1/120);}
    this.body.velocity.set(0,0,0);this.body.setAngularVelocity(new Vector3());this.sync();
  }
  private sync(){this.root.local.copy(this.body.matrix());this.suspension.sync();}
  advance(seconds:number){
    if(this.paused)return;
    this.clock.advance(Math.min(.08,Math.max(0,seconds)),(_tick,dt)=>{
      // A test guide supplies longitudinal motion without transmission/engine tuning.
      this.body.velocity.x=0;this.body.velocity.z=-this.speed;
      this.suspension.step(dt,NEUTRAL_INPUT);this.body.integrate(dt);
      this.body.position.x=this.body.center.x;
      if(this.body.position.z< -160)this.body.position.z+=160;
    });this.sync();
  }
  wheelPosition(index:number){const wheel=this.suspension.wheels[index];return new Vector3().setFromMatrixPosition(wheel.part.local.clone().multiply(wheel.inverseOwn.clone().invert())).applyMatrix4(this.root.matrix());}
  dispose(){for(const [part,matrix] of this.originals){part.local.copy(matrix);part.steeringTransform.identity();part.armTravelTransform=undefined;}}
}
