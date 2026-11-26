import {FixedClock} from '../runtime/fixed-clock';
import {physicsTickBudget} from './physics-timing';
import {vehiclePairContact} from './vehicle-pair-test';
import type {Vehicle3D} from './vehicle-3d';
import type {DrivingInput} from './driving-demo';

export interface VehicleWorldEntry {car:Vehicle3D;input:DrivingInput;impact?:(speed:number)=>void}
/** All full-physics cars share substeps. Each unordered pair is resolved once. */
export class VehiclePhysicsWorld {
  readonly entries=new Map<number,VehicleWorldEntry>();
  readonly clock:FixedClock;
  /**
   * Contacts with bodies outside this world (road traffic), run on every shared tick before the cars integrate.
   * Testing them once per rendered frame let a fast car cross a 1.8 m wide car between two checks.
   */
  onTick?:()=>void;
  constructor(frequency=120){this.clock=new FixedClock(frequency,physicsTickBudget(frequency));}
  pause(){
    this.clock.restore(this.clock.tick);
    for(const {car} of this.entries.values())car.clock.restore(car.clock.tick);
  }
  add(id:number,entry:VehicleWorldEntry){
    if(entry.car.physicsFrequency!==this.clock.frequency)throw Error('World vehicles require a common physics frequency');
    this.entries.set(id,entry);
  }
  advance(seconds:number){
    const entries=[...this.entries.values()];for(const {car}of entries)car.beginPhysicsFrame();
    return this.clock.advance(seconds,()=>{
      for(const {car}of entries)if(car.sleeping&&(car.body.velocity.lengthSq()>1e-6||car.body.momentum.lengthSq()>1e-6))car.wakePhysics();
      for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){
        const a=entries[i],b=entries[j];if(a.car.sleeping&&b.car.sleeping)continue;
        const hit=vehiclePairContact(a.car.body,b.car.body);if(!hit)continue;
        if(hit.impulse.lengthSq()>1){
          a.car.vehicleContact(hit.impulse,hit.point,b.car.body.bounds.clone().applyMatrix4(b.car.body.matrix()),hit.closing,b.car);
          b.car.vehicleContact(hit.impulse.clone().negate(),hit.point,a.car.body.bounds.clone().applyMatrix4(a.car.body.matrix()),hit.closing,a.car);
          a.impact?.(hit.closing);b.impact?.(hit.closing);
        }
        const inverse=1/a.car.body.mass+1/b.car.body.mass,depth=Math.min(.2,Math.max(0,hit.depth-.002)*.6);
        a.car.body.position.addScaledVector(hit.normal,depth/a.car.body.mass/inverse);
        b.car.body.position.addScaledVector(hit.normal,-depth/b.car.body.mass/inverse);
      }
      this.onTick?.();
      for(const {car,input}of entries){
        if(car.sleeping)continue;
        car.advance(this.clock.dt,input,true);car.updatePhysicsSleep(this.clock.dt);
      }
    });
  }
}
