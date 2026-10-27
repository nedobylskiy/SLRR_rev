import { jv, nil, type JavaValue } from 'slrr-jvm';
import { MUSIC_SET, SOUND_CHANNEL, type MusicEngine } from './music-engine';

const constants: Record<string, number> = {
  ...Object.fromEntries(Object.entries(MUSIC_SET).map(([name, value]) => [`MUSIC_SET_${name}`, value])),
  ...Object.fromEntries(Object.entries(SOUND_CHANNEL).map(([name, value]) => [`CHANNEL_${name}`, value])),
};
const number = (value: JavaValue) => {
  if (typeof value.value !== 'number' || !Number.isFinite(value.value)) throw new Error('Sound argument must be numeric');
  return value.value;
};

/** Native-style binding for original Sound calls and optional newer readback calls. */
export class SoundJavaBridge {
  constructor(private readonly music: MusicEngine) {}
  constant(name: string) { return name in constants ? jv('int', constants[name]) : undefined; }
  call(name: string, args: JavaValue[]): JavaValue {
    const arg = (index: number) => { if (!args[index]) throw new Error(`Sound.${name} missing argument ${index}`); return number(args[index]); };
    switch (name) {
      case 'init': this.music.init(); return nil();
      case 'changeMusicSet': this.music.changeMusicSet(arg(0)); return nil();
      case 'firstTrack': this.music.firstTrack(); return nil();
      case 'nextTrack': this.music.nextTrack(); return nil();
      case 'prevTrack': this.music.prevTrack(); return nil();
      case 'randomTrack': this.music.randomTrack(); return nil();
      case 'stopMusic': this.music.stopMusic(); return nil();
      case 'getTotalTracks': return jv('int', this.music.snapshot().count);
      case 'getNowPlaying': return jv('String', this.music.snapshot().track?.path ?? '');
      case 'playTrack':
        if (typeof args[0]?.value === 'string') this.music.playPath(args[0].value);
        else this.music.playTrack(arg(0));
        return nil();
      case 'getVolume': return jv('float', this.music.getVolume(arg(0)));
      case 'setVolume': this.music.setVolume(arg(0), arg(1)); return nil();
      case 'increaseVolume': this.music.increaseVolume(arg(0), arg(1)); return nil();
      case 'decreaseVolume': this.music.decreaseVolume(arg(0), arg(1)); return nil();
      // Additive API for new Java scripts; original methods retain their names.
      case 'getTrackTitle': return jv('String', this.music.snapshot().track?.title ?? '');
      case 'getTrackArtist': return jv('String', this.music.snapshot().track?.artist ?? '');
      case 'getTrackAlbum': return jv('String', this.music.snapshot().track?.album ?? '');
      case 'getTrackPath': return jv('String', this.music.snapshot().track?.path ?? '');
      case 'getTrackPosition': return jv('float', this.music.snapshot().positionSeconds);
      case 'getTrackDuration': return jv('float', this.music.snapshot().durationSeconds ?? 0);
      case 'getTrackIndex': return jv('int', this.music.snapshot().index);
      case 'getTrackCount': return jv('int', this.music.snapshot().count);
      case 'isTrackPlaying': return jv('int', Number(this.music.snapshot().playing));
      case 'seekTrack': this.music.seek(arg(0)); return nil();
      case 'pauseTrack': this.music.pause(); return nil();
      case 'resumeTrack': void this.music.resume(); return nil();
      default: throw new Error(`Unsupported Sound native: ${name}`);
    }
  }
}
