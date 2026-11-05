import {Box3,Color,DoubleSide,Frustum,InstancedMesh,LessDepth,LessEqualDepth,Matrix4,MeshStandardMaterial,Ray,Vector3,type BufferGeometry,type Camera,type Group,type WebGLRenderer} from 'three';
import {OccluderGeometry,occludedBox,rayTree,type RayBranch} from './occlusion-rays';

interface Candidate {id:string;source:InstancedMesh;slot:number;bounds:Box3;matrix:Matrix4;inverse:Matrix4;hidden:boolean}
interface SourceState {key:string;world:Matrix4;candidates:Candidate[];hidden:number;kept:string;needsProxy:boolean;proxy?:InstancedMesh;release:()=>void}
interface Blocker extends Candidate {rays:OccluderGeometry}

/** Ray proof of opaque convex coverage. Auxiliary render passes always retain the full source. */
export class MapRaycastOcclusion {
  enabled=false;
  budgetMs=2;
  private main=false;
  private shadow=false;
  private states=new Map<InstancedMesh,SourceState>();
  private geometries=new WeakMap<BufferGeometry,OccluderGeometry>();
  private pending=new Set<BufferGeometry>();
  private geometryReleases=new Map<BufferGeometry,()=>void>();
  private tree?:RayBranch<Blocker>;
  private targets:Candidate[]=[];
  private cursor=0;
  private projection=new Matrix4();
  private previousProjection=new Matrix4();
  private frustum=new Frustum();
  private origin=new Vector3();
  private ray=new Ray();private localRay=new Ray();private point=new Vector3();private localEnd=new Vector3();
  private rayCount=0;private tested=0;private lastMs=0;
  private dirty=true;
  constructor(renderer:WebGLRenderer){
    const direct=renderer.renderBufferDirect.bind(renderer);
    renderer.renderBufferDirect=(camera,scene,geometry,material,object,group)=>{
      if(object.userData.rayOcclusionProxy){if(!this.main||this.shadow)return;}
      else if(this.main&&!this.shadow&&(this.states.get(object as InstancedMesh)?.hidden??0)>0)return;
      return direct(camera,scene,geometry,material,object,group);
    };
    const shadows=renderer.shadowMap.render.bind(renderer.shadowMap);
    renderer.shadowMap.render=(...args)=>{const previous=this.shadow;this.shadow=true;try{return shadows(...args);}finally{this.shadow=previous;}};
  }
  setEnabled(enabled:boolean){this.enabled=enabled;if(!enabled)this.reset();}
  renderMain<T>(bypass:boolean,work:()=>T):T {
    const previous=this.main;this.main=this.enabled&&!bypass;
    try{return work();}finally{this.main=previous;}
  }
  private remove(source:InstancedMesh){
    const state=this.states.get(source);if(!state)return;
    source.removeEventListener('dispose',state.release);
    state.proxy?.removeFromParent();state.proxy?.dispose();this.states.delete(source);
    this.dirty=true;
  }
  reset(){
    for(const source of [...this.states.keys()])this.remove(source);
    for(const [geometry,release] of this.geometryReleases)geometry.removeEventListener('dispose',release);
    this.geometryReleases.clear();this.pending.clear();this.geometries=new WeakMap();
    this.targets=[];this.tree=undefined;this.cursor=0;this.rayCount=this.tested=0;this.lastMs=0;
    this.dirty=true;
  }
  private blocker(source:InstancedMesh):boolean {
    const material=source.material;if(!(material instanceof MeshStandardMaterial)||material.type!=='MeshStandardMaterial'||!material.visible||!material.colorWrite||!material.depthWrite||!material.depthTest||material.displacementMap||material.transparent||material.opacity<1
      ||material.alphaTest>0||material.alphaMap||material.alphaHash||material.alphaToCoverage||material.side!==DoubleSide||material.clippingPlanes?.length)return false;
    const geometry=source.geometry,triangles=(geometry.index?.count??geometry.getAttribute('position').count)/3;
    if(triangles>4096||geometry.groups.length||Object.keys(geometry.morphAttributes).length)return false;
    const size=geometry.boundingBox!.getSize(this.point);
    return size.y>=3&&Math.max(size.x,size.z)>=4;
  }
  private canCull(source:InstancedMesh):boolean {
    const materials=Array.isArray(source.material)?source.material:[source.material];
    return !Object.keys(source.geometry.morphAttributes).length&&materials.every(m=>m instanceof MeshStandardMaterial&&m.depthTest
      &&(m.depthFunc===LessEqualDepth||m.depthFunc===LessDepth)&&!m.displacementMap);
  }
  prepare(camera:Camera,root:Group|undefined){
    if(!this.enabled||!root)return;
    if(!('isPerspectiveCamera' in camera)){this.reset();return;}
    const started=performance.now();this.rayCount=this.tested=0;
    camera.updateWorldMatrix(true,false);root.updateWorldMatrix(true,false);camera.getWorldPosition(this.origin);
    this.projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    const poseChanged=!this.projection.equals(this.previousProjection);this.previousProjection.copy(this.projection);
    this.frustum.setFromProjectionMatrix(this.projection);
    const sources=root.children.filter((object):object is InstancedMesh=>object instanceof InstancedMesh&&!object.userData.rayOcclusionProxy&&object.visible&&object.count>0&&object.layers.test(camera.layers));
    const seen=new Set(sources);let changed=this.dirty,prepared=false;
    for(const source of [...this.states.keys()])if(!seen.has(source)){this.remove(source);changed=true;}
    for(const source of sources){
      source.updateWorldMatrix(false,false);
      if(!source.geometry.boundingBox)source.geometry.computeBoundingBox();
      if(source.geometry.boundingBox!.isEmpty()){this.remove(source);changed=true;continue;}
      const key=`${source.geometry.id}:${source.count}:${source.instanceMatrix.version}:${source.instanceColor?.version}:${this.blocker(source)}:${this.canCull(source)}`;
      const previous=this.states.get(source);
      if(previous?.key===key&&previous.world.equals(source.matrixWorld))continue;
      this.remove(source);changed=true;
      const candidates:Candidate[]=[];
      for(let slot=0;slot<source.count;slot++){
        const matrix=new Matrix4();source.getMatrixAt(slot,matrix);matrix.premultiply(source.matrixWorld);
        candidates.push({id:`${source.uuid}:${slot}`,source,slot,matrix,inverse:matrix.clone().invert(),
          bounds:source.geometry.boundingBox!.clone().applyMatrix4(matrix),hidden:false});
      }
      const state:SourceState={key,world:source.matrixWorld.clone(),candidates,hidden:0,kept:'',needsProxy:false,release:()=>this.remove(source)};
      this.states.set(source,state);source.addEventListener('dispose',state.release);
      if(this.blocker(source)&&!this.geometries.has(source.geometry)){
        const geometry=source.geometry;this.pending.add(geometry);
        if(!this.geometryReleases.has(geometry)){
          const release=()=>{this.pending.delete(geometry);this.geometries.delete(geometry);this.geometryReleases.delete(geometry);this.dirty=true;geometry.removeEventListener('dispose',release);};
          this.geometryReleases.set(geometry,release);geometry.addEventListener('dispose',release);
        }
      }
    }
    this.dirty=false;
    for(let count=0;count<4&&performance.now()-started<this.budgetMs*.5;count++){
      const geometry=this.pending.values().next().value;if(!geometry)break;
      this.pending.delete(geometry);this.geometries.set(geometry,new OccluderGeometry(geometry));prepared=true;
    }
    if(changed||prepared){
      this.targets=[...this.states.values()].flatMap(s=>s.candidates);
      const blockers:Blocker[]=[];
      for(const candidate of this.targets){const rays=this.geometries.get(candidate.source.geometry);if(rays&&this.blocker(candidate.source))blockers.push({...candidate,rays});}
      this.tree=rayTree(blockers);this.cursor=0;
    }
    if(poseChanged||changed){for(const target of this.targets)if(target.hidden){target.hidden=false;this.states.get(target.source)!.needsProxy=true;}this.cursor=0;}
    while(this.cursor<this.targets.length&&performance.now()-started<this.budgetMs){
      const target=this.targets[this.cursor++];this.tested++;
      const hidden=this.canCull(target.source)&&this.inView(target.bounds)&&occludedBox(target.bounds,this.origin,point=>this.hit(point,target));
      if(hidden!==target.hidden){target.hidden=hidden;this.states.get(target.source)!.needsProxy=true;}
    }
    for(const [source,state] of this.states)if(state.needsProxy){this.updateProxy(source,state);state.needsProxy=false;}
    this.lastMs=performance.now()-started;
  }
  private inView(bounds:Box3){
    for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])
      if(!this.frustum.containsPoint(this.point.set(x,y,z)))return false;
    return true;
  }
  private hit(point:Vector3,target:Candidate):string[]|undefined {
    this.rayCount++;
    const far=point.distanceTo(this.origin)-.5;if(far<=0)return;
    this.ray.set(this.origin,point.clone().sub(this.origin).normalize());
    const stack=this.tree?[this.tree]:[];let best=far,result:string[]|undefined;
    while(stack.length){
      const node=stack.pop()!,entry=this.ray.intersectBox(node.bounds,this.point);
      if(!entry||(!node.bounds.containsPoint(this.origin)&&entry.distanceTo(this.origin)>=best))continue;
      if(node.items)for(const blocker of node.items){
        if(blocker.id===target.id)continue;
        this.localRay.copy(this.ray).applyMatrix4(blocker.inverse);
        this.localEnd.copy(this.origin).addScaledVector(this.ray.direction,best).applyMatrix4(blocker.inverse);
        const localFar=this.localEnd.distanceTo(this.localRay.origin);
        const hit=blocker.rays.nearest(this.localRay,localFar);
        if(hit){
          const worldPoint=this.localRay.at(hit.distance,this.point).applyMatrix4(blocker.matrix),distance=worldPoint.distanceTo(this.origin);
          if(distance<best&&this.frustum.containsPoint(worldPoint)){best=distance;result=hit.patches.map(p=>`${blocker.id}/${p}`);}
        }
      }else{if(node.left)stack.push(node.left);if(node.right)stack.push(node.right);}
    }return result;
  }
  private updateProxy(source:InstancedMesh,state:SourceState){
    const kept=state.candidates.filter(c=>!c.hidden).map(c=>c.slot),key=kept.join(',');
    state.hidden=source.count-kept.length;
    if(!state.hidden||!kept.length){state.proxy?.removeFromParent();state.proxy?.dispose();state.proxy=undefined;state.kept=key;return;}
    if(key===state.kept&&state.proxy)return;
    if(!state.proxy||state.proxy.instanceMatrix.count<kept.length){
      state.proxy?.removeFromParent();state.proxy?.dispose();
      const proxy=new InstancedMesh(source.geometry,source.material,kept.length);proxy.name=`${source.name} / ray-visible`;
      proxy.userData.rayOcclusionProxy=true;proxy.castShadow=false;proxy.receiveShadow=source.receiveShadow;
      proxy.layers.mask=source.layers.mask;
      proxy.renderOrder=source.renderOrder;proxy.matrixAutoUpdate=false;proxy.matrix.copy(source.matrix);proxy.matrixWorldNeedsUpdate=true;
      if(source.instanceColor)proxy.setColorAt(0,new Color(1,1,1));
      state.proxy=proxy;source.parent?.add(proxy);
    }
    const proxy=state.proxy;
    for(let slot=0;slot<kept.length;slot++){
      (proxy.instanceMatrix.array as Float32Array).set(source.instanceMatrix.array.slice(kept[slot]*16,kept[slot]*16+16),slot*16);
      if(proxy.instanceColor&&source.instanceColor)(proxy.instanceColor.array as Float32Array).set(source.instanceColor.array.slice(kept[slot]*3,kept[slot]*3+3),slot*3);
    }
    proxy.count=kept.length;proxy.instanceMatrix.needsUpdate=true;if(proxy.instanceColor)proxy.instanceColor.needsUpdate=true;
    proxy.computeBoundingSphere();state.kept=key;
  }
  lines(){return [`Raycast occlusion: ${this.enabled?'on':'off'} · budget ${this.budgetMs.toFixed(1)} ms · last CPU ${this.lastMs.toFixed(2)} ms`,
    `Rays/frame ${this.rayCount} · tested/frame ${this.tested} · processed ${this.cursor}/${this.targets.length} · hidden instances ${[...this.states.values()].reduce((n,s)=>n+s.hidden,0)} · BVH queue ${this.pending.size}`];}
}
