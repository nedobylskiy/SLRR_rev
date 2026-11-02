/** Build-specific SLRR float literal conversion, shared by Node and browsers. */
export type FloatMode = 'A' | 'B' | 'C' | 'D';

const f32 = Math.fround;
const tenth = f32(0.1);
function bitPattern(value: number): number {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value, true);
  return view.getUint32(0, true);
}

export function floatLiteralBits(text: string, mode: FloatMode = 'B'): number {
  const clean = text.replace(/[fFdD]$/, '');
  const match = /^(\d*)\.(\d*)$/.exec(clean);
  if (!match) return bitPattern(f32(Number(clean)));
  const [, integer, fractionRaw] = match;
  if (!integer) return 0;
  let whole = 0;
  for (const char of integer) whole = (Math.imul(whole, 10) + (char.charCodeAt(0) - 48)) >>> 0;
  const fraction = fractionRaw.slice(0, 1024);
  let value = mode === 'D' ? whole : f32(whole);
  let scale = mode === 'B' || mode === 'D' ? tenth : 1;
  for (const char of fraction) {
    const digit = char.charCodeAt(0) - 48;
    if (mode === 'B') {
      const part = f32(digit * scale);
      scale = f32(scale * tenth);
      value = f32(value + part);
    } else if (mode === 'C') {
      scale = f32(scale / 10);
      value = f32(value + digit * scale);
    } else if (mode === 'D') {
      value += digit * scale;
      scale /= 10;
    } else {
      scale = f32(scale / 10);
      value = f32(value + f32(digit * scale));
    }
  }
  return bitPattern(value);
}
