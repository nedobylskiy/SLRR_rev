/** CPU time inside infrequent GL resource calls; never adds a readback or GPU wait. */
export class GlActivity {
  private restores:(()=>void)[]=[];
  private totals=new Map<string,{calls:number;ms:number;max:number}>();
  private slow:{at:number;name:string;ms:number}[]=[];
  constructor(private readonly gl:WebGL2RenderingContext){}
  setEnabled(enabled:boolean){
    this.dispose();if(!enabled)return;
    this.totals.clear();this.slow=[];
    const gl=this.gl as unknown as Record<string,((...args:any[])=>any)>;
    for(const name of ['compileShader','linkProgram','getProgramParameter','getShaderParameter','getProgramInfoLog','getShaderInfoLog','texImage2D','texSubImage2D','compressedTexImage2D','compressedTexSubImage2D','texStorage2D','bufferData','bufferSubData','generateMipmap','readPixels','finish','clientWaitSync']){
      const original=gl[name];if(typeof original!=='function')continue;
      const wrapper=(...args:any[])=>{
        const start=performance.now();
        try{return original.apply(this.gl,args);}finally{
          const ms=performance.now()-start,row=this.totals.get(name)??{calls:0,ms:0,max:0};
          row.calls++;row.ms+=ms;row.max=Math.max(row.max,ms);this.totals.set(name,row);
          if(ms>=2){this.slow.push({at:start,name,ms});this.slow=this.slow.slice(-12);}
        }
      };
      gl[name]=wrapper;this.restores.push(()=>{if(gl[name]===wrapper)gl[name]=original;});
    }
  }
  lines(){return ['Observed GL resource calls (CPU submission, overlaps renderer CPU; totals since diagnostics enabled):',
    ...[...this.totals].sort((a,b)=>b[1].ms-a[1].ms).map(([name,t])=>`${name}: ${t.calls} calls · total ${t.ms.toFixed(1)} ms · max ${t.max.toFixed(1)} ms`),
    ...this.slow.filter(s=>performance.now()-s.at<120000).map(s=>`GL slow call ${((performance.now()-s.at)/1000).toFixed(1)}s ago: ${s.name} ${s.ms.toFixed(1)} ms`),
  ];}
  dispose(){for(const restore of this.restores)restore();this.restores=[];}
}
