import { jv, type JavaObject, type JavaValue, type SlrrJvm } from 'slrr-jvm';
import type { GameTypeNative } from './game-type-native';
import type { ResourceObject } from './resource-object';

/** Native condition values owned by each interpreted SLRR part. */
export class PartNative {
  private readonly maxWear = new WeakMap<JavaObject, number>();
  private readonly wear = new WeakMap<JavaObject, number>();
  private readonly texture = new WeakMap<JavaObject, number>();

  constructor(jvm: SlrrJvm, gameTypes: GameTypeNative) {
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
    jvm.natives.register(owner, 'getTexture', [], ({ receiver }) =>
      jv('int', this.texture.get(receiver.value as JavaObject) ?? 0));
    jvm.natives.register(owner, 'setTexture', ['int'], ({ receiver, args }) => {
      const id = Number(args[0].value);
      if (!Number.isInteger(id)) throw new Error('Invalid part texture resource ID');
      this.texture.set(receiver.value as JavaObject, id | 0);
      // The original native reports success even when no render object is bound yet.
      return jv('int', 1);
    });
    jvm.natives.register(owner, 'getCar', [], ({ receiver }) => {
      for (let node: ResourceObject | null | undefined = gameTypes.get(receiver); node; node = node.parent) {
        let className: string | null = node.className;
        while (className) {
          if (className === 'java.game.parts.bodypart.Chassis') return jv('int', node.resourceId);
          className = jvm.parent(className);
        }
      }
      return jv('int', 0);
    });
  }

  wearLimit(receiver: JavaValue): number | undefined {
    return this.maxWear.get(receiver.value as JavaObject);
  }
}
