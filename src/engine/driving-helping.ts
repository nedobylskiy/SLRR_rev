export interface DrivingHelping { brake:number; steer:number; clutch:number; acceleration:number; abs:number }
export const DEFAULT_DRIVING_HELPING:Readonly<DrivingHelping>={brake:1,steer:1,clutch:0,acceleration:0,abs:1};

/** Additional clutch opening only during heavy braking towards stall speed. */
export function brakingClutchHelp(strength:number,brakeAxis:number,rpm:number,shaftRpm:number,idleRpm:number,roadSpeedMps:number):number{
  const clamp=(value:number)=>Math.max(0,Math.min(1,value));
  const demand=clamp((brakeAxis-0.8)/(1-0.8));
  const risk=clamp((idleRpm*1.5-Math.min(rpm,Math.abs(shaftRpm)))/Math.max(1,idleRpm*.5));
  const speedHelp=clamp((Math.abs(roadSpeedMps)*3.6-20)/10);
  return clamp(strength)*demand*risk*speedHelp;
}


/** Rate limit button steering in rad/s; analogue axes retain their original response. */
export function steeringHelpStep(current:number,target:number,speedMps:number,dt:number,strength:number,digital:boolean):number{
  const baseline=2;
  const unwinding=target===0||current*target<0||Math.abs(target)<Math.abs(current);
  const assisted=Math.max(0.2,baseline/(1+(Math.abs(speedMps)/15)**2));
  const blend=digital&&!unwinding?Math.max(0,Math.min(1,strength)):0;
  const rate=baseline+(assisted-baseline)*blend;
  return current+Math.max(-rate*dt,Math.min(rate*dt,target-current));
}


/** Low-speed clutch protection hands over to brake helping between 20 and 30km/h. */
export function lowSpeedClutchHelp(strength:number,speedMps:number):number{
  return Math.max(0,Math.min(1,strength))*Math.max(0,Math.min(1,(30-Math.abs(speedMps)*3.6)/10));
}


/** Software launch control: cut accelerator demand only during a low-speed start. */
export class LaunchHelping {
  active=false;
  factor=1;
  reset(){this.active=false;this.factor=1;}
  step(dt:number,gas:number,speedMps:number,slip:number,strength:number,gear:number,allowed=true):number{
    const kph=Math.abs(speedMps)*3.6;
    if(strength<=0||!allowed||gas<.2||Math.abs(gear)!==1||kph>=30){this.reset();return 1;}
    if(!this.active&&kph<2&&gas>=.6)this.active=true;
    if(!this.active)return 1;
    const desired=Math.max(.05,Math.min(1,1-Math.max(0,slip-.15)*2));
    this.factor+=(desired-this.factor)*(1-Math.exp(-dt/(desired < this.factor ? .04 : .15)));
    return 1-Math.max(0,Math.min(1,strength))*(1-this.factor);
  }
}

/** Release only brake-induced angular deceleration; never spin a locked wheel up. */
export function absBrakeStep(before:number,after:number,longitudinal:number,radius:number,strength:number,grounded=true):number{
  const speed=Math.abs(longitudinal),direction=Math.sign(longitudinal);
  if(!grounded||strength<=0||speed<3||before*direction<=0)return after;
  const requested=(before-after)*direction;
  if(requested<=0)return after;
  const minimumOmega=speed/Math.max(.01,radius)*.85;
  const allowed=Math.max(0,before*direction-minimumOmega);
  const released=Math.max(0,requested-allowed)*Math.max(0,Math.min(1,strength));
  return after+direction*released;
}
