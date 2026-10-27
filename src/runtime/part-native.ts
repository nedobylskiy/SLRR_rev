import { jv, type JavaObject, type JavaValue, type SlrrJvm } from 'slrr-jvm';

/** Native condition values owned by each interpreted SLRR part. */
export class PartNative {
  private readonly maxWear = new WeakMap<JavaObject, number>();
  private readonly wear = new WeakMap<JavaObject, number>();

  constructor(jvm: SlrrJvm) {
    const owner = 'java.game.parts.Part';
    jvm.natives.register(owner, 'getWear', [], ({ receiver }) =>
      jv('float', this.wear.get(receiver.value as JavaObject) ?? 1));
    jvm.natives.register(owner, 'setWear', ['float'], ({ receiver, args }) => {
      const value = Math.fround(Number(args[0].value));
      if (!Number.isFinite(value)) throw new Error('Invalid part wear');
      this.wear.set(receiver.value as JavaObject, value);
      return jv('float', value);
    });
    // Deformation is held at pristine condition until Java parts are linked to the physics bodies.
    jvm.natives.register(owner, 'getTear', [], () => jv('float', 1));
    jvm.natives.register(owner, 'setTear', ['float'], ({ args }) => jv('float', Math.fround(Number(args[0].value))));
    jvm.natives.register(owner, 'setMaxWear', ['float'], ({ receiver, args }) => {
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
