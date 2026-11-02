import { jv, type JavaValue, type SlrrJvm } from 'slrr-jvm';

const owner = 'java.lang.Math';
const numeric = ['int', 'float'] as const;
const f32 = Math.fround;
const pi = f32(3.141592264175415);
const tau = f32(6.283185005187988);

/** Math methods used by the installed Java sources; state belongs to one game session. */
export class MathNative {
  private seed = 1;

  constructor(private readonly jvm: SlrrJvm) {
    jvm.natives.registerField(owner, 'PI', jv('float', pi));
    jvm.natives.registerField(owner, 'TAU', jv('float', tau));

    this.register('randomize', [], 'void', () => { this.seed = Date.now() >>> 0; });
    this.register('setrandseed', ['int'], 'void', ([seed]) => { this.seed = Number(seed.value) >>> 0; });
    this.register('random', [], 'float', () => this.random());
    this.register('chaos', [], 'float', () => this.chaos());
    this.register('siRandom', [], 'float', () => this.random() > 0.5 ? -this.random() : this.random());

    this.unary('abs', (value) => Math.abs(value), type => type);
    this.unary('sqrt', Math.sqrt);
    this.unary('sqr', value => value * value);
    this.unary('sin', (value, type) => Math.sin(type === 'int' ? value * pi / 180 : value));
    this.unary('cos', (value, type) => Math.cos(type === 'int' ? value * pi / 180 : value));
    this.unary('deg2rad', value => value * pi / 180);
    this.unary('rad2deg', value => value * 180 / pi);
    this.unary('round', value => Math.trunc(value) + (value - Math.trunc(value) >= 0.44545453786849976 ? 1 : 0), () => 'int');

    for (const left of numeric) for (const right of numeric) {
      this.register('pow', [left, right], 'float', ([a, b]) => Math.pow(Number(a.value), Number(b.value)));
    }
    for (const first of numeric) for (const second of numeric) for (const third of numeric) {
      this.register('section', [first, second, third], 'int', ([min, max, value]) =>
        Number(value.value) >= Number(min.value) && Number(value.value) <= Number(max.value) ? 1 : 0);
    }
    for (const arrayType of ['float[]', 'int[]']) {
      this.register('total', [arrayType], arrayType === 'int[]' ? 'int' : 'float', ([array]) => this.total(array));
      this.register('avg', [arrayType], 'float', ([array]) => {
        const items = this.array(array);
        return items.length ? this.total(array) / items.length : NaN;
      });
    }
    this.register('remDiv', ['int', 'int'], 'Number', ([dividend, divisor]) => {
      const x = Math.abs(Number(dividend.value) | 0), y = Math.abs(Number(divisor.value) | 0);
      if (!y) return null;
      const quotient = Math.trunc(x / y);
      return { className: 'java.lang.Number', fields: new Map([
        ['i', jv('int', quotient)], ['f', jv('float', f32(x - quotient * y))],
      ]) };
    });
  }

  private register(name: string, signature: string[], result: string, implementation: (args: readonly JavaValue[]) => unknown): void {
    this.jvm.natives.register(owner, name, signature, ({ args }) => {
      const value = implementation(args);
      return jv(result, result === 'float' ? f32(Number(value)) : value);
    });
  }

  private unary(name: string, fn: (value: number, type: 'int' | 'float') => number, result: (type: 'int' | 'float') => string = () => 'float'): void {
    for (const type of numeric)
      this.register(name, [type], result(type), ([value]) => fn(Number(value.value), type));
  }

  private array(value: JavaValue): number[] {
    if (!Array.isArray(value.value)) throw new Error(`Math array argument unavailable: ${value.type}`);
    return value.value.map(Number);
  }

  private total(value: JavaValue): number {
    return this.array(value).reduce((sum, number) => sum + number, 0);
  }

  private random(): number {
    this.seed = (Math.imul(this.seed, 214013) + 2531011) >>> 0;
    let result = (this.seed >>> 16) & 0x7fff;
    if (result === 0x7fff) result = 0x7ffe;
    return f32(result * f32(1 / 32767));
  }

  private chaos(): number {
    const count = Math.trunc(this.random() * f32(f32(Math.E * Math.E) * pi));
    if (count <= 0) return 0;
    const values = Array.from({ length: count }, () => this.random());
    for (let round = 0; round < count; round++) {
      const a = Math.trunc(this.random() * count), b = Math.trunc(this.random() * count);
      [values[a], values[b]] = [values[b], values[a]];
    }
    return values[Math.trunc(this.random() * count)];
  }
}
