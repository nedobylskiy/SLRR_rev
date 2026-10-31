import { jv, type JavaObject, type JavaValue, type SlrrJvm } from 'slrr-jvm';
import { entryProperties } from '../formats/rpk';
import type { Assets } from '../assets';
import type { GameTypeNative } from './game-type-native';
import { gameSoundVolume } from '../audio/audio-settings';

interface Voice { stopped: boolean; source?: AudioBufferSourceNode }

/** Plays the original RPK sound resources requested by Java SfxRef. */
export class SfxRefNative {
  private context?: AudioContext;
  private readonly buffers = new Map<string, Promise<AudioBuffer>>();
  private readonly voices = new Map<number, Voice>();
  private nextVoice = 1;

  constructor(jvm: SlrrJvm, private readonly assets: Assets, private readonly resources: GameTypeNative,
    private readonly effectsVolume: () => number = () => 1,
    private readonly report: (error: Error) => void = () => {}) {
    const owner = 'java.util.resource.SfxRef';
    jvm.natives.register(owner, 'nplay', ['Vector3', 'float', 'float', 'float', 'int', 'int'], ({ receiver, args }) => {
      const id = this.nextVoice++;
      const voice: Voice = { stopped: false };
      this.voices.set(id, voice);
      const resource = this.resources.getResource(receiver);
      if (resource?.resourceId && typeof AudioContext !== 'undefined') {
        this.context ??= new AudioContext({ latencyHint: 'interactive' });
        void this.context.resume().catch(() => {});
        void this.play(id, voice, resource.resourcePack ?? 'frontend.rpk', resource.resourceId & 0xffff, args)
          .catch(error => this.report(error instanceof Error ? error : new Error(String(error))));
      } else this.voices.delete(id);
      return jv('int', id);
    });
    jvm.natives.register(owner, 'stop', ['int'], ({ args }) => {
      const id = Number(args[0].value), voice = this.voices.get(id);
      if (voice) {
        voice.stopped = true;
        try { voice.source?.stop(); } catch { /* The voice may already have ended. */ }
        this.voices.delete(id);
      }
      return jv('void', undefined);
    });
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
      source.onended = () => { this.voices.delete(handle); source.disconnect(); gain.disconnect(); panner.disconnect(); };
    } else {
      gain.connect(context.destination);
      source.onended = () => { this.voices.delete(handle); source.disconnect(); gain.disconnect(); };
    }
    source.start();
  }

  dispose() {
    for (const voice of this.voices.values()) {
      voice.stopped = true;
      try { voice.source?.stop(); } catch { /* Already stopped. */ }
    }
    this.voices.clear();
    void this.context?.close();
  }
}
