import type { Assets, Asset } from '../assets';

// Internal identifiers supplied to interpreted Java Sound constants. The
// original Sound.class is not executed, so callers use names rather than IDs.
export const MUSIC_SET = { NONE: 0, MENU: 1, GARAGE: 2, RACE: 3, DRIVING: 4, MISC: 5 } as const;
export const SOUND_CHANNEL = { EFFECTS: 0, MUSIC: 1, ENGINE: 2 } as const;
const FOLDERS: Record<number, string> = {
  [MUSIC_SET.MENU]: 'main_menu', [MUSIC_SET.GARAGE]: 'garage_shop',
  [MUSIC_SET.RACE]: 'race_chase', [MUSIC_SET.DRIVING]: 'roam_ride', [MUSIC_SET.MISC]: 'misc_menu',
};

export interface MusicTrack { path: string; title: string; artist?: string; album?: string; format: string; size: number }
export interface MusicState {
  set: number; index: number; count: number; track: MusicTrack | null;
  positionSeconds: number; durationSeconds: number | null; playing: boolean; blocked: boolean;
  volume: number; error: string | null;
}

export function tracksForSet(files: readonly Asset[], set: number): Asset[] {
  const folder = FOLDERS[set];
  if (!folder) return [];
  return files.filter(file => new RegExp(`^music/${folder}/[^/]+\\.(mp3|ogg|wav)$`, 'i').test(file.path.replaceAll('\\', '/')))
    .sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

function decodeText(bytes: Uint8Array): string {
  if (!bytes.length) return '';
  const encoding = bytes[0];
  const content = bytes.subarray(1);
  try {
    if (encoding === 0) return new TextDecoder('iso-8859-1').decode(content).replace(/\0+$/, '').trim();
    if (encoding === 3) return new TextDecoder().decode(content).replace(/\0+$/, '').trim();
    if (encoding === 1) return new TextDecoder('utf-16').decode(content).replace(/\0+$/, '').trim();
    if (encoding === 2) return new TextDecoder('utf-16be').decode(content).replace(/\0+$/, '').trim();
  } catch { /* Keep the filename when a tag uses an unsupported encoding. */ }
  return '';
}

const synchsafe = (bytes: Uint8Array, index: number) => bytes[index] * 0x200000 + bytes[index + 1] * 0x4000 + bytes[index + 2] * 0x80 + bytes[index + 3];
/** Read common ID3v2 text frames from an MP3 header without loading audio data. */
export function parseId3(bytes: Uint8Array): Pick<MusicTrack, 'title' | 'artist' | 'album'> | null {
  if (bytes.length < 10 || new TextDecoder().decode(bytes.subarray(0, 3)) !== 'ID3') return null;
  const version = bytes[3];
  if (version !== 3 && version !== 4) return null;
  const tagEnd = Math.min(bytes.length, 10 + synchsafe(bytes, 6));
  const result: Partial<Pick<MusicTrack, 'title' | 'artist' | 'album'>> = {};
  for (let offset = 10; offset + 10 <= tagEnd;) {
    const id = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const size = version === 4 ? synchsafe(bytes, offset + 4) : (bytes[offset + 4] * 0x1000000 + bytes[offset + 5] * 0x10000 + bytes[offset + 6] * 0x100 + bytes[offset + 7]);
    if (size <= 0 || offset + 10 + size > tagEnd) break;
    const field = id === 'TIT2' ? 'title' : id === 'TPE1' ? 'artist' : id === 'TALB' ? 'album' : null;
    if (field) {
      const value = decodeText(bytes.subarray(offset + 10, offset + 10 + size));
      if (value) result[field] = value;
    }
    offset += 10 + size;
  }
  return Object.keys(result).length ? result as Pick<MusicTrack, 'title' | 'artist' | 'album'> : null;
}

const filenameTitle = (path: string) => (path.split('/').at(-1) ?? '').replace(/\.[^.]+$/, '').replaceAll('_', ' ');
const finiteTime = (value: number) => Number.isFinite(value) && value >= 0 ? value : 0;

/** Browser audio backend with the original set/track commands plus readback and seeking. */
export class MusicEngine {
  private readonly audio = new Audio();
  private readonly listeners = new Set<(state: MusicState) => void>();
  private readonly volumes = [1, 0.5, 1];
  private playlist: Asset[] = [];
  private set: number = MUSIC_SET.NONE;
  private index = -1;
  private track: MusicTrack | null = null;
  private objectUrl: string | null = null;
  private generation = 0;
  private blocked = false;
  private error: string | null = null;

  constructor(private readonly assets: Assets, private readonly localFiles: boolean) {
    this.audio.preload = 'metadata';
    this.audio.volume = this.volumes[SOUND_CHANNEL.MUSIC];
    for (const event of ['play', 'pause', 'timeupdate', 'durationchange', 'loadedmetadata', 'error']) this.audio.addEventListener(event, () => {
      if (event === 'error' && this.audio.error) this.error = `Audio decode error ${this.audio.error.code}`;
      this.emit();
    });
    this.audio.addEventListener('ended', () => this.nextTrack());
  }

  snapshot(): MusicState {
    return { set: this.set, index: this.index, count: this.playlist.length, track: this.track ? { ...this.track } : null,
      positionSeconds: finiteTime(this.audio.currentTime), durationSeconds: Number.isFinite(this.audio.duration) ? this.audio.duration : null,
      playing: !this.audio.paused, blocked: this.blocked, volume: this.volumes[SOUND_CHANNEL.MUSIC], error: this.error };
  }
  onState(listener: (state: MusicState) => void) { this.listeners.add(listener); listener(this.snapshot()); return () => this.listeners.delete(listener); }
  private emit() { const state = this.snapshot(); for (const listener of this.listeners) listener(state); }
  getVolume(channel: number) { return this.volumes[channel] ?? 0; }
  setVolume(channel: number, value: number) {
    if (!Number.isInteger(channel) || channel < 0 || channel >= this.volumes.length || !Number.isFinite(value)) throw new Error('Invalid audio channel or volume');
    this.volumes[channel] = Math.max(0, Math.min(1, value));
    if (channel === SOUND_CHANNEL.MUSIC) this.audio.volume = this.volumes[channel];
    this.emit();
  }
  increaseVolume(channel: number, amount: number) { this.setVolume(channel, this.getVolume(channel) + amount); }
  decreaseVolume(channel: number, amount: number) { this.setVolume(channel, this.getVolume(channel) - amount); }
  init() { this.emit(); }
  changeMusicSet(set: number) {
    if (!Number.isInteger(set) || !(set === MUSIC_SET.NONE || set in FOLDERS)) throw new Error(`Unknown music set ${set}`);
    if (set === this.set && this.index >= 0) return;
    this.set = set; this.playlist = tracksForSet(this.assets.files, set);
    if (!this.playlist.length) { this.clear(); return; }
    this.playTrack(0);
  }
  firstTrack() { this.playTrack(0); }
  nextTrack() { if (this.playlist.length) this.playTrack((this.index + 1) % this.playlist.length); }
  prevTrack() { if (this.playlist.length) this.playTrack((this.index - 1 + this.playlist.length) % this.playlist.length); }
  randomTrack() {
    if (!this.playlist.length) return;
    const next = this.playlist.length === 1 ? 0 : (this.index + 1 + Math.floor(Math.random() * (this.playlist.length - 1))) % this.playlist.length;
    this.playTrack(next);
  }
  stopMusic() { this.audio.pause(); this.audio.currentTime = 0; this.blocked = false; this.emit(); }
  playPath(path: string) {
    const normalized = path.replaceAll('\\', '/').replace(/^\/+/, '').toLowerCase();
    const file = this.assets.files.find(candidate => candidate.path.replaceAll('\\', '/').toLowerCase() === normalized);
    if (!file || !/\.(mp3|ogg|wav)$/.test(normalized)) throw new Error(`Music file unavailable: ${path}`);
    this.set = MUSIC_SET.NONE;
    this.playlist = [file];
    this.playTrack(0);
  }
  playTrack(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= this.playlist.length) return;
    const generation = ++this.generation, file = this.playlist[index], path = file.path.replaceAll('\\', '/');
    this.audio.pause(); this.releaseUrl(); this.index = index; this.blocked = false; this.error = null;
    this.track = { path, title: filenameTitle(path), format: path.split('.').at(-1)?.toLowerCase() ?? '', size: file.size };
    this.emit();
    void (async () => {
      let head: Uint8Array;
      if (this.localFiles) {
        this.audio.src = `/api/game/file?path=${encodeURIComponent(path)}`;
        void this.resume();
        const response = await fetch(this.audio.src, { headers: { Range: 'bytes=0-65535' } });
        if (!response.ok) throw new Error(`Music file unavailable: ${path}`);
        head = new Uint8Array(await response.arrayBuffer());
      } else {
        const bytes = await this.assets.read(path);
        if (generation !== this.generation) return;
        head = bytes.subarray(0, 65536);
        this.objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: this.track!.format === 'mp3' ? 'audio/mpeg' : `audio/${this.track!.format}` }));
        this.audio.src = this.objectUrl;
      }
      if (generation !== this.generation) return;
      const tags = parseId3(head);
      if (tags && this.track) this.track = { ...this.track, ...tags };
      this.emit();
      if (!this.localFiles) await this.resume();
    })().catch(error => { if (generation === this.generation) { this.error = String(error); this.emit(); } });
  }
  async resume() {
    if (!this.track) return;
    try { await this.audio.play(); this.blocked = false; this.error = null; }
    catch (error) { this.blocked = true; this.error = String(error); }
    this.emit();
  }
  pause() { this.audio.pause(); this.blocked = false; this.emit(); }
  seek(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid music position');
    if (this.track) this.audio.currentTime = this.audio.duration && Number.isFinite(this.audio.duration) ? Math.min(seconds, this.audio.duration) : seconds;
    this.emit();
  }
  private releaseUrl() { if (this.objectUrl) URL.revokeObjectURL(this.objectUrl); this.objectUrl = null; }
  private clear() { ++this.generation; this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); this.releaseUrl(); this.index = -1; this.track = null; this.blocked = false; this.error = null; this.emit(); }
  dispose() { this.clear(); this.listeners.clear(); }
}
