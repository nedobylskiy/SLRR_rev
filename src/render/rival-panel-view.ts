import {BufferGeometry,Group,Matrix4,Mesh,Vector3} from 'three';
import {RivalPanels,type RivalPanelDefinition} from '../engine/rival-panels';
import type {PanelBinding} from '../engine/deformable-panel';
import {deformationNormals} from './deformation-normals';

interface Skin {mesh:Mesh;original:BufferGeometry;geometry:BufferGeometry;toRoot:Matrix4;fromRoot:Matrix4;source:Float32Array;reference:Float64Array;bindings:PanelBinding[];id:string}
/** Mesh buffers remain shared until impact. Frozen dents need neither node solves nor vertex uploads. */
export class RivalPanelView {
  readonly physics:RivalPanels;
  private skins:Skin[]=[];
  private version=-1;
  constructor(private group:Group,definitions:readonly RivalPanelDefinition[]){this.physics=new RivalPanels(definitions);}
  update(seconds=0,now=performance.now()){
    if(!this.physics.active&&this.version===this.physics.version)return;
    this.group.updateMatrixWorld(true);const inverse=this.group.matrixWorld.clone().invert(),point=new Vector3(),array=[0,0,0];
    for(const [id,panel] of this.physics.panels)if(!this.skins.some(s=>s.id===id)){
      const root=this.group.getObjectByName(id);if(!root)continue;
      root.traverse(object=>{if(!(object instanceof Mesh))return;
        const original=object.geometry,geometry=original.clone(),source=new Float32Array(geometry.getAttribute('position').array),toRoot=inverse.clone().multiply(object.matrixWorld);
        const bindings:PanelBinding[]=[],reference=new Float64Array(source.length);
        // Bind against the undeformed cage, even when another panel was hit on a later frame.
        for(let i=0;i<source.length;i+=3){point.fromArray(source,i).applyMatrix4(toRoot);const binding=panel.bind(point.toArray());bindings.push(binding);
          for(let axis=0;axis<3;axis++)reference[i+axis]=binding.nodes.reduce((sum,n,j)=>sum+panel.rest[n*3+axis]*binding.weights[j],0);}
        deformationNormals(geometry);object.geometry=geometry;this.skins.push({mesh:object,original,geometry,toRoot,fromRoot:toRoot.clone().invert(),source,reference,bindings,id});
      });
    }
    this.physics.advance(seconds,now);if(this.version===this.physics.version)return;
    for(const skin of this.skins){const panel=this.physics.panels.get(skin.id);if(!panel)continue;const positions=skin.geometry.getAttribute('position');
      for(let i=0;i<positions.count;i++){point.fromArray(skin.source,i*3).applyMatrix4(skin.toRoot);panel.skin(skin.bindings[i],array);
        point.add(new Vector3(array[0]-skin.reference[i*3],array[1]-skin.reference[i*3+1],array[2]-skin.reference[i*3+2])).applyMatrix4(skin.fromRoot);positions.setXYZ(i,point.x,point.y,point.z);}
      positions.needsUpdate=true;deformationNormals(skin.geometry).update();skin.geometry.computeBoundingSphere();skin.geometry.computeBoundingBox();
    }
    this.version=this.physics.version;
  }
  reset(){for(const s of this.skins){s.mesh.geometry=s.original;s.geometry.dispose();}this.skins=[];this.physics.reset();this.version=-1;}
  dispose(){this.reset();}
}
