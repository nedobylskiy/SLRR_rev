import { Vector3, type Camera } from 'three';
import type { Assets } from '../assets';
import type { Vehicle3D } from '../engine/vehicle-3d';
import type { TireSurface } from '../engine/map-terrain';
import { engineSfxLevels, resolveEngineSfx, type EngineSfxSample } from './vehicle-sfx';
import { SOUND_CHANNEL } from './music-engine';
import { gameSoundVolume, skidLoudness } from './audio-settings';

interface LoopVoice { source: AudioBufferSourceNode; gain: GainNode; panner?: PannerNode }
interface WheelVoices { surface: TireSurface; roll?: LoopVoice; skid?: LoopVoice }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const ENGINE_SAMPLE_GAIN = 1 / 1.5;
const IMPACT_SOUNDS = ['sound/wav/collision/Collision.wav', 'sound/wav/collision/MetalHit2.WAV', 'sound/wav/collision/Metal_plane_hit_04.WAV'];
const SURFACE_SOUNDS: Record<TireSurface, { roll: string; skid: string }> = {
  road: { roll: 'sound/wav/surface/Wheel_Asphalt.wav', skid: 'sound/wav/surface/Slip3.wav' },
  grass: { roll: 'sound/wav/surface/Fld.wav', skid: 'sound/wav/surface/Slip.wav' },
  dirt: { roll: 'sound/wav/surface/Kavics.wav', skid: 'sound/wav/surface/skid_sand.wav' },
};

/** Spatial Web Audio sources driven by the current vehicle and its original Java SfxTable. */
export class VehicleAudio {
  private readonly context = new AudioContext({ latencyHint: 'interactive' });
  private readonly masterBus = this.context.createGain();
  private readonly engineBus = this.context.createGain();
  private readonly effectsBus = this.context.createGain();
  private readonly impactLimiter = this.context.createDynamicsCompressor();
  private readonly buffers = new Map<string, Promise<AudioBuffer | undefined>>();
  private readonly decoded = new Map<string, AudioBuffer>();
  private readonly engineVoices: { sample: EngineSfxSample; voice: LoopVoice }[] = [];
  private readonly wheelVoices: (WheelVoices | undefined)[] = [undefined, undefined, undefined, undefined];
  private wind?: LoopVoice;
  private exhaustMinVolume = 0;
  private wasRunning: boolean;
  private sharpSkid = false;
  private lastCollisionAt = -Infinity;
  private disposed = false;
  constructor(private readonly assets: Assets, private readonly car: Vehicle3D, private readonly volumes?: { getVolume(channel: number): number }) {
    this.wasRunning = car.suspension.mechanics?.running ?? false;
    this.engineBus.connect(this.masterBus);
    this.effectsBus.connect(this.masterBus);
    this.impactLimiter.threshold.value = -7;
    this.impactLimiter.knee.value = 4;
    this.impactLimiter.ratio.value = 4;
    this.impactLimiter.attack.value = 0.002;
    this.impactLimiter.release.value = 0.12;
    this.impactLimiter.connect(this.effectsBus);
    this.masterBus.connect(this.context.destination);
    this.engineBus.gain.value = 0;
    this.effectsBus.gain.value = 0;
    // Impact clips are needed immediately; do not queue them behind engine RPK resolution.
    for (const path of IMPACT_SOUNDS) void this.buffer(path);
    void this.load().catch(() => { /* A missing mod sound table should not stop the drive. */ });
  }
  private buffer(path: string) {
    const key = path.toLowerCase();
    if (!this.buffers.has(key)) this.buffers.set(key, (async () => {
      if (!this.assets.byPath.has(key)) return;
      try {
        const bytes = await this.assets.read(path);
        const decoded = await this.context.decodeAudioData(new Uint8Array(bytes).buffer);
        this.decoded.set(key, decoded);
        return decoded;
      } catch { return; }
    })());
    return this.buffers.get(key)!;
  }
  private voice(buffer: AudioBuffer, bus: AudioNode, distance?: { ref: number; max: number }): LoopVoice {
    const source = this.context.createBufferSource(), gain = this.context.createGain();
    source.buffer = buffer; source.loop = true; source.connect(gain); gain.gain.value = 0;
    let panner: PannerNode | undefined;
    if (distance) {
      panner = this.context.createPanner(); panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse';
      panner.refDistance = distance.ref; panner.maxDistance = distance.max; panner.rolloffFactor = 0.25;
      gain.connect(panner); panner.connect(bus);
    } else gain.connect(bus);
    source.start(); return { source, gain, panner };
  }
  private async load() {
    const block = this.car.suspension.mechanics?.block?.definition;
    const profile = block ? await resolveEngineSfx(this.assets, block).catch(() => ({ samples: [] as EngineSfxSample[], exhaustMinVolume: 0 })) : { samples: [], exhaustMinVolume: 0 };
    this.exhaustMinVolume = profile.exhaustMinVolume;
    const [samples, wind] = await Promise.all([
      Promise.all(profile.samples.filter(sample => sample.table === 0 || sample.table === 2).map(async sample => ({ sample, buffer: await this.buffer(sample.path) }))),
      this.buffer('sound/wav/Air.wav'),
    ]);
    if (this.disposed) return;
    for (const { sample, buffer } of samples) if (buffer) this.engineVoices.push({ sample, voice: this.voice(buffer, this.engineBus, { ref: sample.refDistance, max: sample.maxDistance }) });
    if (wind) this.wind = this.voice(wind, this.effectsBus);
    await Promise.all([
      ...Object.values(SURFACE_SOUNDS).flatMap(paths => [paths.roll, paths.skid]),
      'sound/wav/engine/ignition.wav', 'sound/wav/surface/skid_ok.wav',
    ].map(path => this.buffer(path)));
  }
  activate() { if (!this.disposed) void this.context.resume().catch(() => {}); }
  suspend(value: boolean) { if (!this.disposed) void (value ? this.context.suspend() : this.context.resume()).catch(() => {}); }
  private setGain(voice: LoopVoice | undefined, value: number, seconds = 0.07) {
    voice?.gain.gain.setTargetAtTime(clamp(value, 0, 1), this.context.currentTime, seconds);
  }
  private setPosition(voice: LoopVoice | undefined, position: Vector3) {
    if (!voice?.panner) return;
    const p = voice.panner, time = this.context.currentTime;
    p.positionX.setValueAtTime(position.x, time); p.positionY.setValueAtTime(position.y, time); p.positionZ.setValueAtTime(position.z, time);
  }
  private stopVoice(voice?: LoopVoice) {
    if (!voice) return;
    voice.gain.gain.setTargetAtTime(0, this.context.currentTime, 0.02);
    try { voice.source.stop(this.context.currentTime + 0.1); } catch { /* Already stopped. */ }
  }
  private oneShot(path: string, volume: number, position: Vector3, pitch = 1, bus: AudioNode = this.effectsBus, offset = 0) {
    const buffer = this.decoded.get(path.toLowerCase());
    if (!buffer) {
      void this.buffer(path).then(ready => { if (ready && !this.disposed) this.playOneShot(ready, volume, position, pitch, bus, offset); });
      return;
    }
    this.playOneShot(buffer, volume, position, pitch, bus, offset);
  }
  private playOneShot(buffer: AudioBuffer, volume: number, position: Vector3, pitch: number, bus: AudioNode, offset: number) {
    if (this.disposed) return;
    const source = this.context.createBufferSource(), gain = this.context.createGain(), panner = this.context.createPanner();
    source.buffer = buffer; source.playbackRate.value = pitch; gain.gain.value = clamp(volume, 0, 1);
    panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse'; panner.refDistance = 3;
    panner.maxDistance = 70; panner.rolloffFactor = 0.25;
    panner.positionX.value = position.x; panner.positionY.value = position.y; panner.positionZ.value = position.z;
    source.connect(gain); gain.connect(panner); panner.connect(bus);
    source.onended = () => { source.disconnect(); gain.disconnect(); panner.disconnect(); };
    source.start(0, Math.max(0, Math.min(offset, buffer.duration - 0.001)));
  }
  private async wheelSounds(index: number, surface: TireSurface) {
    const slot = this.wheelVoices[index];
    const paths = SURFACE_SOUNDS[surface];
    const [roll, skid] = await Promise.all([this.buffer(paths.roll), this.buffer(paths.skid)]);
    if (this.disposed || this.wheelVoices[index] !== slot) return;
    if (roll) slot!.roll = this.voice(roll, this.effectsBus, { ref: 2, max: 45 });
    if (skid) slot!.skid = this.voice(skid, this.effectsBus, { ref: 2, max: 55 });
  }
  private listener(camera: Camera) {
    const position = camera.getWorldPosition(new Vector3()), forward = camera.getWorldDirection(new Vector3()), up = new Vector3(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(camera.quaternion.clone()));
    const listener = this.context.listener, t = this.context.currentTime;
    listener.positionX.setValueAtTime(position.x, t); listener.positionY.setValueAtTime(position.y, t); listener.positionZ.setValueAtTime(position.z, t);
    listener.forwardX.setValueAtTime(forward.x, t); listener.forwardY.setValueAtTime(forward.y, t); listener.forwardZ.setValueAtTime(forward.z, t);
    listener.upX.setValueAtTime(up.x, t); listener.upY.setValueAtTime(up.y, t); listener.upZ.setValueAtTime(up.z, t);
  }
  update(camera: Camera, throttle: number, paused = false) {
    if (this.disposed) return;
    this.listener(camera);
    const mechanics = this.car.suspension.mechanics, rpm = mechanics?.rpm ?? 0, running = mechanics?.running ?? false;
    if (!paused && running && !this.wasRunning) {
      const enginePosition = mechanics?.block ? new Vector3().setFromMatrixPosition(mechanics.block.matrix()) : this.car.body.position;
      this.oneShot('sound/wav/engine/ignition.wav', 0.75, enginePosition.clone(), 1, this.engineBus);
    }
    this.wasRunning = running;
    this.masterBus.gain.setTargetAtTime(gameSoundVolume, this.context.currentTime, 0.05);
    this.engineBus.gain.setTargetAtTime(paused ? 0 : this.volumes?.getVolume(SOUND_CHANNEL.ENGINE) ?? 1, this.context.currentTime, 0.08);
    this.effectsBus.gain.setTargetAtTime(paused ? 0 : this.volumes?.getVolume(SOUND_CHANNEL.EFFECTS) ?? 1, this.context.currentTime, 0.08);
    for (const table of [0, 2]) {
      const group = this.engineVoices.filter(item => item.sample.table === table), levels = engineSfxLevels(group.map(item => item.sample), rpm);
      group.forEach(({ sample, voice }, i) => {
        const level = table === 2 ? (this.exhaustMinVolume + (1 - this.exhaustMinVolume) * Math.max(0, throttle)) * 0.58 : 0.85;
        this.setGain(voice, running && mechanics?.power ? level * ENGINE_SAMPLE_GAIN * clamp(levels[i] / 1.5, 0, 1.5) * mechanics.power : 0);
        voice.source.playbackRate.setTargetAtTime(clamp(rpm / sample.referenceRpm, 0.58, 3), this.context.currentTime, 0.05);
        const position = table === 2 ? new Vector3(0, -0.2, 2).applyMatrix4(this.car.root.matrix()) : mechanics?.block ? new Vector3().setFromMatrixPosition(mechanics.block.matrix()) : undefined;
        if (position) this.setPosition(voice, position);
      });
    }
    const speed = this.car.velocity().length();
    const skidLevel = skidLoudness(speed);
    this.setGain(this.wind, paused ? 0 : clamp((speed - 11) / 42, 0, 1) * 0.18, 0.14);
    if (this.wind) this.wind.source.playbackRate.setTargetAtTime(clamp(0.8 + speed / 90, 0.8, 1.6), this.context.currentTime, 0.1);
    this.car.suspension.wheels.forEach((wheel, index) => {
      if (!this.wheelVoices[index] || this.wheelVoices[index]!.surface !== wheel.surface) {
        this.stopVoice(this.wheelVoices[index]?.roll); this.stopVoice(this.wheelVoices[index]?.skid);
        this.wheelVoices[index] = { surface: wheel.surface }; void this.wheelSounds(index, wheel.surface);
      }
      const voices = this.wheelVoices[index], rolling = Math.abs(wheel.omega * wheel.radius), slip = Math.hypot(wheel.slipSpeed, wheel.lateralSpeed);
      this.setGain(voices?.roll, !paused && wheel.contact ? clamp((rolling - 1) / 30, 0, 1) * 0.12 : 0);
      this.setGain(voices?.skid, !paused && wheel.contact ? clamp((slip - 2) / 10, 0, 1) * 0.3 * skidLevel : 0);
      this.setPosition(voices?.roll, wheel.contactPoint); this.setPosition(voices?.skid, wheel.contactPoint);
    });
    const sideways = this.car.suspension.wheels.filter(wheel => wheel.contact)
      .sort((a, b) => Math.abs(b.lateralSpeed) - Math.abs(a.lateralSpeed))[0];
    const sharp = !paused && speed > 14 && !!sideways && Math.abs(sideways.lateralSpeed) > 3.4;
    if (sharp && !this.sharpSkid && sideways) this.oneShot('sound/wav/surface/skid_ok.wav', 0.62 * skidLevel, sideways.contactPoint.clone());
    this.sharpSkid = sharp || this.sharpSkid && speed > 9 && !!sideways && Math.abs(sideways.lateralSpeed) > 1.6;
    const collision = this.car.collisionCue;
    if (!paused && collision && this.context.currentTime - this.lastCollisionAt > 0.16) {
      this.lastCollisionAt = this.context.currentTime;
      const strength = clamp((collision.speed - 2) / 18, 0, 1);
      const pitch = clamp(0.9 + collision.speed / 90, 0.9, 1.12);
      this.oneShot(IMPACT_SOUNDS[0], 0.32 + strength * 0.48, collision.position.clone(), pitch, this.impactLimiter, 0.03);
      if (collision.speed > 7) this.oneShot(IMPACT_SOUNDS[1], 0.15 + strength * 0.3, collision.position.clone(), pitch * 0.93, this.impactLimiter, 0.02);
      if (collision.speed > 14) this.oneShot(IMPACT_SOUNDS[2], strength * 0.25, collision.position.clone(), pitch * 1.05, this.impactLimiter, 0.06);
    }
  }
  dispose() {
    if (this.disposed) return; this.disposed = true;
    for (const { voice } of this.engineVoices) this.stopVoice(voice);
    for (const wheel of this.wheelVoices) { this.stopVoice(wheel?.roll); this.stopVoice(wheel?.skid); }
    this.stopVoice(this.wind);
    void this.context.close().catch(() => {});
  }
}
