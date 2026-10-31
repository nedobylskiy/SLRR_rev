import type { WebGLRenderer } from 'three';

/** CPU measurements are submission time; GPU queries complete asynchronously. */
export class FrameProfiler {
  private samples = new Map<string, { average: number; peak: number; since: number }>();
  private readonly gl: WebGL2RenderingContext;
  private readonly timer: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private queries: WebGLQuery[] = [];
  private current?: WebGLQuery;
  private frames = 0;
  constructor(private renderer: WebGLRenderer) {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.timer = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }
  record(name: string, ms: number) {
    const now = performance.now(), previous = this.samples.get(name);
    this.samples.set(name, { average: previous ? previous.average + (ms - previous.average) * 0.08 : ms,
      peak: previous && now - previous.since < 2000 ? Math.max(previous.peak, ms) : ms,
      since: previous && now - previous.since < 2000 ? previous.since : now });
  }
  measure<T>(name: string, work: () => T): T {
    const start = performance.now();
    try { return work(); } finally { this.record(name, performance.now() - start); }
  }
  beginGpu() {
    const { gl, timer } = this;
    if (!timer) return;
    const disjoint = gl.getParameter(timer.GPU_DISJOINT_EXT);
    this.queries = this.queries.filter(query => {
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) return true;
      if (!disjoint) this.record('GPU', gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(query); return false;
    });
    if (++this.frames % 15 || this.queries.length >= 4 || disjoint) return;
    const query = gl.createQuery();
    if (query) { gl.beginQuery(timer.TIME_ELAPSED_EXT, query); this.current = query; }
  }
  endGpu() {
    if (!this.current || !this.timer) return;
    this.gl.endQuery(this.timer.TIME_ELAPSED_EXT);
    this.queries.push(this.current); this.current = undefined;
  }
  lines() {
    const rows = [...this.samples].map(([name, s]) => `${name}: ${s.average.toFixed(1)} ms (peak ${s.peak.toFixed(1)})`);
    if (!this.timer) rows.push('GPU timer unavailable');
    const { render, memory } = this.renderer.info;
    rows.push(`Draw calls ${render.calls} · triangles ${render.triangles.toLocaleString('en-US')}`,
      `GPU resources: geometries ${memory.geometries} · textures ${memory.textures}`);
    return rows;
  }
  dispose() {
    for (const query of this.queries) this.gl.deleteQuery(query);
    this.queries = [];
  }
}
