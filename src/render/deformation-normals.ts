import {BufferAttribute,type BufferGeometry} from 'three';

const cache=new WeakMap<BufferGeometry,DeformationNormals>();
/** Prepare before moving vertices. SCX duplicates vertices at UV/material seams;
 * matching position AND authored normal identifies their smoothing connection. */
export function deformationNormals(geometry:BufferGeometry){
  let result=cache.get(geometry);if(!result){result=new DeformationNormals(geometry);cache.set(geometry,result);}return result;
}

class DeformationNormals {
  private readonly original:Float32Array;
  private readonly groups:Int32Array;
  private readonly corners:Uint32Array;
  private readonly coefficients:Float64Array;
  private readonly sums:Float64Array;
  private readonly areas:Float64Array;
  constructor(private geometry:BufferGeometry){
    const p=geometry.getAttribute('position');if(!geometry.getAttribute('normal'))geometry.computeVertexNormals();
    const n=geometry.getAttribute('normal');this.original=new Float32Array(n.array);
    this.groups=new Int32Array(p.count);const groups=new Map<string,number>();
    for(let i=0;i<p.count;i++){
      // Keep original hard edges and opposing inner/outer shell normals separate.
      const key=[p.getX(i),p.getY(i),p.getZ(i)].map(v=>v.toPrecision(8)).join(',')+'|'+[n.getX(i),n.getY(i),n.getZ(i)].map(v=>Math.round(v*1e5)).join(',');
      let group=groups.get(key);if(group===undefined){group=groups.size;groups.set(key,group);}this.groups[i]=group;
    }
    this.sums=new Float64Array(groups.size*3);
    const index=geometry.index,count=Math.floor((index?.count??p.count)/3)*3;
    this.corners=Uint32Array.from({length:count},(_,i)=>index?index.getX(i):i);this.coefficients=new Float64Array(count*3);this.areas=new Float64Array(count/3);
    for(let f=0;f<count;f+=3){
      const a=this.corners[f],b=this.corners[f+1],c=this.corners[f+2];
      const ux=p.getX(b)-p.getX(a),uy=p.getY(b)-p.getY(a),uz=p.getZ(b)-p.getZ(a),vx=p.getX(c)-p.getX(a),vy=p.getY(c)-p.getY(a),vz=p.getZ(c)-p.getZ(a);
      let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const length=Math.hypot(nx,ny,nz);if(!length)continue;this.areas[f/3]=length;nx/=length;ny/=length;nz/=length;
      for(let k=f;k<f+3;k++){const id=this.corners[k],x=n.getX(id),y=n.getY(id),z=n.getZ(id);this.coefficients[k*3]=x*ux+y*uy+z*uz;this.coefficients[k*3+1]=x*vx+y*vy+z*vz;this.coefficients[k*3+2]=x*nx+y*ny+z*nz;}
    }
  }
  restore(){const n=this.geometry.getAttribute('normal');n.array.set(this.original);n.needsUpdate=true;}
  update(){
    const p=this.geometry.getAttribute('position'),s=this.sums;s.fill(0);
    for(let f=0;f<this.corners.length;f+=3){
      const a=this.corners[f],b=this.corners[f+1],c=this.corners[f+2];
      const ux=p.getX(b)-p.getX(a),uy=p.getY(b)-p.getY(a),uz=p.getZ(b)-p.getZ(a),vx=p.getX(c)-p.getX(a),vy=p.getY(c)-p.getY(a),vz=p.getZ(c)-p.getZ(a);
      const cx=uy*vz-uz*vy,cy=uz*vx-ux*vz,cz=ux*vy-uy*vx,area=Math.hypot(cx,cy,cz);if(area<1e-20||!this.areas[f/3])continue;
      const axialScale=Math.sqrt(area/this.areas[f/3]);
      const nx=cx/area*axialScale,ny=cy/area*axialScale,nz=cz/area*axialScale;
      // Inverse-transpose of the local deformation basis, applied to each
      // authored normal. This preserves authored shading even in the rest pose.
      const ax=vy*nz-vz*ny,ay=vz*nx-vx*nz,az=vx*ny-vy*nx,bx=ny*uz-nz*uy,by=nz*ux-nx*uz,bz=nx*uy-ny*ux;
      for(let k=f;k<f+3;k++){
        const u=this.coefficients[k*3],v=this.coefficients[k*3+1],w=this.coefficients[k*3+2];
        const x=ax*u+bx*v+cx*w,y=ay*u+by*v+cy*w,z=az*u+bz*v+cz*w,length=Math.hypot(x,y,z);if(length<1e-20)continue;
        const j=this.groups[this.corners[k]]*3,weight=area/length;s[j]+=x*weight;s[j+1]+=y*weight;s[j+2]+=z*weight;
      }
    }
    let n=this.geometry.getAttribute('normal');if(!n){n=new BufferAttribute(new Float32Array(this.original.length),3);this.geometry.setAttribute('normal',n);}
    for(let i=0;i<this.groups.length;i++){const j=this.groups[i]*3,length=Math.hypot(s[j],s[j+1],s[j+2]);if(length>1e-20)n.setXYZ(i,s[j]/length,s[j+1]/length,s[j+2]/length);else n.setXYZ(i,this.original[i*3],this.original[i*3+1],this.original[i*3+2]);}n.needsUpdate=true;
  }
}
