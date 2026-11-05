/** Browser scheduling evidence; these entries do not measure GPU execution or idle CPU. */
export class BrowserPerformance {
  private observers:PerformanceObserver[]=[];
  private timer?:number;
  private entries:{at:number;text:string}[]=[];
  private supported:readonly string[]=[];
  private maxLag=0;
  setEnabled(enabled:boolean){
    this.dispose();if(!enabled||typeof window==='undefined')return;
    this.supported=typeof PerformanceObserver==='undefined'?[]:PerformanceObserver.supportedEntryTypes;
    for(const type of ['longtask','long-animation-frame']){
      if(!this.supported.includes(type))continue;
      try{
        const observer=new PerformanceObserver(list=>{
          for(const entry of list.getEntries()){
            const e=entry as PerformanceEntry&{blockingDuration?:number;renderStart?:number;styleAndLayoutStart?:number;scripts?:{duration:number;invoker?:string;sourceFunctionName?:string;sourceURL?:string}[]};
            const scripts=e.scripts?.slice().sort((a,b)=>b.duration-a.duration).slice(0,3).map(s=>
              `${s.sourceFunctionName||s.invoker||'script'} ${s.duration.toFixed(1)} ms ${s.sourceURL?.split(/[?#]/)[0]??''}`).join('; ');
            this.entries.push({at:e.startTime,text:`${type}: ${e.duration.toFixed(1)} ms`
              +(e.blockingDuration===undefined?'':` · blocking ${e.blockingDuration.toFixed(1)} ms`)
              +(e.renderStart?` · render phase ${(e.startTime+e.duration-e.renderStart).toFixed(1)} ms`:'')
              +(e.styleAndLayoutStart?` · style/layout start +${(e.styleAndLayoutStart-e.startTime).toFixed(1)} ms`:'')
              +(scripts?` · ${scripts}`:'')});
          }
          this.entries=this.entries.slice(-24);
        });observer.observe({type,buffered:false});this.observers.push(observer);
      }catch{/* Optional browser API. */}
    }
    let due=performance.now()+100;
    this.timer=window.setInterval(()=>{const now=performance.now();if(!document.hidden)this.maxLag=Math.max(this.maxLag,now-due);due=now+100;},100);
  }
  lines(){
    const now=performance.now(),nav=typeof navigator==='undefined'?undefined:navigator as Navigator&{deviceMemory?:number};
    const heap=(performance as Performance&{memory?:{usedJSHeapSize:number;totalJSHeapSize:number;jsHeapSizeLimit:number}}).memory;
    return [
      `Browser: ${nav?.userAgent??'unavailable'}`,
      `Host: logical CPUs ${nav?.hardwareConcurrency??'?'} · device memory hint ${nav?.deviceMemory??'?'} GiB · visibility ${typeof document==='undefined'?'?':document.visibilityState}`,
      ...(typeof document==='undefined'?[]:[`DOM: ${document.getElementsByTagName('*').length} nodes · canvases ${document.getElementsByTagName('canvas').length} (may include 2D/other GL contexts not covered by this GPU timer)`]),
      `JS heap: ${heap?`${(heap.usedJSHeapSize/1048576).toFixed(1)} / ${(heap.totalJSHeapSize/1048576).toFixed(1)} MiB (limit ${(heap.jsHeapSizeLimit/1048576).toFixed(0)} MiB)`:'unavailable'}`,
      `Browser observers: longtask ${this.supported.includes('longtask')?'supported':'unavailable'} · long-animation-frame ${this.supported.includes('long-animation-frame')?'supported':'unavailable'} · max visible-page timer delay ${this.maxLag.toFixed(1)} ms`,
      'Recent browser stalls (observers overlap; do not add their durations):',
      ...this.entries.filter(e=>now-e.at<120000).slice(-12).map(e=>`${((now-e.at)/1000).toFixed(1)}s ago · ${e.text}`),
    ];
  }
  dispose(){for(const o of this.observers)o.disconnect();this.observers=[];if(this.timer!==undefined&&typeof window!=='undefined')window.clearInterval(this.timer);this.timer=undefined;}
}
