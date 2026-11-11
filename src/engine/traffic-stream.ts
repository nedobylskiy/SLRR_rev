import {Matrix4,Vector3} from 'three';
import {sampleRoadSegment,type RoadNetwork} from '../formats/trc';
import {trafficConnections,trafficRoadSpeedGroups,RoadTrafficCar} from './road-traffic';
import {TrafficVehicle} from './traffic-vehicle';
import {Bot,type BotMode,type BotVehicle} from './bot';
import type {TrafficControl} from './traffic-control';
import type {RigidBody3D} from './rigid-body-3d';
import type {DrivingInput} from './driving-demo';

export interface TrafficSpawn {road:number;position:Vector3;direction:Vector3;speedGroup?:0|1}
export type TrafficOccupant=Vector3&{trafficRadius?:number;trafficVelocity?:Vector3};
export function trafficCruiseSpeed(group:0|1|undefined,random=Math.random){return ((group===0?60:15)+random()*(group===0?40:20))/3.6;}
/** Seed real velocity as well as the driver's target; queues, curves and red lights still cap it. */
export function initializeTrafficMotion(route:RoadTrafficCar,vehicle:BotVehicle,control?:TrafficControl,peers:readonly RigidBody3D[]=[],random=Math.random){
  const speed=trafficCruiseSpeed(route.speedGroup,random),bot=new Bot(route,vehicle,random,speed,control);
  vehicle.body.velocity.copy(route.direction).multiplyScalar(speed);
  bot.command(0,peers);vehicle.body.velocity.copy(route.direction).multiplyScalar(bot.desiredSpeed);
  const gear=Math.max(1,Math.min(5,Math.floor(bot.desiredSpeed/6)+1));bot.rpm=850+bot.desiredSpeed*290/gear;
  return bot;
}
/** Reject close visible/front spawns and imminent overlaps even when the target population is not full. */
export function safeTrafficSpawn(spawn:TrafficSpawn,center:Vector3,forward:Vector3,playerSpeed:number,visible:boolean,occupied:readonly TrafficOccupant[],bodyRadius:number){
  const delta=spawn.position.clone().sub(center),distance=Math.hypot(delta.x,delta.z),ahead=delta.dot(forward)/Math.max(1,distance);
  if(distance<20+bodyRadius)return false;
  if((visible||ahead>.25)&&distance<Math.max(80,playerSpeed*4+bodyRadius+10))return false;
  const velocity=spawn.direction.clone().multiplyScalar(trafficCruiseSpeed(spawn.speedGroup,()=>1));
  for(const peer of occupied){
    if(Math.abs(peer.y-spawn.position.y)>4)continue;
    const offset=spawn.position.clone().sub(peer),relative=velocity.clone().sub(peer.trafficVelocity??new Vector3());
    const t=Math.max(0,Math.min(3,-offset.dot(relative)/Math.max(.001,relative.lengthSq())));
    if(offset.addScaledVector(relative,t).setY(0).length()<bodyRadius+(peer.trafficRadius??6)+5)return false;
  }
  return true;
}
const CELL=100;
/** Immutable lane samples indexed once per map, not rebuilt as the player moves. */
export class TrafficSpawnIndex {
  private cells=new Map<string,TrafficSpawn[]>();
  constructor(readonly network:RoadNetwork){
    const connected=trafficConnections(network),groups=trafficRoadSpeedGroups(network);
    for(const road of network.others){
      if(!connected.get(road.id)?.length)continue;
      for(const segment of road.segments){
        const steps=Math.max(1,Math.ceil(segment.length/20));
        for(let i=0;i<steps;i++){
          const position=new Vector3(...sampleRoadSegment(segment,(i+.5)/steps));
          const t=(i+.5)/steps,direction=new Vector3(...sampleRoadSegment(segment,Math.max(0,t-.001))).sub(new Vector3(...sampleRoadSegment(segment,Math.min(1,t+.001)))).normalize();
          const key=`${Math.floor(position.x/CELL)},${Math.floor(position.z/CELL)}`,cell=this.cells.get(key)??[];
          cell.push({road:road.id,position,direction,speedGroup:groups.get(road.id)});this.cells.set(key,cell);
        }
      }
    }
  }
  nearest(position:Vector3):TrafficSpawn|undefined {
    const nearby=this.choose(position,200,[],()=>0,0,true,undefined,0,sample=>Math.abs(sample.position.y-position.y)<4);
    if(nearby)return nearby;
    let best:TrafficSpawn|undefined,distance=Infinity;
    for(const cell of this.cells.values())for(const sample of cell){const d=sample.position.distanceToSquared(position);if(d<distance){distance=d;best=sample;}}
    return best;
  }
  choose(center:Vector3,radius:number,occupied:readonly TrafficOccupant[],random=Math.random,minDistance=15,preferNear=false,preferred?:(spawn:TrafficSpawn)=>boolean,bodyRadius=6,accept?:(spawn:TrafficSpawn)=>boolean):TrafficSpawn|undefined {
    let selected:TrafficSpawn|undefined,count=0,best=Infinity,selectedPreferred=false;
    for(let x=Math.floor((center.x-radius)/CELL);x<=Math.floor((center.x+radius)/CELL);x++)for(let z=Math.floor((center.z-radius)/CELL);z<=Math.floor((center.z+radius)/CELL);z++){
      for(const candidate of this.cells.get(`${x},${z}`)??[]){
        const p=candidate.position,distance=Math.hypot(p.x-center.x,p.z-center.z);
        if(distance<minDistance||distance>radius||occupied.some(other=>Math.abs(other.y-p.y)<4&&Math.hypot(other.x-p.x,other.z-p.z)<Math.max(14,bodyRadius+(other.trafficRadius??6)+2)))continue;
        if(accept&&!accept(candidate))continue;
        const isPreferred=preferred?.(candidate)??false;
        if(isPreferred&&!selectedPreferred){selectedPreferred=true;selected=undefined;count=0;best=Infinity;}
        else if(!isPreferred&&selectedPreferred)continue;
        if(preferNear){if(distance<best-1e-6||Math.abs(distance-best)<1e-6&&random()<.5){selected=candidate;best=distance;}}
        else if(random()<1/++count)selected=candidate;
      }
    }
    return selected;
  }
}

export function chooseSafeTrafficSpawn(index:TrafficSpawnIndex,center:Vector3,radius:number,streamRadius:number,occupied:readonly TrafficOccupant[],forward:Vector3,playerSpeed:number,bodyRadius:number,offscreen:(spawn:TrafficSpawn)=>boolean,random=Math.random){
  radius=Math.min(radius,streamRadius);
  const choose=(range:number,blindOnly:boolean)=>index.choose(center,range,occupied,random,20,true,offscreen,bodyRadius,
    spawn=>(!blindOnly||offscreen(spawn))&&safeTrafficSpawn(spawn,center,forward,playerSpeed,!offscreen(spawn),occupied,bodyRadius));
  // Population is a cap: never relax safety just to fill every slot. Expansion is offscreen only.
  return choose(radius,true)??choose(Math.min(streamRadius,Math.max(radius*2,radius+100)),true)??choose(radius,false);
}

/** Same persistent body/dents at both levels; distant movement never invokes the physical solver. */
export class TrafficVehicleLod implements BotVehicle {
  physical=false;
  private mode:BotMode='cruise';
  private point=new Vector3();
  private direction=new Vector3();
  constructor(readonly vehicle:TrafficVehicle,public route:RoadTrafficCar,readonly height:number){}
  get body(){return this.vehicle.body;}
  get collisionVersion(){return this.vehicle.collisionVersion;}
  get wheelbase(){return this.vehicle.wheelbase;}
  get maxSteerAngle(){return this.vehicle.maxSteerAngle;}
  get physicalSteering(){return this.physical;}
  setMode(mode:BotMode){this.mode=mode;this.vehicle.setMode(mode);}
  updateRange(center:Vector3,radius:number){
    const distance=Math.hypot(this.body.position.x-center.x,this.body.position.z-center.z);
    if(!this.physical&&distance<=radius)this.physical=true;
    else if(this.physical&&distance>radius+10&&this.mode==='cruise')this.physical=false;
  }
  impact(impulse:Vector3,point:Vector3,closing:number){this.physical=true;this.vehicle.impact(impulse,point,closing);}
  step(dt:number,input:DrivingInput){
    if(this.physical||this.mode!=='cruise'){this.physical=true;this.vehicle.step(dt,input);return;}
    const oldSpeed=this.body.velocity.length(),brake=input.brakeAxis??(input.brake?1:0);
    const speed=Math.max(0,oldSpeed+(Math.max(0,input.throttle)*3-brake*8-oldSpeed*.05)*dt);
    this.route.targetAhead(speed*dt,this.point,this.direction);
    const ground=this.vehicle.terrain.height(this.point.x,this.point.z,this.point.y+.5);
    if(ground>-999)this.point.y=ground+this.height-.1;
    const yaw=Math.atan2(-this.direction.x,-this.direction.z);
    this.body.setFrame(new Matrix4().makeRotationY(yaw).setPosition(this.point));
    this.body.velocity.copy(this.direction).multiplyScalar(speed);
    for(let i=0;i<this.vehicle.wheels.length;i++){const wheel=this.vehicle.wheels[i];wheel.spin+=speed*dt/wheel.radius;wheel.steer=i<2?input.steer*.6:0;wheel.center.copy(wheel.mount).add(new Vector3(0,-.25,0));}
    this.vehicle.travelled+=speed*dt;
  }
}
