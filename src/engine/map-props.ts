import {Box3,Matrix4,Vector3} from 'three';
import {RigidBody3D} from './rigid-body-3d';
import type {MapCollision} from './map-collision';
import type {MapTerrain} from './map-terrain';

interface Prop {body?:RigidBody3D;quiet:number;bodyInitialized:boolean;remove:()=>void;refresh:()=>void}

/** A prop starts as a cheap spatial trigger. Only touched props allocate a solver body. */
export class MapProps {
  private readonly active=new Set<Prop>();
  private readonly removers=new Set<()=>void>();
  private accumulator=0;
  constructor(private collision:MapCollision,private terrain:MapTerrain){}
  add(frame:Matrix4,bounds:Box3,mass:number,changed:(delta:Matrix4)=>void){
    const center=bounds.getCenter(new Vector3()),half=bounds.getSize(new Vector3()).multiplyScalar(.5);
    const original=frame.clone(),inverse=original.clone().invert();
    const prop:Prop={quiet:0,bodyInitialized:false,remove:()=>{},refresh:()=>{}};
    const publish=()=>{
      const pose=prop.body?prop.body.matrix():original;
      prop.remove();
      prop.remove=this.collision.addBox(pose.clone().multiply(new Matrix4().makeTranslation(center.x,center.y,center.z)),half,(car,hit)=>{
        const body=prop.body??=new RigidBody3D(mass,bounds.clone());
        if(!this.active.has(prop)){if(!prop.bodyInitialized){body.setFrame(original);prop.bodyInitialized=true;}this.active.add(prop);}
        const relative=car.pointVelocity(hit.point).sub(body.pointVelocity(hit.point)),vn=relative.dot(hit.normal);
        if(vn<-.01){
          const ra=hit.point.clone().sub(car.position),rb=hit.point.clone().sub(body.position),n=hit.normal;
          const ca=new Vector3().crossVectors(ra,n),cb=new Vector3().crossVectors(rb,n);
          const denominator=1/car.mass+1/body.mass+n.dot(new Vector3().crossVectors(car.inverseWorld(ca),ra))+n.dot(new Vector3().crossVectors(body.inverseWorld(cb),rb));
          const impulse=n.clone().multiplyScalar(-1.05*vn/denominator);
          car.impulse(impulse,hit.point);body.impulse(impulse.clone().negate(),hit.point);prop.quiet=0;
        }
        const correction=Math.max(0,hit.depth-.002)*.6;
        car.position.addScaledVector(hit.normal,correction*mass/(car.mass+mass));
        body.position.addScaledVector(hit.normal,-correction*car.mass/(car.mass+mass));
      });
      if(prop.body)changed(pose.clone().multiply(inverse));
    };
    // Keep the original frame only for first activation; waking keeps the settled pose.
    const state=prop;
    prop.refresh=publish;publish();this.removers.add(()=>state.remove());return state;
  }
  update(dt:number){
    if(!this.active.size){this.accumulator=0;return;}
    this.accumulator+=Math.min(.05,Math.max(0,dt));
    const touched=new Set(this.active);
    while(this.accumulator>=1/120){
      const step=1/120;this.accumulator-=step;
      for(const prop of this.active){
        const body=prop.body!;body.integrate(step);
        for(let pass=0;pass<3;pass++)for(const point of body.corners()){
          const ground=this.terrain.sample(point.x,point.z,point.y+.3);
          if(ground&&point.y<ground.height)body.contact(point,ground.normal,ground.height-point.y,.12,.7);
          const wall=this.collision.contact(point,.025,false);
          if(wall)body.contact(wall.point,wall.normal,wall.depth,.1,.5);
        }
        prop.quiet=body.velocity.lengthSq()<.015&&body.omega.lengthSq()<.03?prop.quiet+step:0;
        if(prop.quiet>.8){body.velocity.setScalar(0);body.momentum.setScalar(0);this.active.delete(prop);}
      }
    }
    // One spatial/visual update per display frame, even when several solver steps ran.
    for(const prop of touched)prop.refresh();
  }
  get awake(){return this.active.size;}
  dispose(){for(const remove of this.removers)remove();this.removers.clear();this.active.clear();}
}
