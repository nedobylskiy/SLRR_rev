import {Euler,Vector3} from 'three';
import type {Vehicle3D} from './vehicle-3d';
import type {RoadPoint} from '../formats/trc';
import type {RoadRoute} from './road-route';
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
export interface JavaRaceControl {
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
    input.start=driver.status==='racing'&&!mechanics.running;
    input.gearUp=driver.status==='racing'&&mechanics.gear<=0;
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
  status='suspended';
  constructor(private plan:(start:RoadPoint,finish:RoadPoint)=>RoadRoute|undefined,private wheelbase=2.7,private maxSteer=.6){}
  update(command:string|undefined,position:Vector3,yaw:number,speed:number,dt:number):DrivingInput {
    if(command!==this.command){
      this.command=command??'';this.points=[];this.progress=0;
      const finish=command&&raceDestination(command),route=finish?this.plan(position.toArray(),finish):undefined;
      if(route)this.points=route.points.map(p=>new Vector3(...p));
      this.status=finish?(route?'racing':'no route'):'suspended';
    }
    const hold=():DrivingInput=>({throttle:0,steer:0,brake:true,brakeAxis:1,clutch:true});
    if(this.points.length<2)return hold();
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
    const finish=this.points.at(-1)!;
    if(position.clone().sub(finish).setY(0).length()<3){this.status='finished';this.points=[];return hold();}
    const lookahead=Math.max(4,Math.min(18,Math.abs(speed)*.8+4)),target=at(this.progress+lookahead),error=target.sub(position);
    const targetYaw=Math.atan2(-error.x,-error.z),angle=Math.atan2(Math.sin(targetYaw-yaw),Math.cos(targetYaw-yaw));
    const curvature=2*Math.sin(angle)/Math.max(2,error.length());
    const requested=Math.max(-1,Math.min(1,Math.atan(this.wheelbase*curvature)/this.maxSteer));
    this.steering+=Math.sign(requested-this.steering)*Math.min(Math.abs(requested-this.steering),dt*3);
    const desired=Math.min(32,Math.sqrt(4.5/Math.max(.005,Math.abs(curvature))),Math.sqrt(8*position.distanceTo(finish)));
    const brake=Math.max(0,Math.min(1,(speed-desired)*.35));
    return {throttle:brake>.05?0:Math.max(0,Math.min(1,(desired-speed)*.5)),steer:this.steering,brake:brake>.05,brakeAxis:brake,start:true};
  }
}
