import { Box3, Vector3 } from 'three';
import { FixedClock } from '../runtime/fixed-clock';
import { RoadTrafficCar } from './road-traffic';
import type { RigidBody3D } from './rigid-body-3d';
import type { DrivingInput } from './driving-demo';
import type { Vehicle3D } from './vehicle-3d';

export type BotMode = 'cruise' | 'impact' | 'recover' | 'reverse';
export interface BotVehicle {
  readonly body: RigidBody3D;
  readonly collisionVersion: number;
  setMode?(mode:BotMode):void;
  step(dt: number, input: DrivingInput): void;
  impact(impulse: Vector3, point: Vector3, closing: number, otherBounds?: Box3): void;
}

/** The same driver can command a cheap traffic body or an already assembled full racer. */
export class FullVehicleBotAdapter implements BotVehicle {
  private version=0;
  constructor(readonly car:Vehicle3D){}
  get body(){return this.car.body;}
  get collisionVersion(){return this.version;}
  step(dt:number,input:DrivingInput){this.car.advance(dt,input);}
  impact(impulse:Vector3,point:Vector3,closing:number,otherBounds=new Box3(point.clone().addScalar(-.1),point.clone().addScalar(.1))){this.version++;this.car.vehicleContact(impulse,point,otherBounds,closing);}
}

/** Steering/behavior only. Changing modes never replaces a body or resets its damage/momentum. */
export class Bot {
  mode:BotMode='cruise';
  rpm=850;
  readonly clock=new FixedClock(60,15);
  input:DrivingInput={throttle:0,steer:0,brake:false};
  desiredSpeed=15/3.6;
  private stoppedFor=0;
  private blockedFor=0;
  private reversingFor=0;
  private reverseSteer=1;
  private collisionVersion=0;
  private target=new Vector3();
  private tangent=new Vector3();
  private forward=new Vector3();
  private lastPosition=new Vector3();
  private recoveryBound=false;
  constructor(readonly route:RoadTrafficCar,readonly vehicle:BotVehicle,private random=Math.random){this.lastPosition.copy(vehicle.body.position);}
  hit(impulse:Vector3,point:Vector3,closing:number,otherBounds?:Box3){
    this.vehicle.impact(impulse,point,closing,otherBounds);this.enterImpact();this.collisionVersion=this.vehicle.collisionVersion;
  }
  private enterImpact(){this.mode='impact';this.stoppedFor=this.blockedFor=0;this.recoveryBound=false;}
  private forwardSpeed(){this.forward.set(0,0,-1).applyQuaternion(this.vehicle.body.orientation);return this.vehicle.body.velocity.dot(this.forward);}
  private followingSpeed(peers:readonly RigidBody3D[],speed:number){
    const body=this.vehicle.body,own=body.bounds.getSize(new Vector3());
    for(const peer of peers){
      if(peer===body)continue;
      const delta=peer.position.clone().sub(body.position),along=delta.dot(this.forward);
      const lateral=Math.abs(delta.x*this.forward.z-delta.z*this.forward.x),size=peer.bounds.getSize(new Vector3());
      if(along<=0||Math.abs(delta.y)>2.5||lateral>(own.x+Math.max(size.x,size.z))*.5+.4)continue;
      const gap=along-(own.z+Math.max(size.x,size.z))*.5;
      speed=Math.min(speed,Math.sqrt(2*3*Math.max(0,gap-3)));
    }
    return speed;
  }
  private controls(dt:number,peers:readonly RigidBody3D[]){
    const body=this.vehicle.body,speed=this.forwardSpeed();
    if(this.mode==='impact'){
      this.stoppedFor=body.velocity.length()<.6&&body.omega.length()<.35?this.stoppedFor+dt:0;
      if(this.stoppedFor>=1){this.mode='recover';this.recoveryBound=false;}
      else return {throttle:0,steer:0,brake:true,brakeAxis:.8};
    }
    if(this.mode==='reverse'){
      this.reversingFor+=dt;
      if(this.reversingFor<3.5)return {throttle:-Math.max(0,Math.min(.75,(3+speed)*.8)),throttleMode:'directional' as const,steer:this.reverseSteer,brake:speed< -3.3,brakeAxis:speed< -3.3?.3:0};
      this.mode='recover';this.recoveryBound=false;this.blockedFor=0;
    }
    if(this.mode==='recover'&&!this.recoveryBound){this.route.rejoin(body.position);this.recoveryBound=true;}
    this.route.follow(body.position);
    const lookahead=Math.max(4,Math.min(12,Math.abs(speed)*1.3+3));
    this.route.targetAhead(lookahead,this.target,this.tangent);
    const error=this.target.clone().sub(body.position);error.y=0;
    const yaw=Math.atan2(-this.forward.x,-this.forward.z),targetYaw=Math.atan2(-error.x,-error.z);
    const angle=Math.atan2(Math.sin(targetYaw-yaw),Math.cos(targetYaw-yaw));
    if(this.mode==='recover'&&body.position.clone().sub(this.route.position).setY(0).length()<1.5&&this.forward.dot(this.route.direction)>.85){this.mode='cruise';this.recoveryBound=false;}
    const steering=Math.max(-1,Math.min(1,angle*2.2));
    let desired=this.mode==='recover'?30/3.6:15/3.6;
    desired*=Math.max(.28,1-Math.abs(angle)*.5);
    desired=this.followingSpeed(peers,desired);if(this.route.stopped)desired=0;
    this.desiredSpeed=desired;
    const throttle=Math.max(0,Math.min(1,(desired-speed)*.8+desired*.01));
    const brake=Math.max(0,Math.min(1,(speed-desired)*.6));
    const moved=body.position.distanceTo(this.lastPosition);this.lastPosition.copy(body.position);
    this.blockedFor=throttle>.45&&Math.abs(speed)<.5&&moved<dt*.5?this.blockedFor+dt:0;
    if(this.blockedFor>2){this.mode='reverse';this.reversingFor=0;this.reverseSteer=this.random()<.5?-1:1;}
    return {throttle,throttleMode:'directional' as const,steer:steering,brake:brake>.1,brakeAxis:brake};
  }
  advance(seconds:number,peers:readonly RigidBody3D[]=[]){
    this.clock.advance(Math.min(.25,Math.max(0,seconds)),()=>{
      this.input=this.controls(this.clock.dt,peers);this.vehicle.setMode?.(this.mode);this.vehicle.step(this.clock.dt,this.input);
      if(this.vehicle.collisionVersion!==this.collisionVersion){this.collisionVersion=this.vehicle.collisionVersion;if(this.mode==='cruise')this.enterImpact();}
      const speed=Math.abs(this.forwardSpeed()),gear=Math.max(1,Math.min(5,Math.floor(speed/6)+1));
      const target=850+speed*290/gear+Math.abs(this.input.throttle)*500;
      this.rpm+=(target-this.rpm)*(1-Math.exp(-this.clock.dt*5));
    });
  }
}
