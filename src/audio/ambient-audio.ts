import {Quaternion,Vector3,type Camera} from 'three';
import type {Assets} from '../assets';
import {entryProperties} from '../formats/rpk';
import {gameSoundVolume} from './audio-settings';
import type {AmbientOutput,AmbientVoice} from './map-ambience';

/** Scan all channels: sparse sounds may have long silent introductions. */
export function ambientSignalPeak(buffer:Pick<AudioBuffer,'numberOfChannels'|'getChannelData'>){
  let peak=0;for(let channel=0;channel<buffer.numberOfChannels;channel++)for(const value of buffer.getChannelData(channel))peak=Math.max(peak,Math.abs(value));return peak;
}

/** Shared Web Audio context for map ambience; buffers load only for nearby cues. */
export class AmbientAudio implements AmbientOutput {
  private context?:AudioContext;private bus?:GainNode;private disposed=false;private paused=false;
  private resources=new Map<string,Promise<{buffer:AudioBuffer;volume:number;min:number;max:number;path:string;silent:boolean}>>();
  private silent=new Set<string>();private unavailableSounds=new Set<string>();private playing=new Map<string,number>();private lastError='';
  constructor(private assets:Assets,private effectsVolume:()=>number=()=>1){}
  unavailable(pack:string,id:number){return this.unavailableSounds.has(`${pack.toLowerCase()}:${id}`);}
  diagnosticLine(){return `Ambient audio: ${this.context?.state??'not activated'} · mix ${(gameSoundVolume*this.effectsVolume()).toFixed(2)} · playing ${[...this.playing].map(([path,count])=>`${path} ×${count}`).join(', ')||'none'} · silent samples ${[...this.silent].join(', ')||'none'}${this.lastError?` · ERROR ${this.lastError}`:''}`;}
  activate(){if(this.disposed||typeof AudioContext==='undefined')return;
    if(!this.context){this.context=new AudioContext({latencyHint:'interactive'});this.bus=this.context.createGain();this.bus.connect(this.context.destination);}
    if(!this.paused)void this.context.resume().catch(()=>{});
  }
  pause(paused:boolean){if(this.paused===paused)return;this.paused=paused;if(paused)void this.context?.suspend().catch(()=>{});else if(this.context)void this.context.resume().catch(()=>{});}
  async play(pack:string,id:number,position:Vector3,loop:boolean):Promise<AmbientVoice|undefined>{
    if(this.disposed||!this.context||this.context.state!=='running')return;
    const context=this.context,key=`${pack.toLowerCase()}:${id}`;let promise=this.resources.get(key);
    if(!promise){promise=(async()=>{
      const {entry}=await this.assets.resource(pack,id),props=entryProperties(entry),get=(key:string)=>props.find(p=>p.key===key)?.value;
      const path=get('sourcefile');if(!path)throw Error(`Ambient sound ${key} has no sourcefile`);
      const number=(key:string,fallback:number)=>{const n=Number(get(key));return get(key)!==undefined&&Number.isFinite(n)&&n>=0?n:fallback;};
      const bytes=await this.assets.read(path),buffer=await context.decodeAudioData(bytes.slice().buffer),min=Math.max(.01,number('mindist',1));
      const silent=ambientSignalPeak(buffer)<1e-7;
      if(silent){this.unavailableSounds.add(key);this.silent.add(path.replaceAll('\\','/').split('/').at(-1)!);}
      return {buffer,volume:Math.min(1,number('volume',1)),min,max:Math.max(min,number('maxdist',1e9)),path,silent};
    })();this.resources.set(key,promise);}
    let sound:Awaited<typeof promise>;
    try{sound=await promise;}catch(error){this.lastError=String(error);throw error;}
    if(this.disposed||sound.silent)return;
    const source=context.createBufferSource(),gain=context.createGain(),pan=context.createPanner();source.buffer=sound.buffer;source.loop=loop;gain.gain.value=sound.volume;
    pan.panningModel='HRTF';pan.distanceModel='inverse';pan.refDistance=sound.min;pan.maxDistance=sound.max;pan.rolloffFactor=1;
    pan.positionX.value=position.x;pan.positionY.value=position.y;pan.positionZ.value=position.z;
    source.connect(gain).connect(pan).connect(this.bus!);let ended=false;
    const name=sound.path.replaceAll('\\','/').split('/').at(-1)!;this.playing.set(name,(this.playing.get(name)??0)+1);
    const disconnect=()=>{if(ended)return;ended=true;const count=(this.playing.get(name)??1)-1;if(count)this.playing.set(name,count);else this.playing.delete(name);source.disconnect();gain.disconnect();pan.disconnect();};source.onended=disconnect;source.start();
    return {stop:()=>{if(!ended){try{source.stop();}finally{disconnect();}}},ended:()=>ended};
  }
  listener(camera:Camera){if(!this.context)return;
    const context=this.context,listener=context.listener,position=camera.getWorldPosition(new Vector3()),q=camera.getWorldQuaternion(new Quaternion()),forward=new Vector3(0,0,-1).applyQuaternion(q),up=new Vector3(0,1,0).applyQuaternion(q);
    listener.positionX.value=position.x;listener.positionY.value=position.y;listener.positionZ.value=position.z;
    listener.forwardX.value=forward.x;listener.forwardY.value=forward.y;listener.forwardZ.value=forward.z;listener.upX.value=up.x;listener.upY.value=up.y;listener.upZ.value=up.z;
    this.bus!.gain.setTargetAtTime(gameSoundVolume*this.effectsVolume(),context.currentTime,.05);
  }
  dispose(){this.disposed=true;this.resources.clear();void this.context?.close().catch(()=>{});}
}
