import {Matrix4,Vector3} from 'three';
import {sampleRoadSegment,type RoadNetwork} from '../formats/trc';
import {trafficConnections,RoadTrafficCar} from './road-traffic';
import {TrafficVehicle} from './traffic-vehicle';
import type {BotMode,BotVehicle} from './bot';
import type {DrivingInput} from './driving-demo';

export interface TrafficSpawn {road:number;position:Vector3}
export type TrafficOccupant=Vector3&{trafficRadius?:number};
const CELL=100;
/** Immutable lane samples indexed once per map, not rebuilt as the player moves. */
export class TrafficSpawnIndex {
  private cells=new Map<string,TrafficSpawn[]>();
  constructor(readonly network:RoadNetwork){
    const connected=trafficConnections(network);
    for(const road of network.others){
      if(!connected.get(road.id)?.length)continue;
      for(const segment of road.segments){
        const steps=Math.max(1,Math.ceil(segment.length/20));
        for(let i=0;i<steps;i++){
          const position=new Vector3(...sampleRoadSegment(segment,(i+.5)/steps));
          const key=`${Math.floor(position.x/CELL)},${Math.floor(position.z/CELL)}`,cell=this.cells.get(key)??[];
          cell.push({road:road.id,position});this.cells.set(key,cell);
        }
      }
    }
  }
  choose(center:Vector3,radius:number,occupied:readonly TrafficOccupant[],random=Math.random,minDistance=15,preferNear=false,preferred?:(spawn:TrafficSpawn)=>boolean,bodyRadius=6):TrafficSpawn|undefined {
    let selected:TrafficSpawn|undefined,count=0,best=Infinity,selectedPreferred=false;
    for(let x=Math.floor((center.x-radius)/CELL);x<=Math.floor((center.x+radius)/CELL);x++)for(let z=Math.floor((center.z-radius)/CELL);z<=Math.floor((center.z+radius)/CELL);z++){
      for(const candidate of this.cells.get(`${x},${z}`)??[]){
        const p=candidate.position,distance=Math.hypot(p.x-center.x,p.z-center.z);
        if(distance<minDistance||distance>radius||occupied.some(other=>Math.abs(other.y-p.y)<4&&Math.hypot(other.x-p.x,other.z-p.z)<Math.max(14,bodyRadius+(other.trafficRadius??6)+2)))continue;
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
