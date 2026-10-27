import { jv, type JavaObject, type JavaValue, type SlrrJvm } from 'slrr-jvm';

/** Steering limits owned by each interpreted Chassis instance. */
export class ChassisNative {
  private readonly initialByClass = new Map<string, { maxSteer: number; ackermann: number }>();
  private readonly maxSteer = new WeakMap<JavaObject, number>();
  private readonly ackermann = new WeakMap<JavaObject, number>();

  constructor(jvm: SlrrJvm) {
    const owner = 'java.game.parts.bodypart.Chassis';
    jvm.natives.register(owner, 'getMaxSteer', [], ({ receiver }) =>
      jv('float', this.getMaxSteer(receiver)));
    jvm.natives.register(owner, 'setMaxSteer', ['float'], ({ receiver, args }) => {
      const value = Number(args[0].value);
      if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid chassis maximum steering angle');
      this.maxSteer.set(receiver.value as JavaObject, value);
      return jv('void', undefined);
    });
    jvm.natives.register(owner, 'setAckermann', ['float'], ({ receiver, args }) => {
      const value = Number(args[0].value);
      if (!Number.isFinite(value) || value < 0) throw new Error('Invalid chassis Ackermann length');
      this.ackermann.set(receiver.value as JavaObject, value);
      return jv('void', undefined);
    });
  }

  /** Called immediately before the resource's Java constructor executes. */
  prepare(className: string, maxSteer: number, ackermann = 2): void {
    this.initialByClass.set(className, { maxSteer, ackermann });
  }

  getMaxSteer(receiver: JavaValue): number {
    const object = receiver.value as JavaObject;
    if (!object || !object.className) throw new Error('Chassis receiver is not a Java object');
    const current = this.maxSteer.get(object);
    if (current !== undefined) return current;
    const initial = this.initialByClass.get(object.className)?.maxSteer ?? 0.7;
    this.maxSteer.set(object, initial);
    return initial;
  }

  steering(receiver: JavaValue): { maxSteer: number; ackermann: number } {
    const object = receiver.value as JavaObject;
    return { maxSteer: this.getMaxSteer(receiver),
      ackermann: this.ackermann.get(object) ?? this.initialByClass.get(object.className)?.ackermann ?? 2 };
  }
}
