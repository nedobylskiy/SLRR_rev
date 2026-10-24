import { Assets, normalizePath } from '../assets';
import type { PartDefinition, ResourceKey } from './world';

export interface MechanicalProfile { kind: 'suspension' | 'spring' | 'shock' | 'brake' | 'sway' | 'engine'; source: string; values: Record<string, number>; hub?: number[]; arm?: number[]; drive?: string }
const clean = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
const mask = (s: string) => s.replace(/"(?:\\.|[^"\\])*"/g, m => ' '.repeat(m.length));
function closing(s: string, start: number, open = '{', close = '}') { let depth = 1; for (let i = start + 1; i < s.length; i++) { if (s[i] === open) depth++; if (s[i] === close && --depth === 0) return i; } throw new Error('Unbalanced original source'); }
/** Deliberately small numeric expression reader; never executes source text. */
export function originalNumber(expression: string): number | undefined {
  const tokens = expression.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_]\w*|[-+*/(),]/g) ?? [];
  if (tokens.join('') !== expression.replace(/\s/g, '')) return;
  let i = 0;
  const atom = (): number => {
    const t = tokens[i++]; if (t === '-') return -atom(); if (t === '+') return atom();
    if (t === '(') { const n = sum(); if (tokens[i++] !== ')') throw 0; return n; }
    if (/^(Inch2Meter|kgfPmm2NPm)$/.test(t ?? '')) { if (tokens[i++] !== '(') throw 0; const n = sum(); if (tokens[i++] !== ')') throw 0; return n * (t === 'Inch2Meter' ? 0.0254 : 9810); }
    const n = Number(t); if (t === undefined || !Number.isFinite(n)) throw 0; return n;
  };
  const product = (): number => { let n = atom(); while (tokens[i] === '*' || tokens[i] === '/') { const op = tokens[i++], b = atom(); n = op === '*' ? n * b : n / b; } return n; };
  const sum = (): number => { let n = product(); while (tokens[i] === '+' || tokens[i] === '-') { const op = tokens[i++], b = product(); n = op === '+' ? n + b : n - b; } return n; };
  try { const n = sum(); return i === tokens.length && Number.isFinite(n) ? n : undefined; } catch { return; }
}

function condition(text: string, env: Record<string, string | number>): boolean {
  if (text.includes('||')) return text.split('||').some(s => condition(s.trim(), env));
  if (text.includes('&&')) return text.split('&&').every(s => condition(s.trim(), env));
  const m = /^\s*([\w.]+)\s*(==|!=|<=|>=|<|>)\s*([\w.]+)\s*$/.exec(text);
  if (!m) return false; // Non-stock guards (e.g. if(fr) randomizeMixtureRatio) are not executed.
  const value = (s: string) => env[s] ?? originalNumber(s) ?? s.split('.').at(-1)!;
  const a = value(m[1]), b = value(m[3]);
  return m[2] === '==' ? a === b : m[2] === '!=' ? a !== b : m[2] === '<' ? a < b : m[2] === '>' ? a > b : m[2] === '<=' ? a <= b : a >= b;
}
/** Select braced if/else branches for a fixed descriptor/model; this is not a Java VM. */
export function selectStockBranches(source: string, env: Record<string, string | number>): string {
  const s = mask(source); let out = '', cursor = 0;
  const skip = (i: number) => { while (/\s/.test(s[i] ?? '') && i < s.length) i++; return i; };
  const statement = (start: number): { end: number; text: string } => {
    start = skip(start);
    if (s.slice(start, start + 2) === 'if' && !/\w/.test(s[start + 2] ?? '')) {
      const p = s.indexOf('(', start), q = closing(s, p, '(', ')'), yes = statement(q + 1); let end = skip(yes.end), no = { end, text: '' };
      if (s.slice(end, end + 4) === 'else') { no = statement(end + 4); end = no.end; }
      return { end, text: condition(source.slice(p + 1, q), env) ? yes.text : no.text };
    }
    if (s[start] === '{') { const end = closing(s, start); return { end: end + 1, text: selectStockBranches(source.slice(start + 1, end), env) }; }
    const end = s.indexOf(';', start); return { end: end < 0 ? s.length : end + 1, text: source.slice(start, end < 0 ? s.length : end + 1) };
  };
  const pattern = /\bif\s*\(/g; let match: RegExpExecArray | null;
  while ((match = pattern.exec(s))) { if (match.index < cursor) continue; out += source.slice(cursor, match.index); const st = statement(match.index); out += st.text; cursor = st.end; pattern.lastIndex = cursor; }
  return out + source.slice(cursor);
}

export class OriginalStock {
  private cache = new Map<string, Promise<string>>();
  constructor(readonly assets: Assets) {}
  async source(def: PartDefinition) {
    if (!def.script) return '';
    const path = normalizePath(def.script).replace(/\/([^/]+)\.class$/, '/src/$1.java');
    if (!this.assets.byPath.has(path)) return '';
    if (!this.cache.has(path)) this.cache.set(path, this.assets.read(path).then(b => clean(new TextDecoder('windows-1252').decode(b))));
    return this.cache.get(path)!;
  }
  async environment(def: PartDefinition) {
    const env: Record<string, string | number> = { 'desc.power': 1 };
    let source = await this.source(def); const seen = new Set<string>();
    for (let depth = 0; depth < 8 && source; depth++) {
      for (const m of source.matchAll(/\b(make|model)\s*=\s*([A-Za-z_]\w*)\s*;/g)) if (env[`the_car.${m[1]}`] === undefined) env[`the_car.${m[1]}`] = m[2];
      const parent = /\bextends\s+(\w+)/.exec(source)?.[1]?.toLowerCase(); if (!parent || seen.has(parent)) break; seen.add(parent);
      const paths = [...this.assets.byPath.keys()].filter(p => p.endsWith(`/src/${parent}.java`)); if (paths.length !== 1) break;
      source = clean(new TextDecoder('windows-1252').decode(await this.assets.read(paths[0])));
    }
    return env;
  }
  async entries(def: PartDefinition, env: Record<string, string | number>, chassis = false): Promise<ResourceKey[]> {
    const src = await this.source(def), start = /\bvoid\s+addStockParts\s*\([^)]*\)\s*\{/.exec(mask(src));
    if (!start) return [];
    const p = start.index + start[0].length - 1, selected = selectStockBranches(src.slice(p + 1, closing(mask(src), p)), env), result: ResourceKey[] = [];
    const rid = /([\w.]+):0x([\da-f]+)r/ig;
    if (chassis) {
      for (const statement of selected.split(';')) {
        if (!/stock_parts_list_(?:E\s*\[|RGear_(?:suspensions|shocks|springs|brakes|sways|others)\s*\[)/.test(statement)) continue;
        const ref = [...statement.matchAll(rid)].at(-1); if (!ref) continue;
        const repeats = [...statement.matchAll(/stock_parts_list_\w+\s*\[\s*\d+\s*\]\s*=/g)].length;
        for (let i = 0; i < repeats; i++) result.push({ pack: ref[1].replaceAll('.', '/') + '.rpk', id: parseInt(ref[2], 16) });
      }
    } else for (const m of selected.matchAll(/\baddPart\s*\(\s*([\w.]+):0x([\da-f]+)r/ig)) result.push({ pack: m[1].replaceAll('.', '/') + '.rpk', id: parseInt(m[2], 16) });
    return result;
  }
  async profile(def: PartDefinition): Promise<MechanicalProfile | undefined> {
    const source = await this.source(def); if (!source) return;
    const parent = /\bextends\s+(\w+)/.exec(source)?.[1] ?? '';
    const kind = /Suspension/.test(parent) ? 'suspension' : /Spring$/.test(parent) ? 'spring' : /ShockAbsorber/.test(parent) ? 'shock' : /Brake/.test(parent) ? 'brake' : /Sway/.test(parent) ? 'sway' : /\/engines\//.test(def.cfgPath) ? 'engine' : undefined;
    if (!kind) return;
    const values: Record<string, number> = {};
    for (const m of source.matchAll(/\b(\w+(?:\[\d+\])?)\s*=\s*([^;{}]+);/g)) { const n = originalNumber(m[2]); if (n !== undefined && values[m[1]] === undefined) values[m[1]] = n; }
    const call = (name: string) => { const args = new RegExp(`wheel\\.${name}\\s*\\(([^)]+)\\)`).exec(source)?.[1]; if (!args) return; const a = args.split(',').map(originalNumber); return a.every(n => n !== undefined) ? a as number[] : undefined; };
    return { kind, source: def.script!, values, hub: call('setHub'), arm: call('setArm'), drive: /\bdrive_type\s*=\s*(\w+)/.exec(source)?.[1] };
  }
}
