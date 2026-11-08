import { Vector3, Quaternion, type Camera } from 'three';
import type { Assets } from '../assets';
import { gameSoundVolume } from './audio-settings';

export interface TrafficVoice { update(position:Vector3,rpm:number,throttle:number):void; dispose():void }
/** One context and decoded sample cache for traffic; quiet low-pass engine only, no tyre effects. */
export class TrafficAudio {
  private context=new AudioContext({latencyHint:'interactive'});
  private buffers=new WeakMap<Assets,Promise<AudioBuffer>>();
  private disposed=false;
  private hidden=false;
  setHidden(hidden:boolean){if(this.hidden===hidden||this.disposed)return;this.hidden=hidden;if(hidden)void this.context.suspend().catch(()=>{});else this.activate();}
  activate(){if(!this.disposed)void this.context.resume().catch(()=>{});}
  async voice(assets:Assets):Promise<TrafficVoice>{
    let pending=this.buffers.get(assets);
    if(!pending){pending=assets.read('sound/wav/engine/idle.wav').then(bytes=>this.context.decodeAudioData(bytes.slice().buffer));this.buffers.set(assets,pending);pending.catch(()=>this.buffers.delete(assets));}
    const buffer=await pending;
    if(this.disposed)throw Error('Traffic audio disposed');
    const source=this.context.createBufferSource(),filter=this.context.createBiquadFilter(),gain=this.context.createGain(),pan=this.context.createPanner();
    source.buffer=buffer;source.loop=true;filter.type='lowpass';filter.frequency.value=850;filter.Q.value=.5;gain.gain.value=0;
    pan.panningModel='HRTF';pan.distanceModel='inverse';pan.refDistance=4;pan.maxDistance=100;pan.rolloffFactor=1.2;
    source.connect(filter).connect(gain).connect(pan).connect(this.context.destination);source.start();
    return {update:(position,rpm,throttle)=>{
      const time=this.context.currentTime;
      source.playbackRate.setTargetAtTime(Math.max(.65,Math.min(3.5,rpm/1100)),time,.1);
      gain.gain.setTargetAtTime(gameSoundVolume*(.08+.06*Math.abs(throttle)),time,.1);
      pan.positionX.value=position.x;pan.positionY.value=position.y;pan.positionZ.value=position.z;
    },dispose:()=>{source.stop();source.disconnect();filter.disconnect();gain.disconnect();pan.disconnect();}};
  }
  listener(camera:Camera){
    const position=camera.getWorldPosition(new Vector3()),rotation=camera.getWorldQuaternion(new Quaternion()),forward=new Vector3(0,0,-1).applyQuaternion(rotation),up=new Vector3(0,1,0).applyQuaternion(rotation),listener=this.context.listener;
    listener.positionX.value=position.x;listener.positionY.value=position.y;listener.positionZ.value=position.z;
    listener.forwardX.value=forward.x;listener.forwardY.value=forward.y;listener.forwardZ.value=forward.z;listener.upX.value=up.x;listener.upY.value=up.y;listener.upZ.value=up.z;
  }
  dispose(){this.disposed=true;void this.context.close().catch(()=>{});}
}
