import { normalizePath, type Assets } from '../assets';
import type { OsdLayer } from './osd-layer';

/** The native GfxEngine video surface sits behind Java-created OSD controls. */
export class OsdVideo {
  private video?: HTMLVideoElement;

  constructor(private osd: OsdLayer, private assets: Assets, private localGameFiles: boolean) {}

  openVideo(path: string, loop = false): number {
    this.closeVideo();
    let normalized: string;
    try { normalized = normalizePath(path); }
    catch { return 1; }
    if (!this.localGameFiles || !this.assets.byPath.has(normalized) || !/\.(avi|mp4|webm)$/i.test(normalized)) return 1;
    const video = document.createElement('video');
    video.className = 'osd-background-video';
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.loop = loop;
    video.onended = () => { if (this.video === video) this.closeVideo(); };
    video.onerror = () => { if (this.video === video) this.closeVideo(); };
    video.src = `/api/game/video?path=${encodeURIComponent(path.replaceAll('\\', '/'))}`;
    this.osd.stage.prepend(video);
    this.video = video;
    void video.play().catch(() => { if (this.video === video) this.closeVideo(); });
    return 0;
  }

  closeVideo(): void {
    const video = this.video;
    this.video = undefined;
    if (!video) return;
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
  }

  isPlayingVideo(): number { return this.video ? 1 : 0; }
  dispose(): void { this.closeVideo(); }
}
