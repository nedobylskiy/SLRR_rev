import { entryProperties } from '../formats/rpk';
import { originalNumber, OriginalStock } from '../engine/original-stock';
import type { PartDefinition } from '../engine/world';
import type { Assets } from '../assets';

export interface EngineSfxItem {
  table: number; pack: string; id: number; referenceRpm: number;
  minRpm: number; maxRpm: number; minVolume: number; maxVolume: number;
}
export interface EngineSfxSample extends EngineSfxItem { path: string; refDistance: number; maxDistance: number }

/** Read the native SfxTable calls present in an original engine block's Java source. */
export function parseEngineSfx(source: string): { items: EngineSfxItem[]; exhaustMinVolume: number } {
  const items: EngineSfxItem[] = [];
  let table = -1;
  const statements = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').split(';');
  for (const statement of statements) {
    const selected = /\bgetSfxTable\s*\(\s*(\d+)\s*\)/.exec(statement);
    if (selected) table = Number(selected[1]);
    if (/\btab\.clear\s*\(\s*\)/.test(statement)) items.splice(0, items.length, ...items.filter(item => item.table !== table));
    const call = /\btab\.addItem\s*\(\s*new\s+ResourceRef\s*\(\s*([\w.]+):0x([\da-f]+)r\s*\)\s*,([\s\S]+)\)/i.exec(statement);
    if (!call || table < 0) continue;
    const values = call[3].split(',').map(originalNumber);
    if (values.length !== 5 || values.some(value => value === undefined)) continue;
    const [referenceRpm, minRpm, maxRpm, minVolume, maxVolume] = values as number[];
    if (referenceRpm <= 0 || minRpm < 0 || maxRpm <= minRpm) continue;
    items.push({ table, pack: `${call[1].replaceAll('.', '/')}.rpk`, id: Number.parseInt(call[2], 16), referenceRpm, minRpm, maxRpm, minVolume, maxVolume });
  }
  const exhaust = /\bsetSfxExhaustMinVol\s*\(\s*([^)]+)\)/.exec(source);
  return { items, exhaustMinVolume: exhaust ? originalNumber(exhaust[1]) ?? 0 : 0 };
}

export async function resolveEngineSfx(assets: Assets, block: PartDefinition): Promise<{ samples: EngineSfxSample[]; exhaustMinVolume: number }> {
  const parsed = parseEngineSfx(await new OriginalStock(assets).source(block));
  const samples = (await Promise.all(parsed.items.map(async item => {
    try {
      const { entry } = await assets.resource(item.pack, item.id);
      const props = entryProperties(entry), get = (key: string) => props.find(p => p.key === key)?.value;
      const sourcePath = get('sourcefile')?.replaceAll('\\', '/');
      if (!sourcePath) return;
      const path = sourcePath && assets.byPath.get(sourcePath.toLowerCase())?.path;
      if (!path) return;
      return { ...item, path, refDistance: Number(get('mindist')) || 2.5, maxDistance: Number(get('maxdist')) || 60 };
    } catch { return; }
  }))).filter(sample => sample !== undefined);
  return { samples, exhaustMinVolume: parsed.exhaustMinVolume };
}

export function engineBlendWeights(items: readonly EngineSfxItem[], rpm: number): number[] {
  // The native SfxTable uses the reference RPM for pitch only. Adjacent sample
  // ranges crossfade over their overlap; a sample with no overlap plays fully.
  const weights = items.map((item, index) => {
    if (rpm < item.minRpm || rpm > item.maxRpm) return 0;
    let weight = 1;
    const previous = items[index - 1];
    if (previous && rpm <= previous.maxRpm) {
      const overlap = previous.maxRpm - item.minRpm;
      if (overlap > 0) weight = (rpm - item.minRpm) / overlap;
    }
    const next = items[index + 1];
    if (next && rpm >= next.minRpm) {
      const overlap = item.maxRpm - next.minRpm;
      if (overlap > 0) weight = 1 - (rpm - next.minRpm) / overlap;
    }
    return Math.max(0, weight);
  });
  if (weights.some(weight => weight > 0)) return weights;
  if (!items.length) return weights;
  const lower = items.map((item, index) => ({ item, index })).filter(({ item }) => item.maxRpm < rpm).sort((a, b) => b.item.maxRpm - a.item.maxRpm)[0];
  const upper = items.map((item, index) => ({ item, index })).filter(({ item }) => item.minRpm > rpm).sort((a, b) => a.item.minRpm - b.item.minRpm)[0];
  if (lower && upper) {
    const middle = (lower.item.maxRpm + upper.item.minRpm) / 2;
    const blend = Math.max(0, Math.min(1, (rpm - middle + 150) / 300));
    return items.map((_, i) => i === lower.index ? 1 - blend : i === upper.index ? blend : 0);
  }
  const distances = items.map(item => Math.max(item.minRpm - rpm, 0, rpm - item.maxRpm));
  const nearest = Math.min(...distances), index = distances.indexOf(nearest);
  return items.map((_, i) => i === index ? 1 : 0);
}

/** The SfxTable's per-sample level before the host's engine/exhaust gain. */
export function engineSfxLevels(items: readonly EngineSfxItem[], rpm: number): number[] {
  const weights = engineBlendWeights(items, rpm);
  return items.map((item, index) => {
    const span = item.maxRpm - item.minRpm;
    const t = span > 0 ? Math.max(0, Math.min(1, (rpm - item.minRpm) / span)) : 0;
    return weights[index] * (item.minVolume + (item.maxVolume - item.minVolume) * t);
  });
}
