import {Vector3} from 'three';
import {InertialCamera} from './inertial-camera';

/** An inertial camera following the car's travelled path, rather than a fixed bearing. */
export class PathChaseCamera {
  private trail:Vector3[]=[];
  private spring=new InertialCamera();
  reset(){this.trail=[];this.spring.reset();}
  update(position:Vector3,target:Vector3,focus:Vector3,offset:Vector3,seconds:number,snap=false){
    const distance=Math.max(1,Math.hypot(offset.x,offset.z));
    const last=this.trail.at(-1);
    if(snap||!last||last.distanceToSquared(focus)>10000){
      this.reset();
      this.trail.push(focus.clone().add(new Vector3(offset.x,0,offset.z)),focus.clone());
    }else if(last.distanceToSquared(focus)>.0025)this.trail.push(focus.clone());
    let remaining=distance,desired=focus.clone();
    for(let i=this.trail.length-1;i>0;i--){
      const ahead=i===this.trail.length-1?focus:this.trail[i],behind=this.trail[i-1];
      const length=Math.hypot(ahead.x-behind.x,ahead.z-behind.z);
      if(length>=remaining){
        desired.copy(ahead).lerp(behind,remaining/length);
        // Retain the bracketing segment and discard only obsolete history.
        if(i>1)this.trail.splice(0,i-1);
        break;
      }
      remaining-=length;desired.copy(behind);
    }
    desired.y=focus.y+offset.y;
    this.spring.update(position,target,focus,desired.sub(focus),seconds,5,snap);
  }
}
