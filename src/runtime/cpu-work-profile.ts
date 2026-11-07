/** Opt-in CPU work accounting. Async work is attributed to the next drain, never to I/O wait. */
export class CpuWorkProfile {
  enabled=false;
  private values:Record<string,number>={};
  start(){return this.enabled?performance.now():-1;}
  end(name:string,start:number){if(start>=0&&this.enabled)this.add(name,performance.now()-start);}
  add(name:string,value=1){if(this.enabled)this.values[name]=(this.values[name]??0)+value;}
  measure<T>(name:string,work:()=>T):T{if(!this.enabled)return work();const start=this.start();try{return work();}finally{this.end(name,start);}}
  setEnabled(enabled:boolean){if(enabled!==this.enabled)this.values={};this.enabled=enabled;}
  drain(){const values=this.values;this.values={};return values;}
}
