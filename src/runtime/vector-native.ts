import { jv, type JavaValue, type SlrrJvm } from 'slrr-jvm';

type Vec = { x: number; y: number; z: number };
type Angles = { y: number; p: number; r: number };

/** Native 3D operations from SL2's Vector3/Ypr classes. Angles are radians. */
export class VectorNative {
  constructor(private readonly jvm: SlrrJvm) {
    const vector = 'java.lang.Vector3', ypr = 'java.lang.Ypr';
    const read = (value: JavaValue): Vec => ({ x: this.field(value, 'x'), y: this.field(value, 'y'), z: this.field(value, 'z') });
    const angles = (value: JavaValue): Angles => ({ y: this.field(value, 'y'), p: this.field(value, 'p'), r: this.field(value, 'r') });
    const write = (value: JavaValue, v: Vec) => { this.put(value, 'x', v.x); this.put(value, 'y', v.y); this.put(value, 'z', v.z); };
    const writeAngles = (value: JavaValue, a: Angles) => { this.put(value, 'y', a.y); this.put(value, 'p', a.p); this.put(value, 'r', a.r); };
    const matrix = ({ y, p, r }: Angles) => {
      const sy = Math.sin(y), cy = Math.cos(y), sp = Math.sin(p), cp = Math.cos(p), sr = Math.sin(r), cr = Math.cos(r);
      return [sr * sp * sy + cr * cy, cr * sp * sy - sr * cy, cp * sy,
        sr * cp, cr * cp, -sp,
        sr * sp * cy - cr * sy, cr * sp * cy + sr * sy, cp * cy];
    };
    const transform = (m: number[], v: Vec): Vec => ({
      x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
      y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
      z: m[6] * v.x + m[7] * v.y + m[8] * v.z,
    });
    jvm.natives.register(vector, '<init>', ['Ypr'], ({ receiver, args }) => {
      const m = matrix(angles(args[0]));
      write(receiver, { x: -m[2], y: -m[5], z: -m[8] });
      return jv('void', undefined);
    });
    jvm.natives.register(vector, 'length', [], ({ receiver }) => {
      const v = read(receiver); return jv('float', Math.fround(Math.hypot(v.x, v.y, v.z)));
    });
    jvm.natives.register(vector, 'distance', ['Vector3'], ({ receiver, args }) => {
      const a = read(receiver), b = read(args[0]);
      return jv('float', Math.fround(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)));
    });
    jvm.natives.register(vector, 'normalize', [], ({ receiver }) => {
      const v = read(receiver), length = Math.hypot(v.x, v.y, v.z);
      if (length) write(receiver, { x: v.x / length, y: v.y / length, z: v.z / length });
      return jv('void', undefined);
    });
    jvm.natives.register(vector, 'rotate', ['Ypr'], ({ receiver, args }) => {
      write(receiver, transform(matrix(angles(args[0])), read(receiver)));
      return receiver;
    });
    jvm.natives.register(vector, 'rotate', ['Vector3', 'float'], ({ receiver, args }) => {
      const axis = read(args[0]), length = Math.hypot(axis.x, axis.y, axis.z);
      if (length * length < 1e-6) return receiver;
      const x = axis.x / length, y = axis.y / length, z = axis.z / length;
      const angle = Number(args[1].value), c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
      write(receiver, transform([
        c + x * x * t, x * y * t - z * s, x * z * t + y * s,
        y * x * t + z * s, c + y * y * t, y * z * t - x * s,
        z * x * t - y * s, z * y * t + x * s, c + z * z * t,
      ], read(receiver)));
      return receiver;
    });
    jvm.natives.register(ypr, '<init>', ['Vector3'], ({ receiver, args }) => {
      const v = read(args[0]);
      writeAngles(receiver, { y: v.x === 0 && v.z === 0 ? 0 : Math.atan2(-v.x, -v.z),
        p: v.x === 0 && v.z === 0 && v.y === 0 ? -Math.PI / 2 : Math.atan2(v.y, Math.hypot(v.x, v.z)), r: 0 });
      return jv('void', undefined);
    });
    jvm.natives.register(ypr, 'mul', ['Ypr'], ({ receiver, args }) => {
      const a = matrix(angles(receiver)), b = matrix(angles(args[0]));
      const m = Array.from({ length: 9 }, (_, i) =>
        b[Math.floor(i / 3) * 3] * a[i % 3] + b[Math.floor(i / 3) * 3 + 1] * a[3 + i % 3]
        + b[Math.floor(i / 3) * 3 + 2] * a[6 + i % 3]);
      const roll = Math.atan2(m[3], m[4]);
      if (m[8] === 0 && m[2] === 0) {
        writeAngles(receiver, { y: Math.atan2(m[0], -m[1]), p: Math.PI, r: 0 });
      } else {
        const cr = Math.cos(roll), term = cr * m[5];
        writeAngles(receiver, { y: Math.atan2(m[2], m[8]),
          p: cr > 0 ? Math.atan2(-term, m[4]) : Math.atan2(term, -m[4]), r: roll });
      }
      return jv('void', undefined);
    });
  }

  private field(value: JavaValue, name: string): number { return Number(this.jvm.get(value, name).value); }
  private put(value: JavaValue, name: string, number: number): void { this.jvm.set(value, name, jv('float', Math.fround(number))); }
}
