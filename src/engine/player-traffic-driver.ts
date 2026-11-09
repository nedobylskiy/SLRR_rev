import {Bot,FullVehicleBotAdapter} from './bot';
import {RoadTrafficCar} from './road-traffic';
import type {RoadNetwork} from '../formats/trc';
import type {TrafficControl} from './traffic-control';
import type {Vehicle3D} from './vehicle-3d';
import type {RigidBody3D} from './rigid-body-3d';
import type {DrivingInput} from './driving-demo';
import {Vector3} from 'three';

/** Owns driver decisions only. Never replaces, resets, or independently advances the player's car. */
export class PlayerTrafficDriver {
  readonly bot:Bot;
  private shiftDelay=0;
  private originalManual?:boolean;
  input:DrivingInput={throttle:0,steer:0,brake:false};
  constructor(readonly vehicle:Vehicle3D,network:RoadNetwork,readonly control:TrafficControl){
    this.originalManual=vehicle.suspension.mechanics?.manual;
    const route=new RoadTrafficCar(network,vehicle.body.position);
    this.bot=new Bot(route,new FullVehicleBotAdapter(vehicle),Math.random,25/3.6,control);
    if(vehicle.body.position.clone().sub(route.position).setY(0).length()>2||new Vector3(0,0,-1).applyQuaternion(vehicle.body.orientation).dot(route.direction)<.85)this.bot.mode='recover';
  }
  dispose(){const mechanics=this.vehicle.suspension.mechanics;if(mechanics&&this.originalManual!==undefined)mechanics.manual=this.originalManual;}
  sample(dt:number,peers:readonly RigidBody3D[]):DrivingInput {
    const input={...this.bot.command(dt,peers)},mechanics=this.vehicle.suspension.mechanics;
    this.shiftDelay=Math.max(0,this.shiftDelay-dt);
    if(mechanics){
      const reversing=input.throttle<0;
      let shift=0;
      if(reversing&&mechanics.gear>=0)shift=-1;
      else if(!reversing&&mechanics.gear<=0)shift=1;
      else if(mechanics.manual&&mechanics.gear>0){
        if(mechanics.rpm>mechanics.redlineRpm*.8)shift=1;
        else if(mechanics.gear>1&&mechanics.rpm<mechanics.idleRpm*1.8)shift=-1;
      }
      const shifting=shift!==0&&this.shiftDelay===0&&!mechanics.shifting;
      if(shifting){input.gearUp=shift>0;input.gearDown=shift<0;this.shiftDelay=.35;}
      input.clutch=!!input.brake||mechanics.gear===0||shifting||mechanics.shifting;
      input.start=!mechanics.running;
    }
    this.input=input;return input;
  }
}
