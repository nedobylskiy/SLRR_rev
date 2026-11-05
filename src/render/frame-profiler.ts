import type { WebGLRenderer } from 'three';

/** CPU measurements are submission time; GPU queries complete asynchronously. */
export class FrameProfiler {
  private samples = new Map<string, { average: number; peak: number; since: number; last:number }>();
  private readonly gl: WebGL2RenderingContext;
  private readonly timer: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private queries: {query:WebGLQuery;name:string}[] = [];
  private current?: {query:WebGLQuery;name:string};
  detailedGpu = false;
  setDetailedGpu(enabled:boolean){
    this.detailedGpu=enabled;
    for(const name of this.samples.keys())if(name.startsWith('GPU'))this.samples.delete(name);
    for(const {query} of this.queries)this.gl.deleteQuery(query);this.queries=[];
  }
  private samplingFrame = false;
  private frames = 0;
  private intervals: number[] = [];
  private intervalSlot = 0;
  constructor(private renderer: WebGLRenderer) {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.timer = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }
  record(name: string, ms: number) {
    const now = performance.now(), previous = this.samples.get(name);
    this.samples.set(name, { average: previous ? previous.average + (ms - previous.average) * 0.08 : ms,
      peak: previous && now - previous.since < 2000 ? Math.max(previous.peak, ms) : ms,
      since: previous && now - previous.since < 2000 ? previous.since : now, last:now });
  }
  recordFrame(ms: number) {
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.intervals[this.intervalSlot] = ms;
    this.intervalSlot = (this.intervalSlot + 1) % 180;
  }
  measure<T>(name: string, work: () => T): T {
    const start = performance.now();
    try { return work(); } finally { this.record(name, performance.now() - start); }
  }
  beginGpu() {
    const { gl, timer } = this;
    if (!timer) return;
    this.samplingFrame = ++this.frames % 17 === 0;
    if (!this.samplingFrame) return;
    const disjoint = gl.getParameter(timer.GPU_DISJOINT_EXT);
    if(disjoint){
      for(const {query} of this.queries)gl.deleteQuery(query);
      this.queries=[];this.samplingFrame=false;return;
    }
    this.queries = this.queries.filter(({query,name}) => {
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) return true;
      if (!disjoint) this.record(name, gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(query); return false;
    });
    // Alternate full-frame and pass samples: WebGL forbids nested timer queries.
    if (!this.detailedGpu || this.frames%34===0) this.startGpuSection(this.detailedGpu?'GPU total':'GPU');
  }
  startGpuSection(name: string): WebGLQuery | undefined {
    if (!this.timer || !this.samplingFrame || this.current || this.queries.length>=32) return;
    const query=this.gl.createQuery();
    if(query){this.gl.beginQuery(this.timer.TIME_ELAPSED_EXT,query);this.current={query,name};return query;}
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
      +(name.startsWith('GPU')&&performance.now()-s.last>1000?` · last sample ${((performance.now()-s.last)/1000).toFixed(1)}s ago`:''));
    if (this.intervals.length) {
      const sorted = [...this.intervals].sort((a, b) => a - b);
      const percentile = (p: number) => sorted[Math.ceil(sorted.length * p) - 1].toFixed(1);
      rows.unshift(`Frame interval: median ${percentile(0.5)} · p95 ${percentile(0.95)} · max ${percentile(1)} ms`,
        `Frames over 50 ms: ${sorted.filter(ms => ms > 50).length}/${sorted.length}`);
    }
    if (!this.timer) rows.push('GPU timer unavailable');
    const { render, memory } = this.renderer.info;
    rows.push(`Draw calls ${render.calls} · triangles ${render.triangles.toLocaleString('en-US')}`,
      `GPU resources: geometries ${memory.geometries} · textures ${memory.textures}`);
    return rows;
  }
  dispose() {
    this.endGpu();
    for (const {query} of this.queries) this.gl.deleteQuery(query);
    this.queries = [];
  }
}
