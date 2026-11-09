import { Box3, Matrix4, Vector3 } from 'three';
import { FixedClock } from '../runtime/fixed-clock';
import { orientedBoxContact, type RigidBody3D } from './rigid-body-3d';
import { Vehicle3D } from './vehicle-3d';
import { physicsTickBudget } from './physics-timing';

export type VehiclePairScenario = 'offset' | 'side' | 'rear-chain';
const neutral={throttle:0,steer:0,brake:false};
const contactRadius=(body:RigidBody3D)=>Math.hypot(
  Math.max(Math.abs(body.bounds.min.x-body.center.x),Math.abs(body.bounds.max.x-body.center.x)),
  Math.max(Math.abs(body.bounds.min.y-body.center.y),Math.abs(body.bounds.max.y-body.center.y)),
  Math.max(Math.abs(body.bounds.min.z-body.center.z),Math.abs(body.bounds.max.z-body.center.z)));

/** Shared contact: finite masses and world-space inertia on both sides. */
export function vehiclePairContact(a:RigidBody3D,b:RigidBody3D) {
  // Most streamed pairs are far apart. Reject them before allocating SAT corners/axes.
  const reach=contactRadius(a)+contactRadius(b);if(a.position.distanceToSquared(b.position)>reach*reach)return;
  const bFrame=b.matrix().multiply(new Matrix4().setPosition(b.bounds.getCenter(new Vector3())));
  const hit=orientedBoxContact(a,bFrame,b.bounds.getSize(new Vector3()).multiplyScalar(.5));
  if(!hit)return;
  const aFrame=a.matrix().multiply(new Matrix4().setPosition(a.bounds.getCenter(new Vector3())));
  const reverse=orientedBoxContact(b,aFrame,a.bounds.getSize(new Vector3()).multiplyScalar(.5));
  const point=hit.point.clone();if(reverse)point.add(reverse.point).multiplyScalar(.5);
  const normal=hit.normal,relative=a.pointVelocity(point).sub(b.pointVelocity(point)),closing=-relative.dot(normal);
  const ra=point.clone().sub(a.position),rb=point.clone().sub(b.position);
  const effective=(direction:Vector3)=>1/a.mass+1/b.mass+direction.dot(
    new Vector3().crossVectors(a.inverseWorld(new Vector3().crossVectors(ra,direction)),ra)
      .add(new Vector3().crossVectors(b.inverseWorld(new Vector3().crossVectors(rb,direction)),rb)));
  const normalImpulse=Math.max(0,closing)*(closing>.8?1.08:1)/effective(normal);
  const impulse=normal.clone().multiplyScalar(normalImpulse);
  const tangent=relative.clone().addScaledVector(normal,-relative.dot(normal)),speed=tangent.length();
  if(speed>1e-8&&normalImpulse>0){tangent.divideScalar(speed);impulse.addScaledVector(tangent,-Math.min(.6*normalImpulse,speed/effective(tangent)));}
  return {point,normal,impulse,closing:Math.max(0,closing),depth:hit.depth};
}

/** Repeatable two-car stand. Contact hulls are chassis OBBs; both cars retain XPBD damage. */
export class VehiclePairTest {
  private clock:FixedClock;
  contacts=0;
  firstImpact?:{time:number;closing:number};
  obstacleImpact?:{time:number;speed:number};
  rearImpact?:{time:number;speed:number};
  readonly followingGap=100/3.6; // One second of travel at the following car's initial speed.
  readonly barrier=new Box3(new Vector3(-3,-.5,-8.4),new Vector3(3,2.8,-8));
  constructor(readonly a:Vehicle3D,readonly b:Vehicle3D,public scenario:VehiclePairScenario='offset') {
    if(a.physicsFrequency!==b.physicsFrequency)throw new Error('Vehicle pair requires a common physics rate');
    this.clock=new FixedClock(a.physicsFrequency,physicsTickBudget(a.physicsFrequency));this.reset();
  }
  get time(){return this.clock.tick*this.clock.dt;}
  reset(scenario:VehiclePairScenario=this.scenario) {
    this.scenario=scenario;this.contacts=0;this.firstImpact=undefined;
    this.obstacleImpact=this.rearImpact=undefined;
    this.clock=new FixedClock(this.a.physicsFrequency,physicsTickBudget(this.a.physicsFrequency));
    const a=this.a,b=this.b,widthA=a.body.bounds.getSize(new Vector3()).x,widthB=b.body.bounds.getSize(new Vector3()).x;
    // Opposing starts leave room to approach; positive speed follows each car's -Z axis.
    a.placeAt(new Vector3(0,0,8),0);
    if(scenario==='offset')b.placeAt(new Vector3(Math.min(widthA,widthB)*.5,0,-8),Math.PI);
    else if(scenario==='side')b.placeAt(new Vector3(0,0,-5),Math.PI/2);
    else b.placeAt(new Vector3(0,0,8+a.body.bounds.max.z-b.body.bounds.min.z+this.followingGap),0);
    for(const car of [a,b]){car.disableObstacle();car.settleSpawn();}
    if(scenario==='rear-chain')for(const car of [a,b]){
      car.obstacle.min.splice(0,3,...this.barrier.min.toArray());car.obstacle.max.splice(0,3,...this.barrier.max.toArray());
    }
    a.body.velocity.set(0,0,-50/3.6);
    b.body.velocity.set(0,0,scenario==='offset'?50/3.6:scenario==='rear-chain'?-100/3.6:0);
    for(const car of [a,b])for(const wheel of car.suspension.wheels)wheel.omega=car.velocity().length()/wheel.radius;
    a.syncRecordedPose();b.syncRecordedPose();
  }
  advance(seconds:number) {
    return this.clock.advance(seconds,()=>{
      const chain=this.scenario==='rear-chain';
      const hit=vehiclePairContact(this.a.body,this.b.body);
      if(hit){
        const boundsA=this.a.body.bounds.clone().applyMatrix4(this.a.body.matrix());
        const boundsB=this.b.body.bounds.clone().applyMatrix4(this.b.body.matrix());
        if(hit.impulse.lengthSq()>1){
          if(chain)this.rearImpact??={time:this.time,speed:this.b.velocity().length()};
          this.a.vehicleContact(hit.impulse,hit.point,boundsB,hit.closing);
          this.b.vehicleContact(hit.impulse.clone().negate(),hit.point,boundsA,hit.closing);
          this.contacts++;this.firstImpact??={time:this.time,closing:hit.closing};
        }
        // Separate once per shared tick, mass-weighted, without a restitution kick.
        const correction=Math.min(.2,Math.max(0,hit.depth-.002)*.6),inverse=1/this.a.body.mass+1/this.b.body.mass;
        this.a.body.position.addScaledVector(hit.normal,correction/this.a.body.mass/inverse);
        this.b.body.position.addScaledVector(hit.normal,-correction/this.b.body.mass/inverse);
      }
      this.a.advance(this.clock.dt,neutral);
      this.b.advance(this.clock.dt,neutral);
      if(chain&&!this.obstacleImpact&&this.a.impactSpeed>1){
        this.obstacleImpact={time:this.time,speed:this.a.impactSpeed};
      }
    });
  }
}
