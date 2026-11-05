import {Box3,Color,DoubleSide,Frustum,InstancedMesh,LessDepth,LessEqualDepth,Matrix4,MeshStandardMaterial,Plane,Ray,Vector3,type BufferGeometry,type Camera,type Group,type WebGLRenderer} from 'three';
import {OccluderGeometry,rayTree,type RayBranch} from './occlusion-rays';

interface Candidate {id:string;source:InstancedMesh;slot:number;bounds:Box3;matrix:Matrix4;inverse:Matrix4;hidden:boolean;proof?:Proof}
interface SourceState {key:string;world:Matrix4;candidates:Candidate[];hidden:number;kept:string;needsProxy:boolean;proxy?:InstancedMesh;release:()=>void}
interface Blocker extends Candidate {rays:OccluderGeometry}
interface Proof {blocker:Blocker;patch:number;key:string}
interface Cone {stamp:number;valid:boolean;polygon?:Vector3[];center?:Vector3;base?:Plane;planes?:Plane[]}
function insidePlanes(bounds:Box3,planes:Plane[]){
  return planes.every(({normal:n,constant})=>n.x*(n.x>=0?bounds.min.x:bounds.max.x)
    +n.y*(n.y>=0?bounds.min.y:bounds.max.y)+n.z*(n.z>=0?bounds.min.z:bounds.max.z)+constant>=0);
}

/** Ray proof of opaque convex coverage. Auxiliary render passes always retain the full source. */
export class MapRaycastOcclusion {
  enabled=false;
  budgetMs=2;
  private main=false;
  private mainColor=false;
  private shadow=false;
  private states=new Map<InstancedMesh,SourceState>();
  private geometries=new WeakMap<BufferGeometry,OccluderGeometry>();
  private pending=new Set<BufferGeometry>();
  private geometryReleases=new Map<BufferGeometry,()=>void>();
  private tree?:RayBranch<Blocker>;
  private targets:Candidate[]=[];
  private cursor=0;
  private remaining=0;
  private stamp=0;
  private nearSafe=.1;
  private cones=new Map<string,Cone>();
  private retained=0;
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
      // Streamer shadow reserves are pass-specific even when ray culling is off.
      // The nested shadowMap.render scope must still draw these casters.
      if(this.mainColor&&!this.shadow&&object.userData.streamAuxiliary)return;
      if(object.userData.rayOcclusionProxy){if(!this.main||this.shadow)return;}
      else if(this.main&&!this.shadow&&(this.states.get(object as InstancedMesh)?.hidden??0)>0)return;
      return direct(camera,scene,geometry,material,object,group);
    };
    const shadows=renderer.shadowMap.render.bind(renderer.shadowMap);
    renderer.shadowMap.render=(...args)=>{const previous=this.shadow;this.shadow=true;try{return shadows(...args);}finally{this.shadow=previous;}};
  }
  setEnabled(enabled:boolean){this.enabled=enabled;if(!enabled)this.reset();}
  renderMain<T>(bypass:boolean,work:()=>T):T {
    const previous=this.main,color=this.mainColor;this.main=this.enabled&&!bypass;this.mainColor=true;
    try{return work();}finally{this.main=previous;this.mainColor=color;}
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
    this.targets=[];this.tree=undefined;this.cursor=this.remaining=0;this.rayCount=this.tested=0;this.lastMs=0;this.cones.clear();
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
    if(poseChanged){
      this.stamp++;let cosine=1;
      for(const x of [-1,1])for(const y of [-1,1]){this.point.set(x,y,-1).applyMatrix4(camera.projectionMatrixInverse);cosine=Math.min(cosine,Math.abs(this.point.z)/this.point.length());}
      this.nearSafe=('near' in camera?Number(camera.near):.1)/Math.max(.001,cosine)+1e-5;
    }
    const sources=root.children.filter((object):object is InstancedMesh=>object instanceof InstancedMesh&&!object.userData.streamAuxiliary&&!object.userData.rayOcclusionProxy&&object.visible&&object.count>0&&object.layers.test(camera.layers));
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
      this.tree=rayTree(blockers);
    }
    this.retained=0;if(changed)this.cones.clear();
    if(poseChanged||changed)for(const target of this.targets)if(target.hidden){
      const valid=target.proof&&this.canCull(target.source)&&this.frustum.intersectsBox(target.bounds)&&this.covers(target.bounds,target.proof);
      if(!valid){target.hidden=false;target.proof=undefined;this.states.get(target.source)!.needsProxy=true;}else this.retained++;
    }
    if(poseChanged||changed||prepared)this.remaining=this.targets.length;
    while(this.remaining>0&&performance.now()-started<this.budgetMs){
      const target=this.targets[this.cursor++%this.targets.length];this.remaining--;this.tested++;
      if(target.hidden)continue;
      const proof=this.canCull(target.source)&&this.frustum.intersectsBox(target.bounds)&&!target.bounds.containsPoint(this.origin)?this.findProof(target):undefined;
      const hidden=!!proof;target.proof=proof;
      if(hidden!==target.hidden){target.hidden=hidden;this.states.get(target.source)!.needsProxy=true;}
    }
    for(const [source,state] of this.states)if(state.needsProxy){this.updateProxy(source,state);state.needsProxy=false;}
    this.lastMs=performance.now()-started;
  }
  private covers(bounds:Box3,proof:Proof):boolean {
    const blocker=proof.blocker;
    if(this.states.get(blocker.source)?.candidates[blocker.slot]?.matrix!==blocker.matrix)return false;
    let cached=this.cones.get(proof.key);
    if(!cached){
      cached={stamp:-1,valid:false};this.cones.set(proof.key,cached);
      const local=blocker.rays.patchVertices(proof.patch);if(!local)return false;
      const polygon=local.map(v=>v.clone().applyMatrix4(blocker.matrix));
      cached.polygon=polygon;cached.center=polygon.reduce((sum,v)=>sum.add(v),new Vector3()).multiplyScalar(1/polygon.length);
      cached.base=new Plane().setFromCoplanarPoints(polygon[0],polygon[1],polygon[2]);
      cached.planes=Array.from({length:polygon.length+1},()=>new Plane());
    }
    if(cached.stamp!==this.stamp){
      cached.stamp=this.stamp;cached.valid=false;
      if(!cached.base||!cached.polygon||!cached.planes)return false;
      const polygon=cached.polygon,planes=cached.planes,front=planes[0].copy(cached.base);
      if(front.distanceToPoint(this.origin)>0)front.negate();
      if(front.distanceToPoint(this.origin)>-this.nearSafe)return false;
      front.constant-=.5;
      for(let i=0;i<polygon.length;i++){
        const side=planes[i+1].setFromCoplanarPoints(this.origin,polygon[i],polygon[(i+1)%polygon.length]);
        if(side.normal.lengthSq()<.5)return false;
        if(side.distanceToPoint(cached.center!)<0)side.negate();side.constant-=.01;
      }
      cached.valid=true;
    }
    return cached.valid&&!!cached.planes&&insidePlanes(bounds,cached.planes);
  }
  private findProof(target:Candidate):Proof|undefined {
    const point=target.bounds.getCenter(new Vector3());
    this.rayCount++;
    const far=point.distanceTo(this.origin)-.5;if(far<=0)return;
    this.ray.set(this.origin,point.clone().sub(this.origin).normalize());
    const stack=this.tree?[this.tree]:[],tested=new Set<string>();
    while(stack.length){
      const node=stack.pop()!,entry=this.ray.intersectBox(node.bounds,this.point);
      if(!entry||(!node.bounds.containsPoint(this.origin)&&entry.distanceTo(this.origin)>=far))continue;
      if(node.items)for(const blocker of node.items){
        if(blocker.id===target.id)continue;
        this.localRay.copy(this.ray).applyMatrix4(blocker.inverse);
        this.localEnd.copy(this.origin).addScaledVector(this.ray.direction,far).applyMatrix4(blocker.inverse);
        const localFar=this.localEnd.distanceTo(this.localRay.origin);
        for(const hit of blocker.rays.intersections(this.localRay,localFar,8))for(const patch of [...hit.patches].reverse()){
          const key=`${blocker.id}/${patch}`;if(tested.has(key))continue;tested.add(key);
          const proof={blocker,patch,key};if(this.covers(target.bounds,proof))return proof;
        }
      }else{if(node.left)stack.push(node.left);if(node.right)stack.push(node.right);}
    }return;
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
    `Rays/frame ${this.rayCount} · tested/frame ${this.tested} · processed ${this.targets.length-this.remaining}/${this.targets.length} · hidden instances ${[...this.states.values()].reduce((n,s)=>n+s.hidden,0)} · retained proofs ${this.retained} · BVH queue ${this.pending.size}`];}
}
