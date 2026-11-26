import {DoubleSide,FrontSide,Vector3,type BufferGeometry,type MeshStandardMaterial} from 'three';

/** Authored normals must agree with every nondegenerate triangle before opting in. */
export function hasFrontWinding(geometry:BufferGeometry){
  const p=geometry.getAttribute('position'),n=geometry.getAttribute('normal'),index=geometry.index;
  if(!p||!n)return false;
  const a=new Vector3(),b=new Vector3(),c=new Vector3(),normal=new Vector3(),scratch=new Vector3();
  let reliable=0;
  for(let i=0;i<(index?.count??p.count);i+=3){
    const ai=index?index.getX(i):i,bi=index?index.getX(i+1):i+1,ci=index?index.getX(i+2):i+2;
    a.fromBufferAttribute(p,ai);b.fromBufferAttribute(p,bi);c.fromBufferAttribute(p,ci);
    b.sub(a);c.sub(a);b.cross(c);
    if(b.lengthSq()<1e-16)continue;
    normal.fromBufferAttribute(n,ai).add(scratch.fromBufferAttribute(n,bi)).add(scratch.fromBufferAttribute(n,ci));
    const agreement=b.dot(normal);
    if(agreement<=1e-8)return false;
    reliable++;
  }
  return reliable>0;
}

/** Ground overlays have upward-facing triangles, unlike vertical signs or foliage cards. */
export function hasGroundWinding(geometry:BufferGeometry){
  const p=geometry.getAttribute('position'),index=geometry.index;
  if(!p)return false;
  const a=new Vector3(),b=new Vector3(),c=new Vector3();let count=0;
  for(let i=0;i<(index?.count??p.count);i+=3){
    a.fromBufferAttribute(p,index?index.getX(i):i);
    b.fromBufferAttribute(p,index?index.getX(i+1):i+1);
    c.fromBufferAttribute(p,index?index.getX(i+2):i+2);
    b.sub(a).cross(c.sub(a));
    const length=b.length();if(length<1e-8)continue;
    if(b.y/length<.7)return false;
    count++;
  }
  return count>0;
}

export class MapBackfaceCulling {
  enabled=false;
  private readonly materials=new Set<MeshStandardMaterial>();
  configure(material:MeshStandardMaterial,geometry:BufferGeometry){
    const alpha=material.transparent||material.opacity<1||material.alphaTest>0||!!material.alphaMap;
    if(alpha){
      if(hasGroundWinding(geometry)){
        material.side=FrontSide;material.userData.slrrGroundOverlay=true;material.needsUpdate=true;
      }
      return;
    }
    if(!hasFrontWinding(geometry))return;
    material.userData.slrrMapBackfaceCandidate=true;
    // Preserve full two-sided casters, independently of the color pass experiment.
    material.shadowSide=DoubleSide;
    this.materials.add(material);
    const release=()=>{this.materials.delete(material);material.removeEventListener('dispose',release);};
    material.addEventListener('dispose',release);
    this.apply(material);
  }
  setEnabled(enabled:boolean){this.enabled=enabled;for(const material of this.materials)this.apply(material);}
  private apply(material:MeshStandardMaterial){
    const side=this.enabled?FrontSide:DoubleSide;
    if(material.side!==side){material.side=side;material.needsUpdate=true;}
  }
}
