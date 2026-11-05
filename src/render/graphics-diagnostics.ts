import { HalfFloatType, FloatType, Texture, Vector2, type Scene, type WebGLRenderer, type Material } from 'three';
import type { FrameProfiler } from './frame-profiler';

export interface DrawWork { draws:number; triangles:number; instances:number }
const empty=():DrawWork=>({draws:0,triangles:0,instances:0});
const add=(a:DrawWork,b:DrawWork)=>{a.draws+=b.draws;a.triangles+=b.triangles;a.instances+=b.instances;};
const mib=(bytes:number)=>(bytes/1048576).toFixed(1)+' MiB';

/** Referenced scene resources, not a driver VRAM reading or vertex/fragment invocation counter. */
export function sceneResources(scene:Scene) {
  const buffers=new Set<object>(),sources=new Map<string,Texture>(),materials=new Set<Material>();
  let geometryBytes=0,instanceBytes=0,instanceSlots=0,objects=0,meshes=0,visibleMeshes=0;
  const buffer=(attribute:any)=>{
    const storage=attribute?.isInterleavedBufferAttribute?attribute.data:attribute;
    if(!storage?.array||buffers.has(storage))return 0;buffers.add(storage);return storage.array.byteLength;
  };
  scene.traverse((object:any)=>{
    objects++;if(object.isMesh)meshes++;
    if(object.geometry){for(const attr of Object.values(object.geometry.attributes))geometryBytes+=buffer(attr);geometryBytes+=buffer(object.geometry.index);}
    if(object.instanceMatrix){instanceBytes+=buffer(object.instanceMatrix)+buffer(object.instanceColor);instanceSlots+=object.instanceMatrix.count;}
    for(const material of object.material?(Array.isArray(object.material)?object.material:[object.material]):[]) {
      materials.add(material);
      for(const texture of [...Object.values(material),...Object.values(material.userData)])if(texture instanceof Texture && !texture.isRenderTargetTexture){
        const key=[texture.source.uuid,texture.colorSpace,texture.wrapS,texture.wrapT,texture.minFilter,texture.magFilter,
          texture.type,texture.format,texture.flipY,texture.anisotropy].join(':');sources.set(key,texture);
      }
    }
  });
  scene.traverseVisible((object:any)=>{if(object.isMesh)visibleMeshes++;});
  let textureBytes=0;
  const files=new Map<string,{name:string;bytes:number;copies:number;width:number;height:number}>();
  for(const texture of sources.values()) {
    const mipBytes=texture.mipmaps?.reduce((n:number,m:any)=>n+(m.data?.byteLength??0),0)??0;
    let bytes=mipBytes;
    const images=Array.isArray(texture.image)?texture.image:[texture.image];
    if(!mipBytes)for(const image of images)if(image?.width&&image?.height)bytes+=image.width*image.height
      *(texture.type===FloatType?16:texture.type===HalfFloatType?8:4)*(texture.generateMipmaps?4/3:1);
    textureBytes+=bytes;
    const name=texture.name?.replaceAll('\\','/').toLowerCase()||'(unnamed)';
    const row=files.get(name)??{name,bytes:0,copies:0,width:images[0]?.width??0,height:images[0]?.height??0};
    row.bytes+=bytes;row.copies++;files.set(name,row);
  }
  return {geometryBytes,instanceBytes,instanceSlots,textureBytes,materials:materials.size,textures:sources.size,objects,meshes,visibleMeshes,
    textureFiles:[...files.values()].sort((a,b)=>b.bytes-a.bytes)};
}

/** Optional mesh draw inspection. Disabled mode adds only a branch to existing renderer entry points. */
export class GraphicsDiagnostics {
  enabled=false;
  private phase='Main color';
  private passes=new Map<string,DrawWork>();
  private objects=new Map<string,DrawWork>();
  private recentPasses=new Map<string,{work:DrawWork;at:number}>();
  private targets=new Map<string,Set<string>>();
  private colorQuery?:WebGLQuery;
  private draws=0;
  private colorStart=0;
  private colorCpuStart?:number;
  private shadowCpu=0;
  private readonly size=new Vector2();
  private memory?:ReturnType<typeof sceneResources>;
  private memoryAt=-Infinity;
  constructor(private renderer:WebGLRenderer,private profiler:FrameProfiler) {
    const direct=renderer.renderBufferDirect.bind(renderer);
    renderer.renderBufferDirect=(camera,scene,geometry,material,object,group)=>{
      if(!this.enabled)return direct(camera,scene,geometry,material,object,group);
      const before={...renderer.info.render};
      direct(camera,scene,geometry,material,object,group);
      const draws=renderer.info.render.calls-before.calls;if(!draws)return;
      this.draws+=draws;
      const target=renderer.getRenderTarget();
      const targets=this.targets.get(this.phase)??new Set<string>();
      targets.add(target?`${target.width}×${target.height}${'isWebGLCubeRenderTarget' in target?' cube':''}`:'screen');
      this.targets.set(this.phase,targets);
      const work={draws,triangles:renderer.info.render.triangles-before.triangles,
        instances:draws*((object as any).isInstancedMesh?(object as any).count:1)};
      const kind=material.transparent?'blend':material.alphaTest?'cutout':'opaque';
      this.accumulate(this.passes,`${this.phase} / ${kind}`,work);
      this.accumulate(this.objects,`${this.phase}: ${object.name||geometry.name||object.type}`,work);
    };
    const shadows=renderer.shadowMap.render.bind(renderer.shadowMap);
    renderer.shadowMap.render=(...args)=>{
      if(!this.enabled||this.phase!=='Main color')return shadows(...args);
      const previous=this.phase;this.phase='Dynamic shadows';
      const start=this.draws;
      const cpuStart=performance.now();
      const query=profiler.detailedGpu?profiler.startGpuSection('GPU dynamic shadows'):undefined;
      try{return shadows(...args);}finally{
        this.shadowCpu=performance.now()-cpuStart;profiler.record('Dynamic shadow submission CPU',this.shadowCpu);
        profiler.finishGpuSection(query,this.draws>start);this.phase=previous;
        this.colorQuery=profiler.detailedGpu?profiler.startGpuSection('GPU main color'):undefined;
        this.colorStart=this.draws;
        this.colorCpuStart=performance.now();
      }
    };
  }
  private accumulate(map:Map<string,DrawWork>,name:string,work:DrawWork){const row=map.get(name)??empty();add(row,work);map.set(name,row);}
  beginFrame(){if(this.enabled){
    for(const [name,work] of this.passes)this.recentPasses.set(name,{work,at:performance.now()});
    this.passes.clear();this.objects.clear();
  }}
  pass<T>(name:string,work:()=>T):T {
    const previous=this.phase;this.phase=name;
    const cpuStart=performance.now();
    if(name==='Main color'){this.colorCpuStart=undefined;this.shadowCpu=0;}
    const start=this.draws;
    const query=name!=='Main color'&&this.profiler.detailedGpu?this.profiler.startGpuSection(`GPU ${name.toLowerCase()}`):undefined;
    try{return work();}
    finally{
      this.profiler.finishGpuSection(query,this.draws>start);
      if(name==='Main color'){
        this.profiler.finishGpuSection(this.colorQuery,this.draws>this.colorStart);this.colorQuery=undefined;
        if(this.enabled&&this.colorCpuStart!==undefined){
          this.profiler.record('Main color submission CPU',performance.now()-this.colorCpuStart);
          this.profiler.record('Renderer prepare CPU',Math.max(0,this.colorCpuStart-cpuStart-this.shadowCpu));
        }
      }
      this.phase=previous;
    }
  }
  lines(scene:Scene):string[] {
    if(!this.enabled)return [];
    const now=performance.now();if(!this.memory||now-this.memoryAt>2000){this.memory=sceneResources(scene);this.memoryAt=now;}
    const m=this.memory;this.renderer.getDrawingBufferSize(this.size);
    const totals=empty();for(const work of this.passes.values())add(totals,work);
    return [
      `Drawing buffer: ${this.size.x} × ${this.size.y} (${(this.size.x*this.size.y/1e6).toFixed(2)} MP), DPR ${this.renderer.getPixelRatio()}`,
      `Programs: ${this.renderer.info.programs?.length??0} · resident materials: ${m.materials}`,
      `Scene graph: objects ${m.objects} · meshes ${m.meshes} · visible hierarchy meshes ${m.visibleMeshes} (before camera culling)`,
      `All instrumented passes this frame: ${totals.draws} draws · ${totals.triangles.toLocaleString('en-US')} triangles · ${totals.instances} instance submissions`,
      `Render targets observed: ${[...this.targets].map(([name,sizes])=>`${name}: ${[...sizes].join(', ')}`).join(' · ')}`,
      `Referenced buffers: geometry ${mib(m.geometryBytes)} · instances ${mib(m.instanceBytes)} (${m.instanceSlots} slots)`,
      `Referenced texture storage ≈ ${mib(m.textureBytes)} (${m.textures} source/sampler pairs)`,
      'Estimates exclude driver, framebuffer/MSAA, shadow and reflection targets.',
      'Largest referenced texture files (source/sampler copies, not file sizes):',
      ...m.textureFiles.slice(0,12).map(t=>`${mib(t.bytes)} · ${t.copies} copies · ${t.width}×${t.height} · ${t.name}`),
      'Mesh work per pass (draws / triangles / instance submissions):',
      ...[...this.passes].map(([name,w])=>`${name}: ${w.draws} / ${w.triangles.toLocaleString('en-US')} / ${w.instances}`),
      ...[...this.recentPasses].filter(([name])=>!this.passes.has(name)).map(([name,{work:w,at}])=>
        `Last active ${name}: ${w.draws} draws / ${w.triangles.toLocaleString('en-US')} tris (${((now-at)/1000).toFixed(1)}s ago)`),
      'Heaviest mesh groups by submitted triangles:',
      ...[...this.objects].sort((a,b)=>b[1].triangles-a[1].triangles).slice(0,10).map(([name,w])=>`${w.draws} draws · ${w.triangles.toLocaleString('en-US')} tris · ${name}`),
      'Triangles are submitted work, not visible pixels. Cutout overdraw and cache reuse are not measured.',
      'Mesh counters exclude custom raw draws (e.g. flares). GPU timings are async samples; missing passes may be idle.',
      'Reflection totals include six cube faces and any shadow rendering performed for them.',
    ];
  }
}
