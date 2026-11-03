import { jv, type JavaObject, type JavaValue, type SlrrJvm } from 'slrr-jvm';
import { CombustionModel, type CombustionResult } from '../engine/combustion-model';

export type DynoCurve = Pick<CombustionResult, 'rpmStep' | 'torque' | 'watts' | 'nitroTorque' | 'nitroWatts'>;

/** Original Java DynoData fields drive the recovered combustion-cycle model. */
export class DynoNative {
  private readonly models = new WeakMap<JavaObject, CombustionModel>();
  private readonly curves = new WeakMap<JavaObject, CombustionResult>();
  constructor(private readonly jvm: SlrrJvm, dynoFor?: (chassis: JavaValue) => JavaValue | undefined) {
    const owner = 'java.game.parts.DynoData';
    jvm.natives.register('java.game.parts.bodypart.Chassis', 'getTorque', ['float','float'], ({receiver,args}) => {
      const chassis = receiver.value as JavaObject;
      const dyno = dynoFor?.(receiver) ?? chassis.fields.get('dyno');
      const curve = dyno?.value ? this.curve(dyno) : undefined;
      if (!curve) return jv('float',0);
      const rpm = Number(args[0].value), blend = Number(args[1].value);
      return jv('float',this.sample(dyno!,rpm,blend));
    });
    jvm.natives.register(owner, 'newNative', [], ({ receiver }) => {
      if (!this.models.has(receiver.value as JavaObject)) this.models.set(receiver.value as JavaObject, new CombustionModel());
      return jv('void', undefined);
    });
    jvm.natives.register(owner, 'deleteNative', [], ({ receiver }) => {
      this.models.delete(receiver.value as JavaObject); this.curves.delete(receiver.value as JavaObject);
      return jv('void', undefined);
    });
    for (const signature of [['float'], ['int']])
      jvm.natives.register(owner, 'calcDyno', signature, ({ receiver, args }) => {
        const object = receiver.value as JavaObject;
        const model = this.models.get(object) ?? new CombustionModel();
        const fields = Object.fromEntries([...object.fields].filter(([, value]) => typeof value.value === 'number')
          .map(([name, value]) => [name, Number(value.value)]));
        const result = model.calculate(fields, Number(args[0].value));
        this.models.set(object, model); this.curves.set(object, result);
        const outputs = { Displacement: result.displacement, Compression: result.compression,
          maxTorque: result.maxTorque, RPM_maxTorque: result.torqueRpm, maxHP: result.maxHp, RPM_maxHP: result.hpRpm };
        for (const [name, value] of Object.entries(outputs)) this.jvm.set(receiver, name, jv('float', Math.fround(value)));
        if (!(fields.maxRPM > 0)) this.jvm.set(receiver, 'maxRPM', jv('float', result.maximumRpm));
        return jv('float', 0);
      });
    for (const rpm of ['float', 'int']) for (const nitro of ['float', 'int']) {
      jvm.natives.register(owner, 'getTorque', [rpm, nitro], ({ receiver, args }) =>
        jv('float', this.sample(receiver, Number(args[0].value), 0)));
      // Despite its name, getHP returns the native watt table.
      jvm.natives.register(owner, 'getHP', [rpm, nitro], ({ receiver, args }) =>
        jv('float', this.sample(receiver, Number(args[0].value), 0, true)));
    }
  }
  curve(receiver: JavaValue): DynoCurve | undefined { return this.curves.get(receiver.value as JavaObject); }
  sample(receiver: JavaValue, rpm: number, nitro = 0, watts = false): number {
    const curve = this.curves.get(receiver.value as JavaObject);
    if (!curve || !Number.isFinite(rpm) || !Number.isFinite(nitro) || rpm < 0) return 0;
    const sample = (table: readonly number[]) => {
      const index = Math.floor(rpm / curve.rpmStep), fraction = rpm / curve.rpmStep - index;
      return index + 1 >= table.length ? 0 : table[index] * (1 - fraction) + table[index + 1] * fraction;
    };
    const primary = sample(watts ? curve.watts : curve.torque);
    const secondary = watts ? curve.nitroWatts : curve.nitroTorque;
    return Math.fround(secondary.length ? primary * (1 - nitro) + sample(secondary) * nitro : primary);
  }
}
