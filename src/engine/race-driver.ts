import {Euler,Vector3} from 'three';
import type {Vehicle3D} from './vehicle-3d';
import type {RoadPoint} from '../formats/trc';
import type {RoadRoute,StraightRaceCrossing} from './road-route';
import type {DrivingInput} from './driving-demo';
import type {RigidBody3D} from './rigid-body-3d';
import {vehiclePairContact} from './vehicle-pair-test';

/** Traffic's hit callback also wakes its puppet into physical collision response. */
export function raceTrafficContact(car:Pick<Vehicle3D,'body'|'vehicleContact'>,traffic:{body:RigidBody3D;hit(impulse:Vector3,point:Vector3,closing:number):void}):boolean {
  const hit=vehiclePairContact(car.body,traffic.body);if(!hit)return false;
  if(hit.impulse.lengthSq()>1){car.vehicleContact(hit.impulse,hit.point,traffic.body.bounds.clone().applyMatrix4(traffic.body.matrix()),hit.closing);traffic.hit(hit.impulse.clone().negate(),hit.point,hit.closing);}
  const total=1/car.body.mass+1/traffic.body.mass,correction=Math.min(.15,Math.max(0,hit.depth-.002)*.6);
  car.body.position.addScaledVector(hit.normal,correction/car.body.mass/total);traffic.body.position.addScaledVector(hit.normal,-correction/traffic.body.mass/total);
  return true;
}

export const RACE_COMMANDS=['AI_race','AI_suspend','AI_stop','AI_BeginRace','leave'] as const;
/** NightRace modifies the current destination; it does not replace AI_race. */
export function raceCommand(readLatest:(names:readonly string[])=>string|undefined):string|undefined {
  const main=readLatest(RACE_COMMANDS);
  return main?.startsWith('AI_race ')&&readLatest([...RACE_COMMANDS,'AI_NightRace'])?.trim()==='AI_NightRace'
    ? `${main} AI_NightRace` : main;
}
export interface JavaRaceControl {
  /** Passive parked car: collision wakes physics, without a racing controller. */
  parked?:boolean;
  randomize?:boolean;
  command():string|undefined;
  active():boolean;
  /** A new Java placement, excluding poses published by the physics itself. */
  placement?():{position:Vector3;yaw:number;velocity:Vector3}|undefined;
  route?:(start:RoadPoint,finish:RoadPoint)=>RoadRoute|undefined;
  impact?:(closing:number)=>void;
  motion(position:Vector3,yaw:number,velocity:Vector3):void;
}
export function raceVehicleInput(driver:RaceDriver,car:Vehicle3D,command:string|undefined,dt:number):DrivingInput {
  const input=driver.update(command,car.body.position,new Euler().setFromQuaternion(car.body.orientation,'YXZ').y,car.body.velocity.dot(new Vector3(0,0,-1).applyQuaternion(car.body.orientation)),dt);
  const mechanics=car.suspension.mechanics;
  if(mechanics){
    mechanics.manual=false;
    input.start=(driver.status==='racing'||driver.status==='reversing')&&!mechanics.running;
    input.gearUp=driver.status==='racing'&&input.throttle>0&&mechanics.gear===0&&!mechanics.shifting;
    input.gearDown=driver.status==='reversing'&&input.throttle<0&&mechanics.gear===0&&!mechanics.shifting;
    input.clutch=!!input.clutch||mechanics.gear===0||mechanics.shifting;
  }
  return input;
}
export function raceDestination(command:string):RoadPoint|undefined {
  const match=/^AI_race\s+([\d.eE+-]+)\s*,\s*([\d.eE+-]+)\s*,\s*([\d.eE+-]+)(?:\s|$)/.exec(command);
  const point=match?.slice(1,4).map(Number);return point?.every(Number.isFinite)?point as RoadPoint:undefined;
}
/** Pursuit of a planned race route. No random traffic turns or traffic-signal stops. */
export class RaceDriver {
  private command='';private points:Vector3[]=[];private progress=0;private steering=0;
  private goal?:Vector3;private replanDelay=0;private routeLength=0;
  private blockedSeconds=0;private reverseSeconds=0;private reverseSteer=1;private previousThrottle=0;
  private routeRefresh=0;
  private straightCrossings:StraightRaceCrossing[]=[];
  private straightPass?:StraightRaceCrossing;
  private reaction=0;private launchTime=0;private launchRamp=0;private pace=1;private throttleScale=1;
  private runout?:{finish:Vector3;direction:Vector3};
  nightRace=false;
  status='suspended';
  constructor(private plan:(start:RoadPoint,finish:RoadPoint)=>RoadRoute|undefined,private wheelbase=2.7,private maxSteer=.6,private random?:()=>number){}
  update(command:string|undefined,position:Vector3,yaw:number,speed:number,dt:number):DrivingInput {
    if(command?.trim()==='AI_NightRace'&&this.goal)command=`${this.command.replace(/\s+AI_NightRace$/, '')} AI_NightRace`;
    this.replanDelay=Math.max(0,this.replanDelay-dt);
    this.routeRefresh=Math.max(0,this.routeRefresh-dt);
    const replan=()=>{
      this.progress=0;this.points=[];this.replanDelay=1;this.routeRefresh=2;this.routeLength=0;
      const route=this.goal&&this.plan(position.toArray(),this.goal.toArray());
      this.straightCrossings=route?.straightCrossings??[];
      if(route){this.points=route.points.map(p=>new Vector3(...p));if(!this.points.at(-1)?.equals(this.goal!))this.points.push(this.goal!.clone());}
      for(let i=1;i<this.points.length;i++)this.routeLength+=this.points[i-1].distanceTo(this.points[i]);
      this.status=route?'racing':'no route';
    };
    if(command!==this.command){
      // Java's finish trigger has a radius, so Bot.stop can arrive just before
      // the finish plane. Coast across it before applying the brakes.
      if(this.nightRace&&this.goal&&speed>2&&position.distanceTo(this.goal)<40&&command&&!raceDestination(command))
        this.runout={finish:this.goal.clone(),direction:new Vector3(-Math.sin(yaw),0,-Math.cos(yaw))};
      this.command=command??'';this.points=[];this.progress=0;
      this.straightPass=undefined;
      this.blockedSeconds=this.reverseSeconds=this.previousThrottle=0;
      const finish=command&&raceDestination(command);
      this.goal=finish?new Vector3(...finish):undefined;this.nightRace=!!finish&&/\sAI_NightRace(?:\s|$)/.test(command!);
      if(this.goal)this.runout=undefined;
      if(this.goal&&this.random){this.reaction=.05+this.random()*.4;this.launchRamp=.15+this.random()*.45;this.pace=.94+this.random()*.14;this.throttleScale=.88+this.random()*.12;this.launchTime=0;}
      if(this.goal)replan();else this.status='suspended';
    }
    const hold=():DrivingInput=>({throttle:0,steer:0,brake:true,brakeAxis:1,clutch:true});
    if(this.runout){
      if(speed>1&&position.clone().sub(this.runout.finish).dot(this.runout.direction)<10)
        return {throttle:0,steer:0,brake:false,start:true};
      this.runout=undefined;
    }
    const distance=this.goal?Math.hypot(position.x-this.goal.x,position.z-this.goal.z):Infinity;
    if(this.goal&&distance<=1&&!this.nightRace){this.status='finished';return hold();}
    if(this.goal&&(this.status==='finished'||this.status==='no route'&&this.replanDelay===0))replan();
    if(this.points.length<2)return hold();
    if(this.reaction>0){this.reaction=Math.max(0,this.reaction-dt);return hold();}
    this.launchTime+=dt;
    const lookahead=Math.max(4,Math.min(18,Math.abs(speed)*.8+4));
    const heading=new Vector3(-Math.sin(yaw),0,-Math.cos(yaw));
    const inPass=(c:StraightRaceCrossing,latched=false)=>{
      const direction=new Vector3(...c.direction),delta=position.clone().sub(new Vector3(...c.center)).setY(0);
      const along=delta.dot(direction),lateral=delta.addScaledVector(direction,-along).length();
      return speed>1&&along>=-c.radius-lookahead&&along<=c.radius+(latched?2:0)&&lateral<=c.radius
        &&heading.dot(direction)>Math.cos(latched?Math.PI/3:Math.PI/7);
    };
    if(this.straightPass&&!inPass(this.straightPass,true))this.straightPass=undefined;
    this.straightPass??=this.straightCrossings.find(c=>inPass(c));
    const coastingStraight=!!this.straightPass;
    if(this.routeRefresh===0&&this.status==='racing'&&!coastingStraight&&(!this.nightRace||distance>20))replan();
    if(Math.abs(speed)<.8&&this.previousThrottle>.25&&distance>2)this.blockedSeconds+=dt;
    else this.blockedSeconds=0;
    if(this.reverseSeconds>0){
      this.reverseSeconds=Math.max(0,this.reverseSeconds-dt);
      this.previousThrottle=0;this.status='reversing';
      if(this.reverseSeconds===0){this.blockedSeconds=0;replan();}
      return speed>.7?{throttle:0,steer:this.reverseSteer,brake:true,brakeAxis:1,start:true}
        :{throttle:speed< -3?0:-.65,steer:this.reverseSteer,brake:false,start:true};
    }
    // Project only onto the next section of the route; nearby crossing streets
    // must not jump the racer forward to an unrelated later segment.
    let best=Infinity,projected=this.progress,along=0;
    for(let i=1;i<this.points.length;i++){
      const a=this.points[i-1],delta=this.points[i].clone().sub(a),length=delta.length();if(length<1e-6)continue;
      if(along+length<this.progress-2){along+=length;continue;}if(along>this.progress+50)break;
      const t=Math.max(0,Math.min(1,position.clone().sub(a).dot(delta)/(length*length)));
      const d=a.clone().addScaledVector(delta,t).distanceToSquared(position);
      if(d<best){best=d;projected=along+t*length;}along+=length;
    }
    this.progress=Math.max(this.progress,projected);
    const at=(distance:number)=>{let left=distance;for(let i=1;i<this.points.length;i++){const a=this.points[i-1],b=this.points[i],length=a.distanceTo(b);if(left<=length)return a.clone().lerp(b,length?left/length:0);left-=length;}return this.points.at(-1)!.clone();};
    const finish=this.goal!,last=this.points.at(-1)!,incoming=last.clone().sub(this.points.at(-2)!);incoming.y=0;
    const pastFinish=position.clone().sub(finish).setY(0).dot(incoming)>0;
    const finishDirection=incoming.clone().normalize(),finishDelta=position.clone().sub(finish).setY(0);
    const crossedNightFinish=this.nightRace&&speed>2&&(pastFinish||distance<.1)&&finishDelta.clone().addScaledVector(finishDirection,-finishDelta.dot(finishDirection)).length()<5;
    if(pastFinish&&!crossedNightFinish&&this.progress>=this.routeLength-30&&this.replanDelay===0)replan();
    if(this.points.length<2)return hold();
    const target=at(this.progress+lookahead),error=target.sub(position);error.y=0;
    if(crossedNightFinish)error.copy(finish).addScaledVector(finishDirection,100).sub(position).setY(0);
    const targetYaw=Math.atan2(-error.x,-error.z),angle=Math.atan2(Math.sin(targetYaw-yaw),Math.cos(targetYaw-yaw));
    const curvature=coastingStraight?0:2*Math.sin(angle)/Math.max(2,error.length());
    // Pure pursuit's sin(pi) is zero: a target directly behind otherwise gives
    // straight steering forever. Commit to a turn until it is ahead again.
    const requested=coastingStraight?0:Math.abs(angle)>Math.PI/2?Math.sign(angle):Math.max(-1,Math.min(1,Math.atan(this.wheelbase*curvature)/this.maxSteer));
    if(coastingStraight)this.steering=0;
    this.steering+=Math.sign(requested-this.steering)*Math.min(Math.abs(requested-this.steering),dt*3);
    if(this.blockedSeconds>=2){this.reverseSeconds=3.5;this.reverseSteer=Math.abs(requested)>.1?-Math.sign(requested):this.reverseSteer*-1;this.blockedSeconds=0;this.status='reversing';this.previousThrottle=0;return {throttle:0,steer:this.reverseSteer,brake:true,brakeAxis:1,start:true};}
    const cornerSpeed=Math.sqrt(4.5/Math.max(this.nightRace?1e-9:.005,Math.abs(curvature)));
    const desired=Math.min(this.nightRace?Infinity:32*this.pace,cornerSpeed*this.pace,this.nightRace?Infinity:Math.sqrt(8*distance),!coastingStraight&&Math.abs(angle)>Math.PI/2?3.5:Infinity);
    const brake=Math.max(0,Math.min(1,(speed-desired)*.35));
    this.previousThrottle=brake>.05?0:Math.max(0,Math.min(1,(desired-speed)*.5));
    this.previousThrottle*=this.throttleScale*(this.launchRamp?Math.min(1,this.launchTime/this.launchRamp):1);
    return {throttle:this.previousThrottle,steer:this.steering,brake:brake>.05,brakeAxis:brake,start:true};
  }
}
