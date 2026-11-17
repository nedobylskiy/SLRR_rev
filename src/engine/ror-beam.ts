// RoR normal-beam force/plastic yield and semi-implicit Euler integration.
// Adapted from Rigs of Rods ActorForcesEuler.cpp, revision ebf31a2187bbc31a38331a86b233dfa7e60c52fb.
// Copyright Pierre-Michel Ricordel, Thomas Fischer and RoR contributors.
// GPL-3.0-only. Full notice/license: native/soft-body/ror/.
import {ROR_MOUNT_RELEASE_DELAY_S,ROR_PANEL_DAMPING_PER_S} from './physics-timing';
interface Beam {a:number;b:number;initial:number;rest:number;lambda:number;stiffness:number}
interface Mount {nodes:number[];broken:boolean;force:number;overload:number}
export interface RoRState {positions:Float64Array;velocities:Float64Array;rest:Float64Array;anchorVelocities:Float64Array;ground:Float64Array;previous:Float64Array;incoming:Float64Array;forces:Float64Array;mountForces:Float64Array;planes:Float64Array;beams:Beam[];mounts:Mount[];mass:number;gravity:number;yieldStrain:number;mountStrength:number;attached:boolean}
/** Scalar reference/fallback; production uses the matching single-call C++ kernel. */
export function rorAdvance(s:RoRState,dt:number){
  const p=s.positions,v=s.velocities,f=s.forces,count=p.length/3,inv=count/s.mass,mass=1/inv;
  const degreeK=new Float64Array(count),degreeD=new Float64Array(count),damping=new Float64Array(s.beams.length);
  s.beams.forEach((beam,i)=>{const d=.1*Math.sqrt(beam.stiffness*mass);damping[i]=d;degreeK[beam.a]+=beam.stiffness;degreeK[beam.b]+=beam.stiffness;degreeD[beam.a]+=d;degreeD[beam.b]+=d;});
  let maximumH=.0005;for(let n=0;n<count;n++){const a=2*degreeK[n]*inv,b=4*degreeD[n]*inv;if(a+b>0)maximumH=Math.min(maximumH,.85*4/(b+Math.sqrt(b*b+8*a)));}
  const steps=Math.ceil(dt/maximumH-1e-10),h=dt/steps,kMount=Math.min(1e7,.4*mass/(.0005*.0005)),dMount=Math.sqrt(kMount*mass);
  const origin=[s.rest[0],s.rest[1],s.rest[2]],localRest=new Float64Array(p.length),localGround=new Float64Array(count),offsets=new Float64Array(count);
  const quantize=(x:number)=>Math.round(x*1e10)*1e-10;
  const drag=Math.exp(-ROR_PANEL_DAMPING_PER_S*h);
  s.previous.set(p);s.incoming.set(v);
  for(let i=0;i<p.length;i++){p[i]=quantize(p[i]-origin[i%3]);localRest[i]=quantize(s.rest[i]-origin[i%3]);}
  for(let n=0;n<count;n++){const q=s.planes,j=n*8;localGround[n]=quantize(s.ground[n]-origin[1]);offsets[n]=quantize(q[j+3]-q[j]*origin[0]-q[j+1]*origin[1]-q[j+2]*origin[2]);}
  s.mountForces.fill(0);const loads=new Float64Array(s.mounts.length);
  for(let sub=0;sub<steps;sub++){
    f.fill(0);for(let i=1;i<p.length;i+=3)f[i]=-mass*s.gravity;
    for(let bi=0;bi<s.beams.length;bi++){const b=s.beams[bi],a=b.a*3,c=b.b*3,x=p[a]-p[c],y=p[a+1]-p[c+1],z=p[a+2]-p[c+2],length=Math.sqrt(x*x+y*y+z*z);if(length<1e-10)continue;
      const extension=length-b.rest,k=b.stiffness,speed=((v[a]-v[c])*x+(v[a+1]-v[c+1])*y+(v[a+2]-v[c+2])*z)/length,yieldForce=k*b.initial*s.yieldStrain;
      let stress=-k*extension-damping[bi]*speed;
      if(stress>yieldForce&&extension < -yieldForce/k){const old=b.rest;b.rest=Math.max(b.initial*.2,b.rest+extension+yieldForce/k);stress+=k*(b.rest-old)*.5;}
      else if(stress < -yieldForce&&extension>yieldForce/k){const old=b.rest;b.rest=Math.min(b.initial*3,b.rest+extension-yieldForce/k);stress+=k*(b.rest-old)*.5;}
      const scale=stress/length;f[a]+=x*scale;f[a+1]+=y*scale;f[a+2]+=z*scale;f[c]-=x*scale;f[c+1]-=y*scale;f[c+2]-=z*scale;b.lambda=0;
    }
    if(s.attached)for(let mi=0;mi<s.mounts.length;mi++){const m=s.mounts[mi];if(m.broken)continue;let load=0;for(const n of m.nodes){const nf=[0,0,0];for(let axis=0;axis<3;axis++){const i=n*3+axis,target=localRest[i]-s.anchorVelocities[i]*(dt-(sub+1)*h),force=(target-p[i])*kMount+(s.anchorVelocities[i]-v[i])*dMount;f[i]+=force;s.mountForces[i]+=force/steps;nf[axis]=force;}load+=Math.hypot(...nf);}loads[mi]=Math.max(loads[mi],load);}

    for(let i=0;i<p.length;i+=3){
      for(let a=0;a<3;a++){v[i+a]+=f[i+a]*inv*h;if(s.attached)v[i+a]=s.anchorVelocities[i+a]+(v[i+a]-s.anchorVelocities[i+a])*drag;p[i+a]+=v[i+a]*h;}
      if(p[i+1]<=localGround[i/3]+1e-9){p[i+1]=Math.max(p[i+1],localGround[i/3]);if(v[i+1]<0)v[i+1]=0;}
      const j=i/3*8,q=s.planes;if(q[j+7]){const depth=offsets[i/3]-(q[j+7]===2?(q[j]*q[j+4]+q[j+1]*q[j+5]+q[j+2]*q[j+6])*(dt-(sub+1)*h):0)-q[j]*p[i]-q[j+1]*p[i+1]-q[j+2]*p[i+2];if(depth>=-1e-9){const vn=(v[i]-q[j+4])*q[j]+(v[i+1]-q[j+5])*q[j+1]+(v[i+2]-q[j+6])*q[j+2];for(let a=0;a<3;a++){p[i+a]+=q[j+a]*Math.max(0,depth);if(vn<0)v[i+a]-=q[j+a]*vn;}}}
    }
  }
  let release=false;
  for(let mi=0;mi<s.mounts.length;mi++){
    const m=s.mounts[mi];if(m.broken)continue;
    let meanForce=0;
    for(const node of m.nodes){const i=node*3;meanForce+=Math.hypot(s.mountForces[i],s.mountForces[i+1],s.mountForces[i+2]);}
    // Ordinary failure needs sustained load. A very high peak can still tear a
    // mount, provided it delivered a meaningful net load rather than chatter.
    m.force=loads[mi];
    m.overload=meanForce>s.mountStrength?m.overload+dt:Math.max(0,m.overload-2*dt);
    if((m.force>s.mountStrength*3&&meanForce>s.mountStrength*.5)||m.overload>=ROR_MOUNT_RELEASE_DELAY_S)release=true;
  }
  if(release)for(const m of s.mounts)m.broken=true;
  for(let i=0;i<p.length;i++)if(!Number.isFinite(p[i])||!Number.isFinite(v[i]))throw Error('Non-finite RoR beam state');
  for(let i=0;i<p.length;i++)p[i]+=origin[i%3];
  return steps;
}
