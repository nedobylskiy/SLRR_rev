import { jv, type JavaObject, type JavaValue, type SlrrJvm } from 'slrr-jvm';

/** Native condition limits owned by SLRR part instances. */
export class PartNative {
  private readonly maxWear = new WeakMap<JavaObject, number>();

  constructor(jvm: SlrrJvm) {
    jvm.natives.register('java.game.parts.Part', 'setMaxWear', ['float'], ({ receiver, args }) => {
      const limit = Number(args[0].value);
      if (!Number.isFinite(limit) || limit < 0) throw new Error('Invalid part maximum wear');
      this.maxWear.set(receiver.value as JavaObject, limit);
      return jv('void', undefined);
    });
  }

  wearLimit(receiver: JavaValue): number | undefined {
    return this.maxWear.get(receiver.value as JavaObject);
  }
}
