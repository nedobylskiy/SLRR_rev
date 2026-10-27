import { jv, type JavaObject, type JavaValue, type SlrrJvm } from 'slrr-jvm';

export interface DynoCurve {
  rpmStep: number;
  torque: readonly number[];
  watts: readonly number[];
  nitroTorque: readonly number[];
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback;

/** Java DynoData adapter. Geometry/table behavior follows SL2; combustion uses the recovered soft curve. */
export class DynoNative {
  private readonly curves = new WeakMap<JavaObject, DynoCurve>();

  constructor(private readonly jvm: SlrrJvm) {
    const owner = 'java.game.parts.DynoData';
    jvm.natives.register(owner, 'newNative', [], ({ receiver }) => {
      if (!this.curves.has(receiver.value as JavaObject))
        this.curves.set(receiver.value as JavaObject, { rpmStep: 0, torque: [], watts: [], nitroTorque: [] });
      return jv('void', undefined);
    });
    jvm.natives.register(owner, 'deleteNative', [], ({ receiver }) => {
      this.curves.delete(receiver.value as JavaObject);
      return jv('void', undefined);
    });
    for (const signature of [['float'], ['int']])
      jvm.natives.register(owner, 'calcDyno', signature, ({ receiver, args }) =>
        jv('float', this.calculate(receiver, Number(args[0].value))));
    for (const rpmType of ['float', 'int']) for (const nitroType of ['float', 'int']) {
      jvm.natives.register(owner, 'getTorque', [rpmType, nitroType], ({ receiver, args }) =>
        jv('float', this.sample(receiver, Number(args[0].value), 'torque')));
      jvm.natives.register(owner, 'getHP', [rpmType, nitroType], ({ receiver, args }) =>
        jv('float', this.sample(receiver, Number(args[0].value), 'watts')));
    }
  }

  curve(receiver: JavaValue): DynoCurve | undefined {
    return this.curves.get(receiver.value as JavaObject);
  }

  private field(receiver: JavaValue, name: string, fallback = 0): number {
    const value = Number((receiver.value as JavaObject).fields.get(name)?.value);
    return finite(value, fallback);
  }

  private set(receiver: JavaValue, name: string, value: number): void {
    this.jvm.set(receiver, name, jv('float', Math.fround(finite(value))));
  }

  private calculate(receiver: JavaValue, requestedSteps: number): number {
    if (!Number.isFinite(requestedSteps) || requestedSteps <= 0) throw new Error('Invalid DynoData table size');
    const cylinders = this.field(receiver, 'cylinders', 4);
    const bore = this.field(receiver, 'bore', 0.082);
    const stroke = this.field(receiver, 'stroke', 0.09);
    const clearance = this.field(receiver, 'Vmin', 0.00005);
    const cylinderVolume = Math.PI * (bore / 2) ** 2 * stroke;
    const displacement = cylinderVolume * cylinders;
    const compression = clearance > 0 ? (cylinderVolume + clearance) / clearance : 0;
    let maxRpm = this.field(receiver, 'maxRPM');
    if (maxRpm <= 0) {
      maxRpm = stroke > 0 ? 45 / (stroke / 2) * 9.5492964 : 0;
      this.set(receiver, 'maxRPM', maxRpm);
    }
    const rpmStep = Math.max(1, Math.trunc(Math.max(1, maxRpm / requestedSteps)));
    const count = clamp(Math.trunc(maxRpm / rpmStep), 1, 1000);
    const ambient = 293.15 * (this.field(receiver, 'intercooling', 1) || 1);
    const ambientScale = (temperature: number) => temperature > 1 ? 293.15 / temperature : 1;
    const mixtureRatio = this.field(receiver, 'mixture_ratio', 14);
    const burnTime = Math.max(this.field(receiver, 'time_burn', 0.003), 0.000001);
    let peak = Math.max(displacement * 1000, 0.2) * 85;
    peak *= this.field(receiver, 'mixture_H', 1_000_000) / 1_000_000;
    if (mixtureRatio > 0) peak *= 15 / (mixtureRatio + 1);
    peak *= ambientScale(ambient);
    if (compression > 1) peak *= compression / 10.5;
    peak *= burnTime / 0.003;
    const valveScale = (prefix: 'in' | 'out', stock: number) => {
      const minimum = this.field(receiver, `${prefix}_min`, 0.005) || 0.005;
      const maximum = this.field(receiver, `${prefix}_max`, 0.8) || 0.8;
      const opening = this.field(receiver, `time_${prefix}_open`);
      const closing = this.field(receiver, `time_${prefix}_close`);
      const duty = closing - opening;
      return duty > 0 ? (minimum * (1 - duty) + maximum * duty) / stock : 1;
    };
    peak *= valveScale('in', 0.202955) * valveScale('out', 0.1958);

    const turboMul = this.field(receiver, 'rpm_turbo_mul');
    const turboOpt = this.field(receiver, 'rpm_turbo_opt');
    const turboRange = this.field(receiver, 'rpm_turbo_range');
    const turboMax = this.field(receiver, 'P_turbo_max');
    const turboWaste = this.field(receiver, 'P_turbo_waste', turboMax) || turboMax;
    const sparkBase = this.field(receiver, 'time_spark_min', 0.48) || 0.48;
    const sparkInc = this.field(receiver, 'time_spark_inc');
    const sparkRpm0 = this.field(receiver, 'time_spark_RPM0');
    const sparkRpm1 = this.field(receiver, 'time_spark_RPM1');
    const maxAir = this.field(receiver, 'max_air_consumption');
    const maxFuel = this.field(receiver, 'max_fuel_consumption');
    const fill = (sourcePeak: number, temperature: number) => {
      const torque = Array.from({ length: count }, () => 0);
      const watts = Array.from({ length: count }, () => 0);
      let maxTorque = 0, maxTorqueRpm = 0, maxHp = 0, maxHpRpm = 0;
      for (let index = 1; index < count; index++) {
        const rpm = index * rpmStep;
        const position = index / (count - 1);
        let nm = sourcePeak * Math.max(0, Math.sin(Math.PI * position ** 1.8));
        let boost = 0;
        if (turboMul > 0 && turboRange > 0) {
          const fade = Math.max(0, 1 - Math.abs(rpm * turboMul - turboOpt) / turboRange);
          boost = Math.min(fade * turboMax, turboWaste);
          nm *= Math.max(0, 1 + boost) ** 1.5;
        }
        const air = 1.2929 * ambientScale(temperature) * (1 + boost) * displacement * rpm / 120;
        if (maxAir > 0 && air > maxAir) nm *= maxAir / air;
        if (maxFuel > 0 && mixtureRatio > 0 && air / mixtureRatio > maxFuel)
          nm *= maxFuel * mixtureRatio / air;
        nm *= 1 - Math.min(0.9, rpm * 0.00005);
        if (sparkRpm1 > sparkRpm0)
          nm *= (sparkBase + clamp((rpm - sparkRpm0) / (sparkRpm1 - sparkRpm0), 0, 1) * sparkInc) / sparkBase;
        const heatStep = (1 / (rpm / 120)) * 0.0043290043;
        nm *= 1 - Math.min(1, heatStep / 95);
        nm = Math.max(0, finite(nm));
        torque[index] = nm;
        watts[index] = Math.max(0, nm * rpm / 7.5 - rpm ** 3 * 2e-8);
        if (nm > maxTorque) { maxTorque = nm; maxTorqueRpm = rpm; }
        const hp = watts[index] * 0.001341;
        if (hp > maxHp) { maxHp = hp; maxHpRpm = rpm; }
      }
      return { torque, watts, maxTorque, maxTorqueRpm, maxHp, maxHpRpm };
    };

    const regular = fill(peak, ambient);
    const nitroHeat = this.field(receiver, 'nitro_H', 1);
    const nitroCooling = this.field(receiver, 'nitro_cooling', 1);
    const nitro = nitroHeat > 1.0001 || nitroCooling > 1.0001
      ? fill(peak / ambientScale(ambient) * nitroHeat * ambientScale(293.15 * nitroCooling),
        293.15 * nitroCooling) : null;
    this.curves.set(receiver.value as JavaObject, {
      rpmStep, torque: regular.torque, watts: regular.watts, nitroTorque: nitro?.torque ?? [],
    });
    this.set(receiver, 'Displacement', displacement);
    this.set(receiver, 'Compression', compression);
    this.set(receiver, 'maxTorque', regular.maxTorque);
    this.set(receiver, 'RPM_maxTorque', regular.maxTorqueRpm);
    this.set(receiver, 'maxHP', regular.maxHp);
    this.set(receiver, 'RPM_maxHP', regular.maxHpRpm);
    return 0;
  }

  private sample(receiver: JavaValue, rpm: number, table: 'torque' | 'watts'): number {
    const curve = this.curve(receiver);
    if (!curve || rpm < 0 || curve.rpmStep <= 0 || curve[table].length < 2) return 0;
    const index = Math.floor(rpm / curve.rpmStep);
    if (index + 1 >= curve[table].length) return 0;
    const fraction = rpm / curve.rpmStep - index;
    return curve[table][index] * (1 - fraction) + curve[table][index + 1] * fraction;
  }
}
