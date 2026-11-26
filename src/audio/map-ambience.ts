import {Vector3} from 'three';
import type {PartConfig} from '../formats/cfg';

export interface AmbientCue {id:number;radius:number;from:number;to:number;min:number;max:number}
export interface AmbientConfig {loop?:AmbientCue;randoms:AmbientCue[]}
export function parseMapAmbience(cfg:Pick<PartConfig,'unknown'>):AmbientConfig {
  const out:AmbientConfig={randoms:[]};
  for(const line of cfg.unknown){const kind=line.command.toLowerCase();if(kind!=='sfx_loop'&&kind!=='sfx_random')continue;
    const values=line.args.map(v=>Number(v.replace(/r$/i,''))),id=values[0];if(!Number.isSafeInteger(id)||id<=0||id>0xffffffff||values.some(v=>!Number.isFinite(v)))continue;
    const random=kind==='sfx_random',cue:AmbientCue={id,radius:Math.max(0,values[1]??0),min:Math.max(0,random?values[2]??1:1),max:Math.max(0,random?values[3]??1:1),from:Math.trunc((values[random?4:2]??0)*3600),to:Math.trunc((values[random?5:3]??24)*3600)};
    if(random){if(out.randoms.length<16)out.randoms.push(cue);}else out.loop=cue;
  }return out;
}
export function ambientInWindow(cue:Pick<AmbientCue,'from'|'to'>,seconds:number){const now=((Math.trunc(seconds)%86400)+86400)%86400;return cue.from<cue.to?now>=cue.from&&now<cue.to:now>=cue.from||now<cue.to;}
export const ambientAudible=(distanceSquared:number,radius:number)=>distanceSquared-radius*radius<=250*250;
export interface AmbientVoice {stop():void;ended():boolean}
export interface AmbientOutput {play(pack:string,id:number,position:Vector3,loop:boolean):Promise<AmbientVoice|undefined>;unavailable?(pack:string,id:number):boolean;pause(value:boolean):void;dispose():void}
interface Emitter {pack:string;position:Vector3;config:AmbientConfig;next:number;loopRetry:number;choice:number;voice?:AmbientVoice;pending:boolean;revision:number}

/** Spatially indexed, 4 Hz scheduling. No per-frame walk over all city emitters. */
export class MapAmbience {
  private cells=new Map<string,Emitter[]>();private nearby:Emitter[]=[];private loops=new Set<Emitter>();
  private transients=new Set<AmbientVoice>();private pending=0;private clock=0;private nextScan=0;private nextTick=0;private last?:number;
  private previous=new Vector3(Infinity,Infinity,Infinity);private maxRadius=0;private disposed=false;
  private repeats=new Map<string,{time:number;voices:AmbientVoice[]}>();
  readonly stats={emitters:0,nearby:0,voices:0,pending:0};
  constructor(private output:AmbientOutput,private random=Math.random){}
  add(pack:string,position:Vector3,config:AmbientConfig){
    if(!config.loop&&!config.randoms.length)return;
    const first=config.randoms[0],emitter:Emitter={pack,position:position.clone(),config,next:this.clock+(first?this.delay(first):0),loopRetry:0,choice:this.pick(config.randoms.length),pending:false,revision:0};
    const key=`${Math.floor(position.x/64)},${Math.floor(position.z/64)}`,cell=this.cells.get(key)??[];cell.push(emitter);this.cells.set(key,cell);
    this.maxRadius=Math.max(this.maxRadius,...[config.loop,...config.randoms].filter((c):c is AmbientCue=>!!c).map(c=>c.radius));this.stats.emitters++;
  }
  private delay(c:AmbientCue){return Math.max(.05,c.min+this.random()*(c.max-c.min));}
  private pick(n:number){return Math.min(Math.max(0,n-1),Math.floor(this.random()*n));}
  private stop(e:Emitter){e.revision++;e.voice?.stop();e.voice=undefined;this.loops.delete(e);}
  private start(e:Emitter,cue:AmbientCue,loop:boolean){
    if(this.output.unavailable?.(e.pack,cue.id))return;
    if([...this.loops].filter(e=>!!e.voice&&!e.voice.ended()).length+this.transients.size+this.pending>=32||this.pending>=4)return;
    const key=`${e.pack}:${cue.id}`,repeat=this.repeats.get(key),playing=repeat?.voices.filter(v=>!v.ended())??[];
    if(!loop&&repeat&&(this.clock-repeat.time<.035||playing.length>=2))return;
    if(!loop)this.repeats.set(key,{time:this.clock,voices:playing});
    const revision=e.revision;if(loop){e.pending=true;e.loopRetry=this.clock+1;}this.pending++;
    if(loop)this.loops.add(e);
    void this.output.play(e.pack,cue.id,e.position,loop).then(voice=>{
      if(!voice)return;
      if(this.disposed||loop&&revision!==e.revision){voice.stop();return;}
      if(loop)e.voice=voice;else{this.transients.add(voice);this.repeats.get(key)?.voices.push(voice);}
    }).catch(()=>{}).finally(()=>{this.pending--;if(loop){e.pending=false;if(!e.voice)this.loops.delete(e);}});
  }
  update(now:number,listener:Vector3,seconds:number,timeScale=1){
    if(this.disposed)return;const paused=timeScale<=0;this.output.pause(paused);
    const dt=this.last===undefined?0:Math.max(0,Math.min(1,(now-this.last)/1000));this.last=now;if(paused)return;
    this.clock+=dt*timeScale;for(const voice of this.transients)if(voice.ended())this.transients.delete(voice);
    if(this.clock>=this.nextScan||listener.distanceToSquared(this.previous)>16){
      this.nextScan=this.clock+.25;this.previous.copy(listener);const range=Math.hypot(250,this.maxRadius),next:Emitter[]=[];
      for(let x=Math.floor((listener.x-range)/64);x<=Math.floor((listener.x+range)/64);x++)for(let z=Math.floor((listener.z-range)/64);z<=Math.floor((listener.z+range)/64);z++)for(const e of this.cells.get(`${x},${z}`)??[]){
        const d=e.position.distanceToSquared(listener);if(ambientAudible(d,Math.max(e.config.loop?.radius??0,...e.config.randoms.map(c=>c.radius))))next.push(e);
      }
      this.nearby=next.sort((a,b)=>a.position.distanceToSquared(listener)-b.position.distanceToSquared(listener));
      const wanted=new Set(next);for(const e of this.loops)if(!wanted.has(e))this.stop(e);
    }
    // Timers, audibility and hour windows are checked at the same bounded cadence.
    if(this.clock<this.nextTick)return;
    this.nextTick=this.clock+.25;
    for(const e of this.nearby){const distance=e.position.distanceToSquared(listener),loop=e.config.loop;
      if(loop){const wanted=ambientInWindow(loop,seconds)&&ambientAudible(distance,loop.radius);
        if(!wanted){if(e.voice||e.pending)this.stop(e);}else if(!e.pending&&(!e.voice||e.voice.ended())&&this.clock>=e.loopRetry)this.start(e,loop,true);
      }
      if(e.config.randoms.length&&this.clock>=e.next){const cue=e.config.randoms[e.choice];e.choice=this.pick(e.config.randoms.length);e.next=this.clock+(ambientInWindow(cue,seconds)?this.delay(cue):30+this.random()*60);
        if(ambientInWindow(cue,seconds)&&ambientAudible(distance,cue.radius))this.start(e,cue,false);
      }
    }
    this.stats.nearby=this.nearby.length;this.stats.voices=[...this.loops].filter(e=>e.voice&&!e.voice.ended()).length+this.transients.size;this.stats.pending=this.pending;
  }
  dispose(){this.disposed=true;for(const e of this.loops)this.stop(e);for(const v of this.transients)v.stop();this.transients.clear();this.cells.clear();this.output.dispose();}
}
