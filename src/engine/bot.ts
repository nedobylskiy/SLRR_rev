import { Box3, Vector3 } from 'three';
import { FixedClock } from '../runtime/fixed-clock';
import { RoadTrafficCar } from './road-traffic';
import type { RigidBody3D } from './rigid-body-3d';
import type { DrivingInput } from './driving-demo';
import type { Vehicle3D } from './vehicle-3d';
import type { TrafficControl } from './traffic-control';

export type BotMode = 'cruise' | 'impact' | 'recover' | 'reverse' | 'ram';
export interface BotVehicle {
  readonly body: RigidBody3D;
  readonly collisionVersion: number;
  readonly wheelbase?:number;
  readonly maxSteerAngle?:number;
  readonly physicalSteering?:boolean;
  setMode?(mode:BotMode):void;
  step(dt: number, input: DrivingInput): void;
  impact(impulse: Vector3, point: Vector3, closing: number, otherBounds?: Box3): void;
}

/** The same driver can command a cheap traffic body or an already assembled full racer. */
export class FullVehicleBotAdapter implements BotVehicle {
  private version=0;
  readonly wheelbase:number;
  constructor(readonly car:Vehicle3D){const wheels=car.suspension.wheels;this.wheelbase=wheels.length?Math.max(1,Math.max(...wheels.map(w=>w.originalHardpoint.z))-Math.min(...wheels.map(w=>w.originalHardpoint.z))):3;}
  get body(){return this.car.body;}
  get collisionVersion(){return this.version;}
  get maxSteerAngle(){return this.car.root.definition.config.maxSteer??.6;}
  readonly physicalSteering=true;
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
  private crossingKey='';
  private clearedCrossing=false;
  private entryAllowedLastTick=false;
  private stopSeconds=0;
  private holdingBrake=false;
  private startDelay?:number;
  private laneCheckSeconds=0;
  private speedCrossings=0;
  private yellowVisit='';
  private yellowGo=false;
  private cruiseCommand:number;
  private steeringCommand=0;
  private junctionStoppedFor=0;
  private idleFor=0;
  get cruiseSetpoint(){return this.cruiseCommand;}
  trafficStatus='';
  constructor(readonly route:RoadTrafficCar,readonly vehicle:BotVehicle,private random=Math.random,public cruiseSpeed=15/3.6,readonly traffic?:TrafficControl){this.lastPosition.copy(vehicle.body.position);this.speedCrossings=route.crossingsPassed;this.cruiseCommand=cruiseSpeed;}
  hit(impulse:Vector3,point:Vector3,closing:number,otherBounds?:Box3){
    this.vehicle.impact(impulse,point,closing,otherBounds);this.enterImpact();this.collisionVersion=this.vehicle.collisionVersion;
  }
  private enterImpact(){this.mode='impact';this.stoppedFor=this.blockedFor=this.idleFor=0;this.recoveryBound=false;this.holdingBrake=false;this.startDelay=undefined;}
  private forwardSpeed(){this.forward.set(0,0,-1).applyQuaternion(this.vehicle.body.orientation);return this.vehicle.body.velocity.dot(this.forward);}
  private followingSpeed(peers:readonly RigidBody3D[],speed:number){
    const body=this.vehicle.body,own=body.bounds.getSize(new Vector3());
    for(const peer of peers){
      if(peer===body)continue;
      const delta=peer.position.clone().sub(body.position),along=delta.dot(this.forward);
      const lateral=Math.abs(delta.x*this.forward.z-delta.z*this.forward.x),size=peer.bounds.getSize(new Vector3());
      const peerForward=new Vector3(0,0,-1).applyQuaternion(peer.orientation),alignment=Math.abs(peerForward.dot(this.forward));
      const across=Math.sqrt(Math.max(0,1-alignment*alignment));
      const peerLength=size.z*alignment+size.x*across,peerWidth=size.x*alignment+size.z*across;
      if(along<=0||Math.abs(delta.y)>2.5||lateral>(own.x+peerWidth)*.5+.3)continue;
      const gap=along-(own.z+peerLength)*.5;
      const ownSpeed=Math.max(0,this.vehicle.body.velocity.dot(this.forward)),leadSpeed=Math.max(0,peer.velocity.dot(this.forward));
      const following=Math.max(0,leadSpeed+(gap-3-ownSpeed*1.2)*.7);
      speed=Math.min(speed,following,Math.sqrt(2*3*Math.max(0,gap-3)));
    }
    return speed;
  }
  private rearClear(peers:readonly RigidBody3D[]){
    const body=this.vehicle.body,own=body.bounds.getSize(new Vector3());
    return peers.every(peer=>{
      if(peer===body)return true;
      const delta=peer.position.clone().sub(body.position),along=delta.dot(this.forward),size=peer.bounds.getSize(new Vector3());
      const alignment=Math.abs(new Vector3(0,0,-1).applyQuaternion(peer.orientation).dot(this.forward)),across=Math.sqrt(Math.max(0,1-alignment*alignment));
      const length=size.z*alignment+size.x*across,width=size.x*alignment+size.z*across;
      return along>=0||Math.abs(delta.y)>2.5||Math.abs(delta.x*this.forward.z-delta.z*this.forward.x)>(own.x+width)*.5+.6||-along>(own.z+length)*.5+10;
    });
  }
  private curveSpeed(speed:number){
    const point=new Vector3(),direction=new Vector3(),previous=new Vector3();
    this.route.targetAhead(0,point,previous);
    let limit=Infinity;
    const step=5,horizon=Math.min(160,Math.max(25,speed*speed/5+10));
    for(let distance=step;distance<=horizon;distance+=step){
      this.route.targetAhead(distance,point,direction);
      const angle=Math.acos(Math.max(-1,Math.min(1,previous.dot(direction))));
      if(angle>.025){const corner=Math.sqrt(1.7*step/angle);limit=Math.min(limit,Math.sqrt(corner*corner+5*Math.max(0,distance-step-5)));}
      previous.copy(direction);
    }
    return limit;
  }
  private controls(dt:number,peers:readonly RigidBody3D[]){
    const body=this.vehicle.body,speed=this.forwardSpeed();
    if(this.mode!=='impact'&&this.mode!=='ram'&&body.velocity.lengthSq()<(3/3.6)**2)this.idleFor+=dt;
    else this.idleFor=0;
    if(this.idleFor>60){this.mode='ram';this.idleFor=0;this.holdingBrake=false;this.startDelay=undefined;}
    const physical=this.vehicle.physicalSteering!==false&&this.vehicle.wheelbase!==undefined,wheelbase=this.vehicle.wheelbase??3;
    if(this.mode==='impact'){
      this.stoppedFor=body.velocity.length()<.6&&body.omega.length()<.35?this.stoppedFor+dt:0;
      if(this.stoppedFor>=1){this.mode='recover';this.recoveryBound=false;}
      else return {throttle:0,steer:0,brake:true,brakeAxis:.8};
    }
    if(this.mode==='reverse'){
      this.steeringCommand=this.reverseSteer;
      if(!this.rearClear(peers))return {throttle:0,steer:this.reverseSteer,brake:true,brakeAxis:1};
      this.reversingFor+=dt;
      if(this.reversingFor<3.5)return {throttle:-Math.max(0,Math.min(.75,(3+speed)*.8)),throttleMode:'directional' as const,steer:this.reverseSteer,brake:speed< -3.3,brakeAxis:speed< -3.3?.3:0};
      this.mode='recover';this.recoveryBound=false;this.blockedFor=0;
    }
    if(this.mode==='recover'&&!this.recoveryBound){this.route.rejoin(body.position);this.recoveryBound=true;}
    const before=this.route.approach,beforeRule=before&&this.traffic?.rule(before.road);
    const rememberedEntry=before?.key===this.crossingKey&&(this.clearedCrossing||this.entryAllowedLastTick);
    const beforeSignal=beforeRule?.kind==='signal'?this.traffic!.state(beforeRule.crossing,beforeRule.branch):undefined;
    const yellowPermission=beforeSignal==='yellow'&&before?.key===this.crossingKey&&this.yellowGo&&this.yellowVisit===`${before.key}:${this.traffic!.phaseRevision}`;
    const mayEnter=this.mode!=='cruise'||!beforeRule||rememberedEntry||beforeSignal==='green'||yellowPermission;
    this.route.follow(body.position,mayEnter,physical?Math.max(1.5,Math.min(4,wheelbase*.5)):1.5);
    if(this.route.crossingsPassed!==this.speedCrossings){
      this.speedCrossings=this.route.crossingsPassed;
      if(this.route.speedGroup!==undefined){const fast=this.route.speedGroup===0;this.cruiseSpeed=((fast?60:15)+this.random()*(fast?40:20))/3.6;this.cruiseCommand=Math.max(0,speed);}
    }
    // Ramp from the real exit speed, avoiding both hard braking and a surge back to the old cruise target.
    const cruiseDelta=this.cruiseSpeed-this.cruiseCommand;
    this.cruiseCommand+=Math.sign(cruiseDelta)*Math.min(Math.abs(cruiseDelta),(cruiseDelta>0?.8:1.2)*dt);
    const lookahead=physical?Math.max(4,wheelbase*.8,Math.min(18,Math.abs(speed)*1.1+3)):Math.max(4,Math.min(12,Math.abs(speed)*1.3+3));
    if(physical)this.route.steeringTargetAhead(lookahead,Math.min(6,wheelbase*.5),this.target,this.tangent);
    else this.route.targetAhead(lookahead,this.target,this.tangent);
    const error=this.target.clone().sub(body.position);error.y=0;
    if(physical)error.addScaledVector(this.forward,wheelbase*.5);
    const yaw=Math.atan2(-this.forward.x,-this.forward.z),targetYaw=Math.atan2(-error.x,-error.z);
    const angle=Math.atan2(Math.sin(targetYaw-yaw),Math.cos(targetYaw-yaw));
    if(this.mode==='recover'&&body.position.clone().sub(this.route.position).setY(0).length()<1.5&&this.forward.dot(this.route.direction)>.85){this.mode='cruise';this.recoveryBound=false;}
    const requested=Math.max(-1,Math.min(1,physical?Math.atan2(2*wheelbase*Math.sin(angle),Math.max(1,error.length()))/(this.vehicle.maxSteerAngle??.6):angle*2.2));
    this.steeringCommand+=Math.sign(requested-this.steeringCommand)*Math.min(Math.abs(requested-this.steeringCommand),physical?dt*2.5:2);
    const steering=this.steeringCommand;
    if(this.mode==='ram'){
      this.desiredSpeed=30/3.6;this.trafficStatus='ram · below 3 km/h for 60s';
      return {throttle:Math.max(0,Math.min(1,(this.desiredSpeed-speed)*.8)),throttleMode:'directional' as const,steer:steering,brake:false,brakeAxis:0};
    }
    let desired=this.mode==='recover'?Math.max(30/3.6,this.cruiseSpeed):this.cruiseCommand;
    desired*=Math.max(.28,1-Math.abs(angle)*.5);
    if(physical)desired=Math.min(desired,this.curveSpeed(Math.max(0,speed)));
    this.trafficStatus='';
    const approach=this.route.approach,rule=approach&&this.traffic?.rule(approach.road);
    if(approach&&rule&&this.mode==='cruise'){
      if(approach.key!==this.crossingKey){this.crossingKey=approach.key;this.clearedCrossing=false;this.stopSeconds=0;this.entryAllowedLastTick=false;this.yellowVisit='';this.yellowGo=false;}
      const front=body.center.z-body.bounds.min.z;
      const line=approach.remaining-front,stopDistance=line-1;
      const signal=rule.kind==='signal'?this.traffic!.state(rule.crossing,rule.branch):undefined;
      if(signal==='yellow'&&!this.clearedCrossing&&line<=Math.max(15,Math.max(0,speed)*3)){
        const visit=`${approach.key}:${this.traffic!.phaseRevision}`;
        if(this.yellowVisit!==visit){this.yellowVisit=visit;this.yellowGo=speed>.5&&!this.holdingBrake&&this.random()<.5;}
      }
      const goOnYellow=signal==='yellow'&&this.yellowGo&&this.yellowVisit===`${approach.key}:${this.traffic!.phaseRevision}`;
      // Only a permitted entry is latched. Creeping or being pushed over a red line is not permission.
      if(line<=0&&(signal==='green'||goOnYellow||this.entryAllowedLastTick))this.clearedCrossing=true;
      if(!this.clearedCrossing){
        let blocked=signal!==undefined?signal!=='green'&&!goOnYellow:true;
        if(goOnYellow)desired=Math.min(this.cruiseSpeed+10/3.6,desired*1.2);
        if(signal===undefined){
          if(stopDistance<1.25&&Math.abs(speed)<.2)this.stopSeconds+=dt;else this.stopSeconds=0;
          if(this.stopSeconds>=5){this.clearedCrossing=true;blocked=false;}
        }
        this.trafficStatus=`${signal??`${rule.kind} ${Math.min(5,this.stopSeconds).toFixed(1)}/5s`}${signal==='yellow'?goOnYellow?' · accelerate':' · brake':''} · Cross #${rule.crossing} · branch #${rule.branch}`;
        if(blocked)desired=Math.min(desired,stopDistance<.25?0:Math.sqrt(2*2.5*Math.max(0,stopDistance)));
      }
      this.entryAllowedLastTick=this.clearedCrossing||signal==='green'||goOnYellow;
    }
    const following=this.followingSpeed(peers,desired),limitedByLeader=following<desired-1e-6;
    this.laneCheckSeconds+=dt;
    const rural=this.route.speedGroup===0,lanePeriod=rural?10:20,laneChance=Math.max(rural?.25:.1,limitedByLeader?.2:0);
    if(this.laneCheckSeconds>=lanePeriod-1e-9){
      this.laneCheckSeconds=0;
      if(this.mode==='cruise'&&speed>.5&&this.route.approach&&this.random()<laneChance){
        const length=Math.max(25,speed*3.5);
        this.route.tryChangeLane(body.position,length,(point,direction)=>peers.every(peer=>{
          if(peer===body)return true;
          const delta=peer.position.clone().sub(point),along=delta.dot(direction),lateral=Math.abs(delta.x*direction.z-delta.z*direction.x);
          const size=peer.bounds.getSize(new Vector3()),own=body.bounds.getSize(new Vector3());
          const rearSpeed=Math.max(0,peer.velocity.dot(direction));
          return Math.abs(delta.y)>2.5||lateral>(Math.max(size.x,size.z)+own.x)*.5+.5||along>Math.max(12,speed*2)+(size.z+own.z)*.5||along< -Math.max(12,rearSpeed*2)-(size.z+own.z)*.5;
        }));
      }
    }
    desired=following;if(this.route.stopped)desired=0;
    // A queued car must hold its pedal instead of alternating tiny creep commands and no brake.
    // Hysteresis lets the lead car pull away before releasing, without flickering brake lamps.
    if(desired>.8&&this.holdingBrake){
      this.startDelay??=.5+Math.max(0,Math.min(1,this.random()));
      this.startDelay-=dt;
      if(this.startDelay<=1e-9){this.holdingBrake=false;this.startDelay=undefined;}
      else this.trafficStatus+=`${this.trafficStatus?' · ':''}reaction ${this.startDelay.toFixed(1)}s`;
    }else if(desired<=.8){
      this.startDelay=undefined;
      if(desired<.5&&Math.abs(speed)<.3)this.holdingBrake=true;
    }
    if(this.holdingBrake)desired=0;
    this.desiredSpeed=desired;
    const throttle=Math.max(0,Math.min(1,(desired-speed)*.8+desired*.01));
    const brake=desired===0&&Math.abs(speed)<.3?.6:Math.max(0,Math.min(1,(speed-desired)*.6));
    const moved=body.position.distanceTo(this.lastPosition);this.lastPosition.copy(body.position);
    this.blockedFor=throttle>.45&&Math.abs(speed)<.5&&moved<dt*.5?this.blockedFor+dt:0;
    const exit=this.route.junctionExitDistance,inJunction=this.route.insideCrossing||(exit!==undefined&&exit<body.bounds.getSize(new Vector3()).z);
    this.junctionStoppedFor=this.mode==='cruise'&&inJunction&&Math.abs(speed)<.5&&moved<dt*.5?this.junctionStoppedFor+dt:0;
    if((this.blockedFor>2||this.junctionStoppedFor>3)&&this.rearClear(peers)){
      this.mode='reverse';this.reversingFor=0;this.reverseSteer=Math.abs(angle)>.1?-Math.sign(angle):this.random()<.5?-1:1;
      this.junctionStoppedFor=0;this.holdingBrake=false;this.startDelay=undefined;
    }
    return {throttle,throttleMode:'directional' as const,steer:steering,brake:brake>.1,brakeAxis:brake};
  }
  advance(seconds:number,peers:readonly RigidBody3D[]=[]){
    this.clock.advance(Math.min(.25,Math.max(0,seconds)),()=>{
      this.input=this.controls(this.clock.dt,peers);this.vehicle.setMode?.(this.mode);this.vehicle.step(this.clock.dt,this.input);
      if(this.vehicle.collisionVersion!==this.collisionVersion){this.collisionVersion=this.vehicle.collisionVersion;if(this.mode==='cruise'||this.mode==='ram')this.enterImpact();}
      const speed=Math.abs(this.forwardSpeed()),gear=Math.max(1,Math.min(5,Math.floor(speed/6)+1));
      const target=850+speed*290/gear+Math.abs(this.input.throttle)*500;
      this.rpm+=(target-this.rpm)*(1-Math.exp(-this.clock.dt*5));
    });
  }
  /** Control-only integration: the owner's normal physics clock advances the full vehicle exactly once. */
  command(dt:number,peers:readonly RigidBody3D[]=[]):DrivingInput {
    this.input=this.controls(dt,peers);return this.input;
  }
}
