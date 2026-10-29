import type { PartConfig } from '../formats/cfg';
import type { OsdLayer, OsdResource } from './osd-layer';

type GaugeDirective = { resource: OsdResource; args: string[] };

/** Render native vehicle CFG osd_* directives inside the same layer as Java gadgets. */
export class JavaGauges {
  private readonly root = document.createElement('div');
  private readonly speedPin = document.createElement('img');
  private readonly rpmPin = document.createElement('img');
  private readonly speedText = document.createElement('span');
  private readonly gearText = document.createElement('span');
  private readonly mileageText = document.createElement('span');
  private readonly pinSpeed: string[];
  private readonly pinRpm: string[];
  private disposed = false;
  private travelledKm = 0;
  private lastUpdate = 0;

  constructor(osd: OsdLayer, pack: string, config: PartConfig) {
    const directives = new Map<string, GaugeDirective>();
    for (const item of config.unknown) {
      const match = /^0x([0-9a-f]+)r?$/i.exec(item.args[0] ?? '');
      if (item.command.toLowerCase().startsWith('osd_') && match)
        directives.set(item.command.toLowerCase(), { resource: { pack, id: Number.parseInt(match[1], 16) }, args: item.args });
    }
    this.pinSpeed = directives.get('osd_spdpin')?.args ?? [];
    this.pinRpm = directives.get('osd_rpmpin')?.args ?? [];
    this.root.className = 'java-gauges';
    this.root.setAttribute('role', 'img');
    this.root.setAttribute('aria-label', 'Vehicle instruments');
    const gaugePosition = directives.get('osd_gauge')?.args ?? [];
    // CFG gauge meshes use a horizontal -2..2 and vertical up-positive -1..1
    // screen space; the DOM OSD stage uses -1..1 with Y pointing down.
    const gaugeX = Number(gaugePosition[1]), gaugeY = Number(gaugePosition[2]);
    osd.createNativeElement(this.root, Number.isFinite(gaugeX) ? gaugeX / 2 : 0.68,
      Number.isFinite(gaugeY) ? -gaugeY : 0.55, 0.64, 0.90, 20);
    const atlas = document.createElement('img');
    atlas.className = 'java-gauge-atlas'; atlas.alt = '';
    this.root.append(atlas);
    this.placePin(this.speedPin, 572, 345);
    this.placePin(this.rpmPin, 204, 637);
    this.placeReadout(this.speedText, 'speed', 572, 558);
    this.placeReadout(this.gearText, 'gear', 204, 792);
    this.placeReadout(this.mileageText, 'mileage', 572, 686);
    void this.load(osd, directives, atlas);
    this.update(0, 0, 0);
  }

  private placePin(pin: HTMLImageElement, x: number, y: number) {
    pin.alt = ''; pin.className = 'java-gauge-pin';
    pin.style.left = `${(x - 22.5) / 820 * 100}%`;
    pin.style.top = `${(y - 188) / 830 * 100}%`;
    this.root.append(pin);
  }

  private placeReadout(node: HTMLSpanElement, kind: string, x: number, y: number) {
    node.className = `java-gauge-readout java-gauge-${kind}`;
    node.style.left = `${x / 820 * 100}%`;
    node.style.top = `${y / 830 * 100}%`;
    this.root.append(node);
  }

  private async load(osd: OsdLayer, directives: Map<string, GaugeDirective>, atlas: HTMLImageElement) {
    const load = async (name: string, image: HTMLImageElement) => {
      const directive = directives.get(name);
      if (!directive) return;
      const url = await osd.imageUrl(directive.resource);
      if (!this.disposed) image.src = url;
    };
    try {
      await Promise.all([load('osd_gauge', atlas), load('osd_spdpin', this.speedPin), load('osd_rpmpin', this.rpmPin)]);
    } catch (error) {
      this.root.dataset.gaugeError = error instanceof Error ? error.message : String(error);
    }
  }

  update(speedKmh: number, rpm: number, gear: number) {
    const now = performance.now();
    if (this.lastUpdate) this.travelledKm += Math.max(0, speedKmh) * Math.min(100, now - this.lastUpdate) / 3_600_000;
    this.lastUpdate = now;
    const angle = (args: string[], value: number, fallbackRate: number, fallbackBase: number) => {
      const base = Number(args[4]), rate = Number(args[5]);
      return `${-(Number.isFinite(base) ? base : fallbackBase) - (Number.isFinite(rate) ? rate : fallbackRate) * value}rad`;
    };
    this.speedPin.style.transform = `rotate(${angle(this.pinSpeed, speedKmh, -0.021, 2.625)})`;
    this.rpmPin.style.transform = `rotate(${angle(this.pinRpm, rpm, -0.000575, 2.6)})`;
    this.speedText.textContent = String(Math.max(0, Math.round(speedKmh))).padStart(3, '0');
    this.gearText.textContent = gear < 0 ? 'R' : gear === 0 ? 'N' : String(gear);
    this.mileageText.textContent = String(Math.floor(this.travelledKm)).padStart(7, '0');
    this.root.setAttribute('aria-label', `${Math.round(speedKmh)} km/h, ${Math.round(rpm)} rpm, gear ${this.gearText.textContent}`);
  }

  dispose() { this.disposed = true; this.root.remove(); }
}
