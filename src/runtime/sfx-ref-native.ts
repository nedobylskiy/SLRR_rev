import { jv, type JavaObject, type JavaValue, type SlrrJvm } from 'slrr-jvm';
import { entryProperties } from '../formats/rpk';
import type { Assets } from '../assets';
import type { GameTypeNative } from './game-type-native';
import { gameSoundVolume } from '../audio/audio-settings';

interface Voice { stopped: boolean; source?: AudioBufferSourceNode; loopKey?:string }

/** Plays the original RPK sound resources requested by Java SfxRef. */
export class SfxRefNative {
  private context?: AudioContext;
  private readonly buffers = new Map<string, Promise<AudioBuffer>>();
  private readonly voices = new Map<number, Voice>();
  private readonly ownedLoops = new Map<string,number>();
  private nextVoice = 1;

  constructor(jvm: SlrrJvm, private readonly assets: Assets, private readonly resources: GameTypeNative,
    private readonly effectsVolume: () => number = () => 1,
    private readonly report: (error: Error) => void = () => {}) {
    const owner = 'java.util.resource.SfxRef';
    jvm.natives.register(owner, 'nplay', ['Vector3', 'float', 'float', 'float', 'int', 'int'], ({ receiver, args }) => {
      const resource = this.resources.getResource(receiver),emitter=Number(args[5].value);
      // Painter refreshes the same cursor-owned loop from control(). Reuse its
      // handle so stop(spraySfxID) stops the one loop rather than leaving copies.
      const loopKey=(Number(args[4].value)&1)&&emitter&&resource
        ?`${resource.resourcePack}:${resource.resourceId}:${emitter}`:undefined;
      const existing=loopKey&&this.ownedLoops.get(loopKey);
      if(existing&&this.voices.has(existing))return jv('int',existing);
      const id = this.nextVoice++;
      const voice: Voice = { stopped: false,loopKey };
      this.voices.set(id, voice);
      if(loopKey)this.ownedLoops.set(loopKey,id);
      if (resource?.resourceId && typeof AudioContext !== 'undefined') {
        this.context ??= new AudioContext({ latencyHint: 'interactive' });
        void this.context.resume().catch(() => {});
        void this.play(id, voice, resource.resourcePack ?? 'frontend.rpk', resource.resourceId & 0xffff, args)
          .catch(error => {this.release(id,voice);this.report(error instanceof Error ? error : new Error(String(error)));});
      } else this.release(id,voice);
      return jv('int', id);
    });
    jvm.natives.register(owner, 'stop', ['int'], ({ args }) => {
      const id = Number(args[0].value), voice = this.voices.get(id);
      if (voice) {
        voice.stopped = true;
        try { voice.source?.stop(); } catch { /* The voice may already have ended. */ }
        this.release(id,voice);
      }
      return jv('void', undefined);
    });
  }

  private release(id:number,voice:Voice){
    this.voices.delete(id);
    if(voice.loopKey&&this.ownedLoops.get(voice.loopKey)===id)this.ownedLoops.delete(voice.loopKey);
  }

  private async buffer(pack: string, id: number): Promise<AudioBuffer> {
    const { entry } = await this.assets.resource(pack, id);
    const path = entryProperties(entry).find(prop => prop.key === 'sourcefile')?.value;
    if (!path) throw new Error(`SfxRef ${pack}:0x${id.toString(16)} has no audio source`);
    const key = path.replaceAll('\\', '/').toLowerCase();
    let pending = this.buffers.get(key);
    if (!pending) {
      pending = this.assets.read(path).then(bytes => this.context!.decodeAudioData(bytes.slice().buffer));
      this.buffers.set(key, pending);
    }
    return pending;
  }

  private async play(handle: number, voice: Voice, pack: string, id: number, args: readonly JavaValue[]) {
    const context = this.context!, buffer = await this.buffer(pack, id);
    if (voice.stopped) return;
    const source = context.createBufferSource(), gain = context.createGain();
    voice.source = source;
    source.buffer = buffer;
    source.playbackRate.value = Math.max(0.1, Math.min(4, Number(args[2].value) || 1));
    source.loop = (Number(args[4].value) & 1) !== 0;
    gain.gain.value = Math.max(0, Math.min(1, Number(args[3].value) * this.effectsVolume() * gameSoundVolume));
    source.connect(gain);
    const position = args[0].value as JavaObject | null;
    if (position?.fields instanceof Map) {
      const panner = context.createPanner(), radius = Math.max(1, Number(args[1].value) || 1);
      panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse';
      panner.refDistance = radius; panner.maxDistance = Math.max(20, radius * 5);
      panner.positionX.value = Number(position.fields.get('x')?.value ?? 0);
      panner.positionY.value = Number(position.fields.get('y')?.value ?? 0);
      panner.positionZ.value = Number(position.fields.get('z')?.value ?? 0);
      gain.connect(panner); panner.connect(context.destination);
      source.onended = () => { this.release(handle,voice); source.disconnect(); gain.disconnect(); panner.disconnect(); };
    } else {
      gain.connect(context.destination);
      source.onended = () => { this.release(handle,voice); source.disconnect(); gain.disconnect(); };
    }
    source.start();
  }

  dispose() {
    for (const voice of this.voices.values()) {
      voice.stopped = true;
      try { voice.source?.stop(); } catch { /* Already stopped. */ }
    }
    this.voices.clear();
    this.ownedLoops.clear();
    void this.context?.close();
  }
}
