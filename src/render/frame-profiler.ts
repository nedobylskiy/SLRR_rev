import type { WebGLRenderer } from 'three';
import {BrowserPerformance} from './browser-performance';
import {GlActivity} from './gl-activity';

/** CPU measurements are submission time; GPU queries complete asynchronously. */
export class FrameProfiler {
  private samples = new Map<string, { average: number; peak: number; since: number; last:number;maximum:number;count:number;total:number;recent:number[];slot:number }>();
  private browser=new BrowserPerformance();
  private glActivity:GlActivity;
  private frameStart?:number;
  private frameRaf=0;
  private measured=0;
  private depth=0;
  private sections=new Map<string,number>();
  private outside=new Map<string,number>();
  private previous?:{start:number;end:number;raf:number;sections:Map<string,number>};
  private slow:{at:number;interval:number;rafInterval:number;callback:number;between:number;outside:Map<string,number>;sections:Map<string,number>}[]=[];
  private hardware?:string[];
  private disjointCount=0;
  private skipInterval=false;
  private readonly visibility=()=>{this.previous=undefined;this.outside.clear();this.skipInterval=true;};
  private readonly gl: WebGL2RenderingContext;
  private readonly timer: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private queries: {query:WebGLQuery;name:string;started:number}[] = [];
  private current?: {query:WebGLQuery;name:string;started:number};
  private gpuResults=0;
  detailedGpu = false;
  resetMeasurements(){
    this.endGpu();
    for(const {query} of this.queries)this.gl.deleteQuery(query);
    this.queries=[];this.samples.clear();this.intervals=[];this.intervalSlot=0;this.previous=undefined;
    this.outside.clear();this.slow=[];this.gpuResults=0;this.skipInterval=true;
  }
  setDetailedGpu(enabled:boolean){
    this.detailedGpu=enabled;
    this.gpuResults=0;
    this.browser.setEnabled(enabled);
    this.glActivity.setEnabled(enabled);
    for(const name of this.samples.keys())if(name.startsWith('GPU'))this.samples.delete(name);
    for(const {query} of this.queries)this.gl.deleteQuery(query);this.queries=[];
  }
  private samplingFrame = false;
  private frames = 0;
  private intervals: number[] = [];
  private intervalSlot = 0;
  constructor(private renderer: WebGLRenderer) {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.glActivity=new GlActivity(this.gl);
    this.timer = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if(typeof document!=='undefined')document.addEventListener('visibilitychange',this.visibility);
  }
  record(name: string, ms: number) {
    if(!Number.isFinite(ms)||ms<0)return;
    const now = performance.now(), previous = this.samples.get(name);
    const recent=previous?.recent??[],slot=previous?.slot??0;recent[slot]=ms;
    this.samples.set(name, { average: previous ? previous.average + (ms - previous.average) * 0.08 : ms,
      peak: previous && now - previous.since < 2000 ? Math.max(previous.peak, ms) : ms,
      since: previous && now - previous.since < 2000 ? previous.since : now, last:now,
      maximum:Math.max(previous?.maximum??0,ms),count:(previous?.count??0)+1,total:(previous?.total??0)+ms,recent,slot:(slot+1)%180 });
  }
  summary(){return Object.fromEntries([...this.samples].map(([name,s])=>[name,{samples:s.count,mean_ms:s.total/s.count,max_ms:s.maximum,
    recent_p95_ms:[...s.recent].sort((a,b)=>a-b)[Math.max(0,Math.ceil(s.recent.length*.95)-1)]}]));}
  beginFrame(raf:number){
    const now=performance.now(),previous=this.previous;
    if(previous){
      const between=Math.max(0,now-previous.end);this.record('Between render callbacks (wall)',between);
      if(this.detailedGpu&&Math.max(raf-previous.raf,now-previous.start)>=32&&!(typeof document!=='undefined'&&document.hidden)){
        this.slow.push({at:now,interval:now-previous.start,rafInterval:raf-previous.raf,callback:previous.end-previous.start,between,outside:new Map(this.outside),sections:previous.sections});
        this.slow=this.slow.filter(s=>now-s.at<120000).sort((a,b)=>b.interval-a.interval).slice(0,12);
      }
    }
    this.record('RAF scheduling delay (wall)',Math.max(0,now-raf));
    this.outside.clear();this.frameStart=now;this.frameRaf=raf;this.measured=0;this.sections=new Map();
  }
  endFrame(){
    if(this.frameStart===undefined)return;
    const end=performance.now(),duration=end-this.frameStart;
    this.record('Render callback CPU',duration);this.record('Uninstrumented callback CPU',Math.max(0,duration-this.measured));
    this.previous=typeof document!=='undefined'&&document.hidden?undefined:{start:this.frameStart,end,raf:this.frameRaf,sections:this.sections};this.frameStart=undefined;
  }
  recordFrame(ms: number) {
    if(this.skipInterval){this.skipInterval=false;return;}
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.intervals[this.intervalSlot] = ms;
    this.intervalSlot = (this.intervalSlot + 1) % 180;
  }
  measure<T>(name: string, work: () => T): T {
    const start = performance.now();this.depth++;
    try { return work(); } finally {
      const ms=performance.now()-start;this.depth--;this.record(name,ms);
      if(this.depth===0){
        if(this.frameStart!==undefined)this.measured+=ms;
        if(this.detailedGpu){const rows=this.frameStart===undefined?this.outside:this.sections;rows.set(name,(rows.get(name)??0)+ms);}
      }
    }
  }
  beginGpu() {
    const { gl, timer } = this;
    if (!timer) return;
    this.samplingFrame = ++this.frames % 17 === 0;
    if (!this.samplingFrame) return;
    const disjoint = gl.getParameter(timer.GPU_DISJOINT_EXT);
    if(disjoint){
      this.disjointCount++;
      for(const {query} of this.queries)gl.deleteQuery(query);
      this.queries=[];this.samplingFrame=false;return;
    }
    this.queries = this.queries.filter(({query,name}) => {
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) return true;
      if (!disjoint) {this.record(name, gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);this.gpuResults++;}
      gl.deleteQuery(query); return false;
    });
    // Alternate full-frame and pass samples: WebGL forbids nested timer queries.
    if (!this.detailedGpu || this.frames%34===0) this.startGpuSection(this.detailedGpu?'GPU total':'GPU');
  }
  startGpuSection(name: string): WebGLQuery | undefined {
    if (!this.timer || !this.samplingFrame || this.current || this.queries.length>=32) return;
    const query=this.gl.createQuery();
    if(query){this.gl.beginQuery(this.timer.TIME_ELAPSED_EXT,query);this.current={query,name,started:performance.now()};return query;}
  }
  finishGpuSection(query: WebGLQuery | undefined,keep=true) {
    if(query && this.current?.query===query){
      if(keep)this.endGpu();
      else {this.gl.endQuery(this.timer!.TIME_ELAPSED_EXT);this.gl.deleteQuery(query);this.current=undefined;}
    }
  }
  gpuSection<T>(name: string, work:()=>T): T {
    const query=this.detailedGpu?this.startGpuSection(name):undefined;
    try{return work();}finally{this.finishGpuSection(query);}
  }
  endGpu() {
    if (!this.current || !this.timer) return;
    this.gl.endQuery(this.timer.TIME_ELAPSED_EXT);
    this.queries.push(this.current); this.current = undefined;
  }
  lines() {
    const rows = [...this.samples].map(([name, s]) => `${name}: ${s.average.toFixed(1)} ms (peak ${s.peak.toFixed(1)})`
      +(this.detailedGpu?` · p95 ${[...s.recent].sort((a,b)=>a-b)[Math.ceil(s.recent.length*.95)-1].toFixed(1)} · max session ${s.maximum.toFixed(1)} · samples ${s.count}`:'')
      +(performance.now()-s.last>1000?` · last sample ${((performance.now()-s.last)/1000).toFixed(1)}s ago`:''));
    if (this.intervals.length) {
      const sorted = [...this.intervals].sort((a, b) => a - b);
      const percentile = (p: number) => sorted[Math.ceil(sorted.length * p) - 1].toFixed(1);
      rows.unshift(`Frame interval: median ${percentile(0.5)} · p95 ${percentile(0.95)} · max ${percentile(1)} ms`,
        `Frames over 50 ms: ${sorted.filter(ms => ms > 50).length}/${sorted.length}`);
    }
    if (!this.timer) rows.push('GPU timer unavailable');
    if(this.detailedGpu){
      rows.push(...this.hardwareLines(),`GPU timing: sample every 17 frames · pending queries ${this.queries.length} · disjoint resets ${this.disjointCount} · results are asynchronous`,
        `GPU query health: ${this.gpuResults} results resolved · oldest pending ${this.queries.length?((performance.now()-Math.min(...this.queries.map(q=>q.started)))/1000).toFixed(1)+'s':'none'} · active ${this.current?.name??'none'}`,
        'Slow frame intervals (worst 12 / 120s; previous callback + between-callback wall gap; GPU samples are not frame-matched):');
      const parts=(entries:Map<string,number>)=>[...entries].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([n,v])=>`${n} ${v.toFixed(1)}`).join('; ')||'none';
      for(const s of this.slow.filter(s=>performance.now()-s.at<120000))rows.push(
        `${((performance.now()-s.at)/1000).toFixed(1)}s ago · interval ${s.interval.toFixed(1)} ms · previous callback ${s.callback.toFixed(1)} · gap ${s.between.toFixed(1)} · RAF timestamp delta ${s.rafInterval.toFixed(1)} · callback sections: ${parts(s.sections)} · between callbacks measured CPU: ${parts(s.outside)}`);
      rows.push(...this.browser.lines(),'Wall gaps include idle/vsync, browser work and scheduling; async Java wall timings and nested CPU sections must not be summed.');
      rows.push(...this.glActivity.lines());
    }
    const { render, memory } = this.renderer.info;
    rows.push(`Draw calls ${render.calls} · triangles ${render.triangles.toLocaleString('en-US')}`,
      `GPU resources: geometries ${memory.geometries} · textures ${memory.textures}`);
    return rows;
  }
  private hardwareLines(){
    if(this.hardware)return this.hardware;
    const gl=this.gl;
    try{
      const ext=gl.getExtension('WEBGL_debug_renderer_info') as {UNMASKED_VENDOR_WEBGL:number;UNMASKED_RENDERER_WEBGL:number}|null;
      const attrs=gl.getContextAttributes();
      this.hardware=[`GPU vendor: ${gl.getParameter(ext?.UNMASKED_VENDOR_WEBGL??gl.VENDOR)}`,
        `GPU renderer: ${gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}`,
        `GL: ${gl.getParameter(gl.VERSION)} · GLSL: ${gl.getParameter(gl.SHADING_LANGUAGE_VERSION)}`,
        `Context: ${JSON.stringify(attrs)} · max texture ${gl.getParameter(gl.MAX_TEXTURE_SIZE)} · max cube ${gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE)} · max MSAA ${gl.getParameter(gl.MAX_SAMPLES)}`];
    }catch{this.hardware=['GPU hardware details unavailable'];}
    return this.hardware;
  }
  dispose() {
    if(typeof document!=='undefined')document.removeEventListener('visibilitychange',this.visibility);
    this.browser.dispose();
    this.glActivity.dispose();
    this.endGpu();
    for (const {query} of this.queries) this.gl.deleteQuery(query);
    this.queries = [];
  }
}
