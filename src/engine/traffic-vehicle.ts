import { Box3, Matrix4, Vector3 } from 'three';
import type { CfgWheel } from '../formats/cfg';
import type { DrivingInput } from './driving-demo';
import type { Terrain } from './suspension-3d';
import type { MapCollision } from './map-collision';
import { RigidBody3D } from './rigid-body-3d';
import type { BotVehicle, BotMode } from './bot';

/** A single low resolution crush field shared by the whole car, no per-part solver or mounts. */
export class TrafficCrush {
  readonly offsets=new Float32Array(3*3*5*3);
  version=0;
  constructor(readonly bounds:Box3){}
  hit(point:Vector3,impulse:Vector3,closing:number,mass:number){
    if(closing<1.5||impulse.length()<mass*.3)return;
    const extent=this.bounds.getSize(new Vector3()),radius=Math.max(.7,Math.min(2,closing*.08));
    const direction=impulse.clone().normalize(),depth=Math.min(.65,Math.max(0,closing-1.5)*.025);
    for(let z=0;z<5;z++)for(let y=0;y<3;y++)for(let x=0;x<3;x++){
      const node=new Vector3(this.bounds.min.x+x/2*extent.x,this.bounds.min.y+y/2*extent.y,this.bounds.min.z+z/4*extent.z);
      const weight=Math.exp(-node.distanceToSquared(point)/(radius*radius));const offset=((z*3+y)*3+x)*3;
      for(let axis=0;axis<3;axis++)this.offsets[offset+axis]=Math.max(-1,Math.min(1,this.offsets[offset+axis]+direction.getComponent(axis)*depth*weight));
    }
    this.version++;
  }
  displacement(point:Vector3,out:Vector3){
    const size=this.bounds.getSize(new Vector3());const values=[point.x,point.y,point.z].map((v,i)=>Math.max(0,Math.min(i===2?4:2,(v-this.bounds.min.getComponent(i))/Math.max(.001,size.getComponent(i))*(i===2?4:2))));
    const lower=values.map((v,i)=>Math.min(i===2?3:1,Math.floor(v)));out.set(0,0,0);
    for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++){
      const bits=[x,y,z],weight=bits.reduce((w,b,i)=>w*(b?values[i]-lower[i]:1-values[i]+lower[i]),1);
      const offset=(((lower[2]+z)*3+lower[1]+y)*3+lower[0]+x)*3;
      out.x+=this.offsets[offset]*weight;out.y+=this.offsets[offset+1]*weight;out.z+=this.offsets[offset+2]*weight;
    }return out;
  }
}

/** Always one standard rigid body and four ray springs. Crushing is event-driven. */
export class TrafficVehicle implements BotVehicle {
  readonly body:RigidBody3D;
  readonly crush:TrafficCrush;
  readonly wheels:{mount:Vector3;center:Vector3;radius:number;length:number;spin:number;steer:number;contact:boolean}[];
  collisionVersion=0;
  private mode:BotMode='cruise';
  setMode(mode:BotMode){this.mode=mode;}
  travelled=0;
  constructor(bounds:Box3,mass:number,wheels:readonly CfgWheel[],readonly terrain:Terrain,private collision?:MapCollision){
    this.body=new RigidBody3D(mass,bounds,new Vector3(0,Math.max(bounds.min.y+.4,-.35),0));this.crush=new TrafficCrush(bounds);
    this.wheels=wheels.map(w=>({mount:new Vector3(...w.position).add(new Vector3(0,.25,0)),center:new Vector3(...w.position),radius:w.radius??.36,length:.15,spin:0,steer:0,contact:false}));
  }
  place(position:Vector3,direction:Vector3,height:number){
    const root=position.clone();const ground=this.terrain.height(root.x,root.z,root.y+.5);if(ground>-999)root.y=ground+height-.1;
    this.body.setFrame(new Matrix4().makeRotationY(Math.atan2(-direction.x,-direction.z)).setPosition(root));
  }
  impact(impulse:Vector3,point:Vector3,closing:number){
    this.mode='impact';
    const inverse=this.body.matrix().invert(),local=point.clone().applyMatrix4(inverse),direction=impulse.clone().applyQuaternion(this.body.orientation.clone().invert());
    this.body.impulse(impulse,point);this.crush.hit(local,direction,closing,this.body.mass);if(closing>1.5)this.collisionVersion++;
  }
  private contact(point:Vector3,normal:Vector3,depth:number){
    const closing=Math.max(0,-this.body.pointVelocity(point).dot(normal)),j=this.body.contact(point,normal,depth,.08,.65);
    if(closing>2&&j.length()>this.body.mass*.3){const local=point.clone().applyMatrix4(this.body.matrix().invert());this.crush.hit(local,j.clone().applyQuaternion(this.body.orientation.clone().invert()),closing,this.body.mass);this.collisionVersion++;}
  }
  step(dt:number,input:DrivingInput){
    const body=this.body,frame=body.matrix(),count=Math.max(1,this.wheels.length),spring=body.mass*9.81/count/.1,damping=2*Math.sqrt(spring*body.mass/count)*.65;
    for(let i=0;i<this.wheels.length;i++){
      const wheel=this.wheels[i],mount=wheel.mount.clone().applyMatrix4(frame),sample=this.terrain.sample?.(mount.x,mount.z,mount.y);
      const height=sample?.height??this.terrain.height(mount.x,mount.z,mount.y),normal=sample?.normal??new Vector3(0,1,0);
      wheel.length=Math.max(.05,Math.min(.45,mount.y-height-wheel.radius));wheel.contact=mount.y-height-wheel.radius<.45&&height>-999;
      wheel.steer=i<2?Math.max(-1,Math.min(1,input.steer))*.6:0;
      wheel.center.copy(wheel.mount).add(new Vector3(0,-wheel.length,0));
      if(!wheel.contact)continue;
      const point=new Vector3(mount.x,height,mount.z),velocity=body.pointVelocity(point);
      const load=Math.max(0,Math.min(body.mass*9.81,spring*(.25-wheel.length)-damping*velocity.dot(normal)));
      body.addForce(normal.clone().multiplyScalar(load),point);
      const forward=new Vector3(-Math.sin(wheel.steer),0,-Math.cos(wheel.steer)).applyQuaternion(body.orientation).projectOnPlane(normal).normalize();
      const side=new Vector3().crossVectors(forward,normal).normalize(),speed=velocity.dot(forward);
      const brake=input.brakeAxis??(input.brake?1:0),longitudinal=(input.throttle*5-brake*Math.sign(speed)*8-speed*.05)*body.mass/count;
      const lateral=-velocity.dot(side)*body.mass/count*8,limit=load*.9;
      const force=forward.multiplyScalar(longitudinal).addScaledVector(side,lateral);if(force.length()>limit)force.setLength(limit);
      body.addForce(force,point);wheel.spin+=speed/wheel.radius*dt;
    }
    body.integrate(dt);this.travelled+=body.velocity.length()*dt;
    const full=this.mode!=='cruise'||this.wheels.filter(w=>w.contact).length<2;
    for(let iteration=0;iteration<(full?2:1);iteration++){
      const hit=this.collision?.bodyContact(body);if(hit)this.contact(hit.point,hit.normal,hit.depth);
      const corners=body.corners();
      for(const point of full?corners:[corners[0],corners[4]]){
        if(full){const height=this.terrain.height(point.x,point.z,point.y);if(point.y<height)this.contact(point,this.terrain.normal(point.x,point.z,point.y),height-point.y);}
        const wall=this.collision?.contact(point,.12,false);if(wall)this.contact(wall.point,wall.normal,wall.depth);
      }
    }
  }
}
