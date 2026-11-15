import {Matrix4,Vector3} from 'three';
import {type DeformablePanel,type PanelBinding} from './deformable-panel';

/** Keep the collision triangle soup, but skin shared source vertices only once. */
export class PanelCollisionSkin {
  readonly bindings:PanelBinding[]=[];
  readonly uniqueBindings:PanelBinding[]=[];
  readonly indices:Uint32Array;
  private readonly coordinates:Float64Array;
  private readonly point=new Vector3();
  constructor(panel:DeformablePanel,triangles:readonly number[]){
    this.indices=new Uint32Array(triangles.length/3);
    const vertices=new Map<string,number>();
    for(let i=0;i<triangles.length;i+=3){
      const key=`${triangles[i]},${triangles[i+1]},${triangles[i+2]}`;
      let index=vertices.get(key);
      if(index===undefined){index=this.uniqueBindings.length;vertices.set(key,index);this.uniqueBindings.push(panel.bind(triangles.slice(i,i+3)));}
      this.indices[i/3]=index;this.bindings.push(this.uniqueBindings[index]);
    }
    this.coordinates=new Float64Array(this.uniqueBindings.length*3);
  }
  write(panel:DeformablePanel,inverse:Matrix4,output:number[],start:number){
    for(let i=0;i<this.uniqueBindings.length;i++){
      panel.skin(this.uniqueBindings[i],this.coordinates,i*3);
      this.point.fromArray(this.coordinates,i*3).applyMatrix4(inverse).toArray(this.coordinates,i*3);
    }
    for(let i=0;i<this.indices.length;i++){
      const source=this.indices[i]*3,target=start+i*3;
      output[target]=this.coordinates[source];output[target+1]=this.coordinates[source+1];output[target+2]=this.coordinates[source+2];
    }
    return this.uniqueBindings.length;
  }
}
