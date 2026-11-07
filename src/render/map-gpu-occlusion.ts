import {Box3,BufferGeometry,Color,DataTexture,DepthTexture,Float32BufferAttribute,FloatType,FrontSide,GLSL3,Group,InstancedMesh,LessDepth,LessEqualDepth,LineBasicMaterial,LineSegments,Matrix4,Mesh,MeshBasicMaterial,MeshStandardMaterial,NearestFilter,NoBlending,OrthographicCamera,PlaneGeometry,Quaternion,RawShaderMaterial,RGBAFormat,Scene,UnsignedIntType,Vector2,Vector3,Vector4,WebGLRenderTarget,type Camera,type WebGLRenderer} from 'three';

interface Source {mesh:InstancedMesh;key:string;world:Matrix4;bounds:Box3[];depth?:InstancedMesh;proxy?:InstancedMesh;kept:string;hidden:number;visibleSlots?:Set<number>;identities?:string[];compatibility?:string}
interface Ticket {sync:WebGLSync;buffer:WebGLBuffer;bytes:Uint8Array;items:{state:Source;slot:number}[];frame:number;time:number;position:Vector3;rotation:Quaternion;projection:Matrix4}
const vertex=`precision highp float; in vec3 position; void main(){gl_Position=vec4(position.xy,0.,1.);}`;
const packing=`
#include <packing>
vec4 packDepth(float v){return packDepthToRGBA(v);}
float unpackDepth(vec4 v){return unpackRGBAToDepth(v);}`;

/** A static scene has no wall-clock expiry. Moving-camera reuse remains heuristic. */
export function gpuResultUsable(ageMs:number,distance:number,angle:number){return Number.isFinite(ageMs)&&ageMs>=0&&distance<=2&&angle<=Math.PI/120;}
export function gpuSourceKey(mesh:InstancedMesh){return `${mesh.geometry.id}:${mesh.count}:${mesh.instanceMatrix.version}:${mesh.instanceColor?.version??0}:${mesh.userData.mapOcclusionRole}:${(Array.isArray(mesh.material)?mesh.material:[mesh.material]).map(m=>m.uuid+":"+m.version).join(",")}`;}

/** Surface role comes from map loading, not dimensions: flat roads and small wall
 * sections are useful occluders, tall trees are not. Preserve real material holes. */
export function gpuDepthOccluder(mesh:InstancedMesh){
  const role=mesh.userData.mapOcclusionRole;
  const m=mesh.material;
  return (role==='terrain'||role==='structure')&&m instanceof MeshStandardMaterial&&m.visible&&m.depthWrite&&m.depthTest&&m.colorWrite&&!m.transparent&&m.opacity===1&&!m.alphaMap&&!m.alphaTest&&!m.alphaHash&&!m.alphaToCoverage&&!m.displacementMap&&!m.clippingPlanes?.length;
}

/** GPU Hi-Z tests, one output pixel per instance; only small visibility flags return to JS.
 * Depth uses real opaque geometry, never the bounding boxes themselves as occluders.
 * Results are read through PBO/fence without waiting; shadows/reflections keep full sources. */
export class MapGpuOcclusion {
  enabled=false;
  intervalFrames=4;
  applyResults=true;
  freeze=false;
  debugMode='off';
  observerView=false;
  private bypassed=false;
  private depthNearFar=new Vector2(.1,5000);
  private debugMaterial:RawShaderMaterial;
  private boxesScene=new Scene();
  private boxLines=new LineSegments(new BufferGeometry(),new LineBasicMaterial({vertexColors:true,depthTest:false,depthWrite:false,toneMapped:false}));
  extraDraws=0;extraTriangles=0;
  private states=new Map<InstancedMesh,Source>();
  private depthScene=new Scene();
  private quadScene=new Scene();private quadCamera=new OrthographicCamera(-1,1,1,-1,0,1);
  private quad=new Mesh(new PlaneGeometry(2,2),new RawShaderMaterial());
  private depthTarget=new WebGLRenderTarget(512,256,{minFilter:NearestFilter,magFilter:NearestFilter});
  private levels:WebGLRenderTarget[]=[];
  private result=new WebGLRenderTarget(256,1,{depthBuffer:false,minFilter:NearestFilter,magFilter:NearestFilter});
  private boxes?:DataTexture;
  private reduce:RawShaderMaterial;
  private test:RawShaderMaterial;
  private pending?:Ticket;
  private frame=0;private lastSubmit=-Infinity;
  private latency=0;private latencyMs=0;private tested=0;private rejected=0;private submissions=0;private maxLatency=0;
  private lastDepthDraws=0;private lastDraws=0;private lastTriangles=0;private error='';
  private matrix=new Matrix4();private position=new Vector3();private rotation=new Quaternion();
  constructor(private renderer:WebGLRenderer){
    this.depthTarget.depthTexture=new DepthTexture(512,256,UnsignedIntType);
    this.depthTarget.texture.name='GPU occlusion depth color (unused)';
    for(let w=256,h=128;w>=1;w=Math.floor(w/2),h=Math.max(1,Math.floor(h/2)))this.levels.push(new WebGLRenderTarget(w,h,{depthBuffer:false,minFilter:NearestFilter,magFilter:NearestFilter}));
    this.reduce=new RawShaderMaterial({glslVersion:GLSL3,depthTest:false,depthWrite:false,blending:NoBlending,vertexShader:vertex,
      uniforms:{source:{value:null},first:{value:0}},fragmentShader:`precision highp float; precision highp int; uniform sampler2D source; uniform int first; out vec4 result; ${packing}
      void main(){ivec2 p=ivec2(gl_FragCoord.xy)*2; ivec2 hi=textureSize(source,0)-1; float d=0.;
      for(int y=0;y<2;y++)for(int x=0;x<2;x++){vec4 v=texelFetch(source,min(p+ivec2(x,y),hi),0);d=max(d,first==1?v.r:unpackDepth(v));} result=packDepth(d);}`});
    const samplers=this.levels.map((_,i)=>`uniform sampler2D level${i};`).join('\n');
    const select=this.levels.map((_,i)=>`${i?'else ':''}if(level==${i})return unpackDepth(texelFetch(level${i},p,0));`).join('\n');
    const uniforms:Record<string,{value:any}>={boxes:{value:null},viewProjection:{value:new Matrix4()},count:{value:0},outputWidth:{value:256}};
    this.levels.forEach((t,i)=>uniforms[`level${i}`]={value:t.texture});
    this.test=new RawShaderMaterial({glslVersion:GLSL3,depthTest:false,depthWrite:false,blending:NoBlending,vertexShader:vertex,uniforms,
      fragmentShader:`precision highp float; precision highp int; uniform sampler2D boxes; uniform mat4 viewProjection; uniform int count; uniform int outputWidth; ${samplers} out vec4 result; ${packing}
      float depthAt(int level,ivec2 p){${select}return 1.;}
      void main(){int id=int(gl_FragCoord.x)+int(gl_FragCoord.y)*outputWidth; result=vec4(1.);if(id>=count)return;
      vec3 lo=texelFetch(boxes,ivec2((id*2)%1024,(id*2)/1024),0).xyz;
      vec3 hi=texelFetch(boxes,ivec2((id*2+1)%1024,(id*2+1)/1024),0).xyz;
      vec2 a=vec2(1.),b=vec2(-1.);float nearDepth=1.;
      for(int i=0;i<8;i++){vec4 c=viewProjection*vec4(vec3((i&1)==0?lo.x:hi.x,(i&2)==0?lo.y:hi.y,(i&4)==0?lo.z:hi.z),1.);
      if(c.w<=0.||c.z<=-c.w)return;vec3 n=c.xyz/c.w;a=min(a,n.xy);b=max(b,n.xy);nearDepth=min(nearDepth,n.z*.5+.5);}
      if(any(lessThan(b,vec2(-1.)))||any(greaterThan(a,vec2(1.))))return;
      // Expand to cover low-resolution edge uncertainty, and sample every intersected Hi-Z texel.
      a=clamp((a*.5+.5)*vec2(512.,256.)-vec2(2.),vec2(0.),vec2(511.,255.));
      b=clamp((b*.5+.5)*vec2(512.,256.)+vec2(2.),vec2(0.),vec2(511.,255.));
      int level=int(clamp(ceil(log2(max(max(b.x-a.x,b.y-a.y),2.)))-1.,0.,8.));
      float scale=exp2(float(level+1));ivec2 p=ivec2(floor(a/scale)),q=ivec2(floor(b/scale));float farDepth=0.;
      for(int y=0;y<3;y++)for(int x=0;x<3;x++){ivec2 t=p+ivec2(x,y);if(t.x<=q.x&&t.y<=q.y)farDepth=max(farDepth,depthAt(level,t));}
      result=vec4(nearDepth>farDepth+0.000002?0.:1.);}`});
    this.debugMaterial=new RawShaderMaterial({glslVersion:GLSL3,depthTest:false,depthWrite:false,blending:NoBlending,
      uniforms:{source:{value:null},mode:{value:0},nearFar:{value:new Vector2(.1,5000)}},
      vertexShader:`precision highp float; in vec3 position; out vec2 uv; void main(){uv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}`,
      fragmentShader:`precision highp float; precision highp int; uniform sampler2D source; uniform int mode; uniform vec2 nearFar; in vec2 uv; out vec4 result; ${packing}
      void main(){vec4 s=texture(source,uv);if(mode==2){result=vec4(s.r>.5?vec3(.1,1.,.2):vec3(1.,.08,.04),1.);return;}
      float d=mode==0?s.r:unpackDepth(s);if(d>=.9999999){result=vec4(.05,.1,.25,1.);return;}
      float z=nearFar.x*nearFar.y/(nearFar.y-d*(nearFar.y-nearFar.x));
      float gray=clamp(log2(1.+z)/log2(501.),0.,1.);result=vec4(vec3(gray),1.);}`});
    this.boxLines.frustumCulled=false;this.boxesScene.add(this.boxLines);
    this.quad.material.dispose();this.quad.frustumCulled=false;this.quadScene.add(this.quad);
    // Main-only hidden meshes must still cast dynamic shadows.
    const renderShadows=renderer.shadowMap.render.bind(renderer.shadowMap);
    renderer.shadowMap.render=(...args)=>{const hidden=this.hiddenMain;for(const m of hidden)m.visible=true;
      try{return renderShadows(...args);}finally{for(const m of hidden)m.visible=false;}};
  }
  setEnabled(enabled:boolean){this.enabled=enabled;this.reset();}
  private hiddenMain:InstancedMesh[]=[];
  private recentHidden:number[]=[];
  renderMain<T>(work:()=>T):T{
    if(!this.applyResults){this.recentHidden=[];return work();}
    const hidden:InstancedMesh[]=[],proxies:InstancedMesh[]=[];
    for(const s of this.states.values())if(s.hidden&&s.mesh.visible&&s.mesh.parent&&gpuSourceKey(s.mesh)===s.key&&s.world.equals(s.mesh.matrixWorld)&&!s.mesh.userData.streamAuxiliary){
      s.mesh.visible=false;hidden.push(s.mesh);if(s.proxy){s.mesh.parent.add(s.proxy);proxies.push(s.proxy);}
    }
    this.hiddenMain=hidden;
    this.recentHidden.push(hidden.reduce((n,m)=>n+(this.states.get(m)?.hidden??0),0));if(this.recentHidden.length>120)this.recentHidden.shift();
    try{return work();}finally{for(const m of hidden)m.visible=true;for(const p of proxies)p.removeFromParent();this.hiddenMain=[];}
  }
  private release(s:Source){s.depth?.removeFromParent();s.depth?.dispose();if(s.depth)(s.depth.material as MeshBasicMaterial).dispose();s.proxy?.removeFromParent();s.proxy?.dispose();}
  reset(){this.cancel();for(const s of this.states.values())this.release(s);this.states.clear();this.recentHidden=[];this.tested=0;this.lastPose=undefined;this.lastStreamRevision=undefined;this.lastSubmit=-Infinity;this.submissions=this.rejected=this.maxLatency=this.latency=this.latencyMs=0;this.extraDraws=this.extraTriangles=0;}
  private cancel(){if(this.pending){const gl=this.renderer.getContext() as WebGL2RenderingContext;gl.deleteSync(this.pending.sync);gl.deleteBuffer(this.pending.buffer);this.pending=undefined;}}
  private showAll(){for(const s of this.states.values()){s.hidden=0;s.proxy?.removeFromParent();s.kept='';}}
  private collect(root:Group){
    root.updateWorldMatrix(true,true);
    const seen=new Set<InstancedMesh>();
    root.traverseVisible(o=>{
      if(!(o instanceof InstancedMesh)||o.count===0||o.userData.streamAuxiliary||o.userData.rayOcclusionProxy||o.userData.gpuOcclusionProxy)return;
      const materials=Array.isArray(o.material)?o.material:[o.material];
      if(Object.keys(o.geometry.morphAttributes).length||!materials.every(m=>m instanceof MeshStandardMaterial&&m.depthTest&&(m.depthFunc===LessDepth||m.depthFunc===LessEqualDepth)&&!m.displacementMap&&!m.clippingPlanes?.length))return;
      seen.add(o);const key=gpuSourceKey(o),old=this.states.get(o);
      if(old?.key===key&&old.world.equals(o.matrixWorld))return;
      const compatibility=`${o.geometry.id}:${o.userData.mapOcclusionRole}:${materials.map(m=>m.uuid+':'+m.version).join(',')}`;
      const identities=Array.from({length:o.count},(_,slot)=>Array.from(o.instanceMatrix.array.subarray(slot*16,slot*16+16)).join(','));
      // Buffer slots are transient: retain verdicts by exact placement matrix, not slot number.
      const retained=old?.hidden&&old.compatibility===compatibility&&old.world.equals(o.matrixWorld)&&old.visibleSlots&&old.identities
        ?new Map(old.identities.map((id,slot)=>[id,old.visibleSlots!.has(slot)])):undefined;
      if(old)this.release(old);
      if(!o.geometry.boundingBox)o.geometry.computeBoundingBox();
      const bounds:Box3[]=[];
      for(let slot=0;slot<o.count;slot++){o.getMatrixAt(slot,this.matrix);bounds.push(o.geometry.boundingBox!.clone().applyMatrix4(this.matrix.premultiply(o.matrixWorld)).expandByScalar(.35));}
      const state:Source={mesh:o,key,world:o.matrixWorld.clone(),bounds,kept:'',hidden:0,identities,compatibility};
      if(gpuDepthOccluder(o)){
        const material=new MeshBasicMaterial({colorWrite:false,side:materials[0].side??FrontSide});
        const depth=new InstancedMesh(o.geometry,material,o.instanceMatrix.count);depth.instanceMatrix.array.set(o.instanceMatrix.array);depth.instanceMatrix.needsUpdate=true;depth.count=o.count;depth.matrixAutoUpdate=false;depth.matrix.copy(o.matrixWorld);depth.frustumCulled=true;state.depth=depth;this.depthScene.add(depth);
      }
      this.states.set(o,state);
      if(retained)this.updateVisible(state,identities.flatMap((id,slot)=>retained.get(id)===false?[]:[slot]));
    });
    for(const [mesh,state] of this.states)if(!seen.has(mesh)){this.release(state);this.states.delete(mesh);}
  }
  private apply(ticket:Ticket){
    const flags=new Map<Source,number[]>();let complete=true;
    for(let i=0;i<ticket.items.length;i++){const {state,slot}=ticket.items[i];if(this.states.get(state.mesh)!==state||gpuSourceKey(state.mesh)!==state.key){complete=false;continue;}
      let kept=flags.get(state);if(!kept){kept=[];flags.set(state,kept);}if(ticket.bytes[i*4]!==0)kept.push(slot);}
    for(const [s,kept] of flags)this.updateVisible(s,kept);
    return complete;
  }
  private updateVisible(s:Source,kept:number[]){
      s.visibleSlots=new Set(kept);s.hidden=s.mesh.count-kept.length;const key=kept.join(',');
      if(!s.hidden||!kept.length){s.proxy?.dispose();s.proxy=undefined;s.kept=key;return;}
      if(s.kept===key&&s.proxy)return;
      if(!s.proxy||s.proxy.instanceMatrix.count<s.mesh.count){s.proxy?.dispose();s.proxy=new InstancedMesh(s.mesh.geometry,s.mesh.material,s.mesh.count);s.proxy.userData.gpuOcclusionProxy=true;s.proxy.name=`${s.mesh.name} / GPU visible`;s.proxy.castShadow=false;s.proxy.receiveShadow=s.mesh.receiveShadow;s.proxy.layers.mask=s.mesh.layers.mask;s.proxy.renderOrder=s.mesh.renderOrder;s.proxy.matrixAutoUpdate=false;}
      const p=s.proxy;p.matrix.copy(s.mesh.matrix);p.matrixWorldNeedsUpdate=true;
      for(let i=0;i<kept.length;i++){p.instanceMatrix.array.set(s.mesh.instanceMatrix.array.subarray(kept[i]*16,kept[i]*16+16),i*16);if(s.mesh.instanceColor){const color=new Color().fromArray(s.mesh.instanceColor.array,kept[i]*3);p.setColorAt(i,color);}}
      p.count=kept.length;p.instanceMatrix.needsUpdate=true;if(p.instanceColor)p.instanceColor.needsUpdate=true;p.computeBoundingSphere();s.kept=key;
  }
  prepare(camera:Camera,root:Group|undefined,bypass=false,streamRevision?:number){
    this.frame++;this.extraDraws=this.extraTriangles=0;this.bypassed=bypass;
    if(!this.enabled||!root||bypass){this.showAll();this.cancel();return;}
    const gl=this.renderer.getContext() as WebGL2RenderingContext;
    if(gl.isContextLost()){this.reset();return;}
    camera.updateWorldMatrix(true,false);camera.getWorldPosition(this.position);camera.getWorldQuaternion(this.rotation);
    try{
      // Keep the last completed result through submissions, pending fences and long intervals.
      // Only actual camera/projection changes invalidate its visibility proof.
      if(this.lastPose&&(!camera.projectionMatrix.equals(this.lastPose.projection)||!gpuResultUsable(performance.now()-this.lastPose.time,this.position.distanceTo(this.lastPose.position),this.rotation.angleTo(this.lastPose.rotation))))this.showAll();
      if(streamRevision!==undefined&&streamRevision!==this.lastStreamRevision){this.collect(root);this.lastStreamRevision=streamRevision;}
      if(this.pending){const t=this.pending,status=gl.clientWaitSync(t.sync,0,0);
        if(status===gl.WAIT_FAILED){this.cancel();this.error='GPU fence failed';return;}
        if(status!==gl.TIMEOUT_EXPIRED){
          this.latency=this.frame-t.frame;this.latencyMs=performance.now()-t.time;this.maxLatency=Math.max(this.maxLatency,this.latencyMs);
          if(gpuResultUsable(this.latencyMs,this.position.distanceTo(t.position),this.rotation.angleTo(t.rotation))&&camera.projectionMatrix.equals(t.projection)){
            const previous=gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,t.buffer);try{gl.getBufferSubData(gl.PIXEL_PACK_BUFFER,0,t.bytes);}finally{gl.bindBuffer(gl.PIXEL_PACK_BUFFER,previous);}const updatedAll=this.apply(t);if(updatedAll||!this.lastPose)this.lastPose={time:t.time,position:t.position,rotation:t.rotation,projection:t.projection};
          }else{this.rejected++;}this.cancel();
        }
      }
      if(this.pending||this.freeze&&this.submissions>0||this.frame-this.lastSubmit<this.intervalFrames)return;
      this.collect(root);this.submit(camera);this.error='';
    }catch(error){this.error=String(error);this.cancel();}
  }
  private lastStreamRevision?:number;
  private lastPose?:{time:number;position:Vector3;rotation:Quaternion;projection:Matrix4};
  private submit(camera:Camera){
    this.depthNearFar.set('near' in camera?Number(camera.near):.1,'far' in camera?Number(camera.far):5000);
    const items=[...this.states.values()].flatMap(state=>state.bounds.map((_,slot)=>({state,slot})));
    // Never partially evaluate a source when the bounded result texture is full.
    if(!items.length||items.length>32768)return;
    const height=Math.ceil(items.length*2/1024);
    if(!this.boxes||this.boxes.image.height<height){this.boxes?.dispose();this.boxes=new DataTexture(new Float32Array(1024*height*4),1024,height,RGBAFormat,FloatType);}
    const data=this.boxes.image.data as Float32Array;
    items.forEach(({state,slot},i)=>{state.bounds[slot].min.toArray(data,i*8);state.bounds[slot].max.toArray(data,i*8+4);});
    this.boxes.needsUpdate=true;
    this.test.uniforms.boxes.value=this.boxes;this.test.uniforms.count.value=items.length;this.test.uniforms.viewProjection.value.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    this.result.setSize(256,Math.ceil(items.length/256));
    const r=this.renderer,previous=r.getRenderTarget(),face=r.getActiveCubeFace(),mip=r.getActiveMipmapLevel(),viewport=r.getViewport(new Vector4()),scissor=r.getScissor(new Vector4()),scissorTest=r.getScissorTest(),auto=r.autoClear,shadows=r.shadowMap.enabled,xr=r.xr.enabled;
    try{
      r.xr.enabled=false;r.shadowMap.enabled=false;r.autoClear=true;r.setScissorTest(false);
      r.setRenderTarget(this.depthTarget);r.render(this.depthScene,camera);this.extraDraws+=r.info.render.calls;this.extraTriangles+=r.info.render.triangles;this.lastDepthDraws=r.info.render.calls;
      this.quad.material=this.reduce;
      for(let i=0;i<this.levels.length;i++){this.reduce.uniforms.source.value=i===0?this.depthTarget.depthTexture:this.levels[i-1].texture;this.reduce.uniforms.first.value=i===0?1:0;r.setRenderTarget(this.levels[i]);r.render(this.quadScene,this.quadCamera);this.extraDraws+=r.info.render.calls;this.extraTriangles+=r.info.render.triangles;}
      this.quad.material=this.test;r.setRenderTarget(this.result);r.render(this.quadScene,this.quadCamera);this.extraDraws+=r.info.render.calls;this.extraTriangles+=r.info.render.triangles;
      const gl=r.getContext() as WebGL2RenderingContext,buffer=gl.createBuffer();if(!buffer)throw Error('GPU visibility PBO allocation failed');
      const bytes=new Uint8Array(this.result.width*this.result.height*4),old=gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
      try{gl.bindBuffer(gl.PIXEL_PACK_BUFFER,buffer);gl.bufferData(gl.PIXEL_PACK_BUFFER,bytes.length,gl.STREAM_READ);gl.readPixels(0,0,this.result.width,this.result.height,gl.RGBA,gl.UNSIGNED_BYTE,0);}catch(e){gl.deleteBuffer(buffer);throw e;}finally{gl.bindBuffer(gl.PIXEL_PACK_BUFFER,old);}
      const sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);if(!sync){gl.deleteBuffer(buffer);throw Error('GPU visibility fence allocation failed');}gl.flush();
      this.pending={sync,buffer,bytes,items,frame:this.frame,time:performance.now(),position:this.position.clone(),rotation:this.rotation.clone(),projection:camera.projectionMatrix.clone()};
      this.lastSubmit=this.frame;this.tested=items.length;this.submissions++;this.lastDraws=this.extraDraws;this.lastTriangles=this.extraTriangles;
    }finally{r.setRenderTarget(previous,face,mip);r.setViewport(viewport);r.setScissor(scissor);r.setScissorTest(scissorTest);r.autoClear=auto;r.shadowMap.enabled=shadows;r.xr.enabled=xr;}
  }
  /** Diagnostic rendering stays on GPU; no image readback or CPU depth reconstruction. */
  renderDebug(camera:Camera){
    if(!this.enabled||this.debugMode==='off')return;
    const r=this.renderer,viewport=r.getViewport(new Vector4()),scissor=r.getScissor(new Vector4()),scissorTest=r.getScissorTest(),auto=r.autoClear,reset=r.info.autoReset,shadows=r.shadowMap.enabled;
    try{
      r.autoClear=false;r.info.autoReset=false;r.shadowMap.enabled=false;
      if(this.debugMode==='boxes'||this.debugMode==='boxes-hidden'){
        const positions:number[]=[],colors:number[]=[];
        const edges=[0,1,0,2,0,4,1,3,1,5,2,3,2,6,3,7,4,5,4,6,5,7,6,7];
        for(const s of this.states.values())for(let i=0;i<s.bounds.length;i++){
          if(this.debugMode==='boxes-hidden'&&(!s.visibleSlots||s.visibleSlots.has(i)))continue;
          const b=s.bounds[i],color=!s.visibleSlots?[.65,.65,.65]:s.visibleSlots.has(i)?[.1,1,.2]:[1,.08,.04];
          for(const v of edges){positions.push(v&1?b.max.x:b.min.x,v&2?b.max.y:b.min.y,v&4?b.max.z:b.min.z);colors.push(...color);}
        }
        this.boxLines.geometry.dispose();this.boxLines.geometry=new BufferGeometry();this.boxLines.geometry.setAttribute('position',new Float32BufferAttribute(positions,3));this.boxLines.geometry.setAttribute('color',new Float32BufferAttribute(colors,3));
        r.render(this.boxesScene,camera);
      }else{
        const level=Number(this.debugMode.replace('hiz-','')),isDepth=this.debugMode==='depth',isFlags=this.debugMode==='flags';
        this.debugMaterial.uniforms.source.value=isDepth?this.depthTarget.depthTexture:isFlags?this.result.texture:this.levels[Math.max(0,Math.min(8,level||0))].texture;
        this.debugMaterial.uniforms.mode.value=isDepth?0:isFlags?2:1;
        this.debugMaterial.uniforms.nearFar.value.copy(this.depthNearFar);
        this.quad.material=this.debugMaterial;
        // Scissored inset leaves both scene and diagnostic controls visible.
        const x=Math.max(0,(viewport.z-512)/2);r.setViewport(x,12,512,256);r.setScissor(x,12,512,256);r.setScissorTest(true);r.render(this.quadScene,this.quadCamera);
      }
    }finally{r.setViewport(viewport);r.setScissor(scissor);r.setScissorTest(scissorTest);r.autoClear=auto;r.info.autoReset=reset;r.shadowMap.enabled=shadows;}
  }
  stats(){return {enabled:this.enabled,recent_applied_hidden_min:this.recentHidden.length?Math.min(...this.recentHidden):0,recent_applied_hidden_max:this.recentHidden.length?Math.max(...this.recentHidden):0,visibility_camera:'primary',observer_view:this.observerView,bypassed:this.bypassed,apply_results:this.applyResults,debug_mode:this.debugMode,frozen:this.freeze,interval_frames:this.intervalFrames,tested_instances:this.tested,depth_terrain_batches:[...this.states.values()].filter(s=>s.depth&&s.mesh.userData.mapOcclusionRole==='terrain').length,depth_structure_batches:[...this.states.values()].filter(s=>s.depth&&s.mesh.userData.mapOcclusionRole==='structure').length,excluded_prop_batches:[...this.states.values()].filter(s=>s.mesh.userData.mapOcclusionRole==='prop').length,hidden_instances:[...this.states.values()].reduce((n,s)=>n+s.hidden,0),hidden_draws:[...this.states.values()].filter(s=>s.hidden===s.mesh.count).length,latency_frames:this.latency,latency_ms:this.latencyMs,max_latency_ms:this.maxLatency,rejected_results:this.rejected,submissions:this.submissions,depth_draws:this.lastDepthDraws,extra_draws_per_update:this.lastDraws,extra_triangles_per_update:this.lastTriangles,error:this.error};}
  lines(){const s=this.stats();return [`GPU Hi-Z occlusion: ${this.enabled?'on':'off'} · tested ${s.tested_instances} · hidden instances ${s.hidden_instances} / whole draws ${s.hidden_draws} · depth 512×256, every ${this.intervalFrames} frames`,
    `GPU visibility readback: ${s.latency_frames} frames / ${s.latency_ms.toFixed(1)} ms (max ${s.max_latency_ms.toFixed(1)}) · rejected ${s.rejected_results} · extra draws/update ${s.extra_draws_per_update} (depth ${s.depth_draws})${s.error?` · ERROR ${s.error}`:''}`,
    ...(this.enabled?[`GPU applied visibility (last 120 main frames): hidden instances ${s.recent_applied_hidden_min}–${s.recent_applied_hidden_max}`,`GPU occlusion camera: primary · display ${this.observerView?'observer':'primary'}${this.bypassed?' · BYPASSED (distance cutoff / inspect all / CPU rays)':''}`,`GPU depth sources: terrain ${s.depth_terrain_batches} · structures ${s.depth_structure_batches} · excluded prop batches ${s.excluded_prop_batches}`,`GPU visibility debug: ${this.debugMode}${this.freeze?' (frozen)':''} · apply results ${this.applyResults?'on':'off (measurement only)'} · depth: logarithmic 0–500 m, blue = empty; boxes: red hidden / green visible / gray untested`]:[])];}
  dispose(){this.reset();this.depthTarget.dispose();for(const t of this.levels)t.dispose();this.result.dispose();this.boxes?.dispose();this.quad.geometry.dispose();this.reduce.dispose();this.test.dispose();this.debugMaterial.dispose();this.boxLines.geometry.dispose();this.boxLines.material.dispose();}
}
