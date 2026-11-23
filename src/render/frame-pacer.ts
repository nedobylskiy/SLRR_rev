/**
 * Even frame cadence. A fixed-refresh display shows a frame only on a vsync, so a game running at 35-50 fps on
 * a 60 Hz screen shows frames 16.7 and 33.3 ms apart in an irregular mix: every frame's pose is computed for
 * its start time, but the time until it is seen varies by a whole refresh, and motion stutters by that much
 * however accurate the simulation is. Rendering on every n-th vsync with n fixed keeps the cadence even.
 *
 * - `auto`: n = 1 while frames fit one refresh; when they keep missing, the smallest n that fits (never below
 *   30 fps). It steps back only after a long clean run, with growing patience after each failed attempt.
 * - `vsync`: every refresh the browser offers (previous behaviour).
 * - `fps:N`: a fixed cadence of the even level nearest N on the current screen (see `pacingLevels`).
 *
 * The browser calls animation frames once per display refresh, so the available even levels are the refresh
 * rate divided by whole numbers: 60/30/20 on a 60 Hz screen, 144/72/48/36 on a 144 Hz one.
 */
const MISS_WINDOW=20,MISSES_TO_SLOW=3,MAX_PERIOD_MS=35,BASE_PATIENCE=90,MAX_PATIENCE=900;
export type FramePacing='auto'|'vsync'|`fps:${number}`;

/** Even fixed cadences below the refresh rate on a screen refreshing every `refreshMs`, fastest first. */
export function pacingLevels(refreshMs:number,minimumFps=15,count=5){
  const levels:{divisor:number;fps:number}[]=[];
  for(let divisor=2;levels.length<count;divisor++){const fps=1000/(divisor*refreshMs);if(fps<minimumFps-.5)break;levels.push({divisor,fps});}
  return levels;
}
/** Cadences auto mode may choose: every refresh, then slower even levels down to about 30 fps. */
export function autoPacingLevels(refreshMs:number){
  const levels:number[]=[];for(let divisor=1;divisor===1||divisor*refreshMs<=MAX_PERIOD_MS;divisor++)levels.push(1000/(divisor*refreshMs));return levels;
}
/** Saved settings from before per-screen levels used plain '30'. */
export function parseFramePacing(value:string|null|undefined):FramePacing|undefined{
  if(value==='auto'||value==='vsync')return value;
  if(value==='30')return 'fps:30';
  const match=/^fps:(\d+(?:\.\d+)?)$/.exec(value??'');return match&&Number(match[1])>0?`fps:${Number(match[1])}`:undefined;
}


export class FramePacer {
  mode:FramePacing='auto';
  /** Refreshes per rendered frame in auto mode. */
  private divisor=1;
  private refreshMs=1000/60;
  /** Gaps that follow a skipped refresh: a skipped callback returns at once, so the next arrives on the next vsync. */
  private skipGaps:number[]=[];
  private intervals:number[]=[];
  private skippedLast=false;
  private skipGapsAt=-Infinity;
  private previousCallback?:number;
  private lastRendered?:number;
  private recent:boolean[]=[];
  private clean=0;
  private patience=BASE_PATIENCE;
  private sinceFaster=Infinity;
  /** Main-thread work of recent rendered frames. */
  private works:number[]=[];
  get refreshInterval(){return this.refreshMs;}
  /** Rendered frames per refresh currently targeted. */
  get period(){
    if(this.mode==='vsync')return 1;
    if(this.mode==='auto')return this.divisor;
    return Math.max(1,Math.round(1000/Number(this.mode.slice(4))/this.refreshMs));
  }
  /** Measured display refresh, in Hz. */
  get refreshRate(){return 1000/this.refreshMs;}
  get info(){return `Frame pacing: ${this.mode} · ${(1000/(this.period*this.refreshMs)).toFixed(0)} fps cadence · refresh ${(1000/this.refreshMs).toFixed(0)} Hz`;}
  setMode(mode:FramePacing){this.mode=mode;this.divisor=1;this.recent=[];this.clean=0;this.patience=BASE_PATIENCE;this.sinceFaster=Infinity;}
  /** Call once per animation callback with its timestamp; false means skip this refresh entirely. */
  shouldRender(now:number){
    if(this.previousCallback!==undefined){
      const interval=now-this.previousCallback;
      if(interval>2&&interval<100){
        const list=this.skippedLast?this.skipGaps:this.intervals;list.push(interval);if(list.length>60)list.shift();
        if(this.skippedLast)this.skipGapsAt=now;
        this.refreshMs=this.estimateRefresh(now);
      }
    }
    this.previousCallback=now;this.skippedLast=false;
    if(this.lastRendered===undefined||now<this.lastRendered){this.lastRendered=now;return true;}
    const period=this.period*this.refreshMs,elapsed=now-this.lastRendered;
    if(elapsed<period-this.refreshMs/2){this.skippedLast=true;return false;}
    if(this.mode==='auto')this.observe(elapsed>period+this.refreshMs/2);
    this.lastRendered=now;
    return true;
  }
  /**
   * Medians, never minima: under load Chrome stamps a late callback with its actual start and the next one on
   * the vsync, so single gaps far shorter than the refresh appear. Without skips, every gap may span two
   * refreshes when frames miss, so only a clear majority of short gaps can claim a faster than 60 Hz screen.
   */
  private estimateRefresh(now:number){
    const median=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[sorted.length>>1];};
    // Skip gaps go stale when skipping stops (every-refresh mode), e.g. after the window moves to another screen.
    const freshSkips=this.skipGaps.length>=5&&now-this.skipGapsAt<5000;
    const estimate=freshSkips?median(this.skipGaps):this.intervals.length>=30?median(this.intervals.slice(-30)):this.skipGaps.length>=5?median(this.skipGaps):1000/60;
    return Math.min(1000/60,Math.max(4,estimate));
  }
  /** Main-thread milliseconds the rendered frame took, from the start of its callback (not the vsync stamp). */
  recordWork(ms:number){this.works.push(ms);if(this.works.length>60)this.works.shift();}
  /**
   * Speeding up is a trial, not a prediction: frame work alone misses GPU and compositor time, so a faster
   * cadence is simply tried once typical work leaves room, and abandoned if frames start missing again.
   */
  private observe(missed:boolean){
    this.recent.push(missed);if(this.recent.length>MISS_WINDOW)this.recent.shift();
    this.sinceFaster++;
    const misses=this.recent.reduce((n,miss)=>n+Number(miss),0);
    if(misses>=MISSES_TO_SLOW&&(this.divisor+1)*this.refreshMs<=MAX_PERIOD_MS){
      // A failed trial waits longer before the next; a cadence that held for a while resets the wait.
      this.patience=this.sinceFaster<BASE_PATIENCE*2?Math.min(MAX_PATIENCE,this.patience*2):BASE_PATIENCE;
      this.divisor++;this.recent=[];this.clean=0;return;
    }
    if(missed){this.clean=0;return;}
    if(this.divisor<=1||++this.clean<this.patience)return;
    // Nearly every frame must fit, not the typical one: a scene where every third frame misses is exactly
    // the uneven 17/33 ms mix this avoids.
    const sorted=[...this.works].sort((a,b)=>a-b),heavy=sorted[Math.floor(sorted.length*.9)]??Infinity;
    if(heavy>(this.divisor-1)*this.refreshMs*.95)return;
    this.divisor--;this.recent=[];this.clean=0;this.sinceFaster=0;
  }
}
