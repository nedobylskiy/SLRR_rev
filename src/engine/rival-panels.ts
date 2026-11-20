import {Box3,Vector3} from 'three';
import {DeformablePanel,type Triple} from './deformable-panel';
import {DRIVING_PHYSICS_HZ} from './physics-timing';

export const RIVAL_PANEL_WINDOW_MS=2000;
export interface RivalPanelDefinition {id:string;samples:number[];mass:number;mount:Triple;root:boolean;hood:boolean}
/** Event-driven, separate XPBD cages. Coordinates stay local to the carrier; ordinary driving never wakes them. */
export class RivalPanels {
  readonly panels=new Map<string,DeformablePanel>();
  private bounds=new Map<string,Box3>();
  private awake=new Set<string>();
  private until=0;
  version=0;
  constructor(readonly definitions:readonly RivalPanelDefinition[]){
    for(const def of definitions){const box=new Box3();for(let i=0;i<def.samples.length;i+=3)box.expandByPoint(new Vector3().fromArray(def.samples,i));this.bounds.set(def.id,box);}
  }
  get active(){return this.awake.size>0;}
  hit(impulse:Vector3,point:Vector3,closing:number,carMass:number,now=performance.now()){
    if(closing<1.5||impulse.length()<carMass*.3)return;
    const candidates=this.definitions.map(def=>({def,weight:Math.exp(-(this.bounds.get(def.id)!.distanceToPoint(point)**2)/(.4*.4))})).filter(c=>c.weight>.01);
    if(!candidates.length)return;
    const total=candidates.filter(c=>!c.def.root).reduce((sum,c)=>sum+c.weight,0),energy=impulse.lengthSq()/(2*carMass),share=Math.max(0,Math.min(1,(energy-2500)/15000));
    if(share===0)return;
    // Freeze overdue motion before a fresh impact, so an old impulse cannot restart after a long pause.
    if(now>=this.until)this.freeze();
    for(const {def,weight} of candidates){
      let panel=this.panels.get(def.id);
      if(!panel){panel=new DeformablePanel(def.samples,{mass:def.mass,mount:def.mount,volume:true,resolution:def.root?[5,7]:[4,5],frequency:DRIVING_PHYSICS_HZ,
        stiffness:def.root?900000:750000,yieldStrain:def.root?.003:.018,mountStrength:def.root?1e15:Math.max(12000,def.mass*2000)*1.1,
        gravity:0,anchorLayout:def.root?'central-four':def.hood?'hood-five':'panel'});
        panel.groundHeight=()=>-1e9;this.panels.set(def.id,panel);}
      panel.impulseAt(impulse.clone().multiplyScalar(share*(def.root?.6:.3*weight/Math.max(1,total))).toArray(),point.toArray(),def.root?.65:.3);
      this.awake.add(def.id);
    }
    this.until=now+RIVAL_PANEL_WINDOW_MS;this.version++;
  }
  advance(seconds:number,now=performance.now()){
    if(!this.active)return false;
    if(now>=this.until){this.freeze();return false;}
    const dt=Math.min(.05,Math.max(0,seconds),(this.until-now)/1000);if(!dt)return false;
    for(const id of this.awake)this.panels.get(id)!.advance(dt);
    this.version++;return true;
  }
  private freeze(){for(const id of this.awake)this.panels.get(id)!.velocities.fill(0);this.awake.clear();}
  reset(){this.freeze();this.panels.clear();this.until=0;this.version++;}
}
