import type { Assets } from '../assets';

/** Draws the stock gauge atlas selected by the Java car's resource pack. */
export class JavaGauges {
  readonly element = document.createElement('canvas');
  private context: CanvasRenderingContext2D;
  private atlas: ImageBitmap | null = null;
  private pin: ImageBitmap | null = null;
  private disposed = false;

  constructor(private readonly assets: Assets, pack: string) {
    this.element.className = 'java-gauges';
    this.element.width = 824; this.element.height = 824;
    this.element.setAttribute('aria-label', 'Vehicle speedometer and tachometer');
    const context = this.element.getContext('2d');
    if (!context) throw new Error('Canvas 2D unavailable for vehicle gauges');
    this.context = context;
    void this.load(pack);
  }

  private async load(pack: string) {
    const family = pack.replaceAll('\\', '/').split('/').at(-1)?.replace(/\.rpk$/i, '') ?? '';
    const prefix = `cars/textures/gauges/${family}/${family}`.toLowerCase();
    const find = (suffix: string) => this.assets.byPath.get(`${prefix}${suffix}`)?.path;
    const atlasPath = find('_gauge.png'), pinPath = find('_pin.png');
    if (!atlasPath || !pinPath) return;
    const decode = async (path: string) => createImageBitmap(new Blob([new Uint8Array(await this.assets.read(path))], { type: 'image/png' }));
    try {
      const [atlas, pin] = await Promise.all([decode(atlasPath), decode(pinPath)]);
      if (this.disposed) { atlas.close(); pin.close(); return; }
      this.atlas = atlas; this.pin = pin; this.update(0, 0, 0);
    } catch { /* A missing modded atlas leaves the host readout available. */ }
  }

  update(speedKmh: number, rpm: number, gear: number) {
    const ctx = this.context;
    ctx.clearRect(0, 0, 824, 824);
    if (!this.atlas || !this.pin) return;
    ctx.drawImage(this.atlas, 0, 0, 824, 824);
    const needle = (x: number, y: number, fraction: number) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate((-135 + 270 * Math.max(0, Math.min(1, fraction))) * Math.PI / 180);
      ctx.drawImage(this.pin!, -this.pin!.width / 2, -this.pin!.height + 8); ctx.restore();
    };
    needle(572, 345, speedKmh / 240);
    needle(204, 637, rpm / 9000);
    ctx.fillStyle = '#10251b'; ctx.textAlign = 'center'; ctx.font = 'bold 38px Arial';
    ctx.fillText(String(Math.max(0, Math.round(speedKmh))), 570, 558);
    ctx.font = 'bold 31px Arial'; ctx.fillText(gear < 0 ? 'R' : gear === 0 ? 'N' : String(gear), 205, 792);
  }

  dispose() { this.disposed = true; this.atlas?.close(); this.pin?.close(); this.element.remove(); }
}
