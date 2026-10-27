import { jv, type JavaObject, type JavaValue, type SlrrJvm } from 'slrr-jvm';
import type { BootEvent } from './game-boot';

export interface GameTypeInstance {
  id: number;
  className: string;
  parentId: number | null;
  typeId: number;
  params: string | null;
  alias: string;
}

/** Minimal host-side game tree for GameType's built-in Java wrappers. */
export class GameTypeNative {
  private readonly nodes = new WeakMap<JavaObject, GameTypeInstance>();
  private nextId = 1;

  constructor(private readonly jvm: SlrrJvm, private readonly report: (event: BootEvent) => void) {
    const owner = 'java.lang.GameType';
    jvm.natives.register(owner, '<init>', [], () => jv('void', undefined));
    jvm.natives.register(owner, 'createNativeInstance', [], ({ receiver }) => this.create(receiver, null, 0, null, null));
    jvm.natives.register(owner, 'createNativeInstance', ['GameRef'], ({ receiver, args }) => this.create(receiver, args[0], 0, null, null));
    jvm.natives.register(owner, 'createNativeInstance', ['GameRef', 'int', 'String', 'String'], ({ receiver, args }) =>
      this.create(receiver, args[0], Number(args[1].value), args[2], args[3]));
  }

  get(receiver: JavaValue): GameTypeInstance | undefined {
    return this.nodes.get(this.object(receiver));
  }

  private object(receiver: JavaValue): JavaObject {
    const object = receiver.value as JavaObject | null;
    if (!object || !(object.fields instanceof Map) || !object.className)
      throw new Error(`GameType native receiver is not a Java object: ${receiver.type}`);
    return object;
  }

  private create(receiver: JavaValue, parent: JavaValue | null, typeId: number, params: JavaValue | null, alias: JavaValue | null): JavaValue {
    const object = this.object(receiver);
    if (this.nodes.has(object)) throw new Error(`GameType native instance already exists: ${object.className}`);
    const parentObject = parent?.value == null ? null : this.object(parent);
    const parentId = parentObject ? this.nodes.get(parentObject)?.id : null;
    if (parentObject && parentId === undefined) throw new Error('GameType native parent has no instance');
    if (!Number.isInteger(typeId) || typeId < 0) throw new Error(`Invalid GameType type ID: ${typeId}`);
    const node: GameTypeInstance = {
      id: this.nextId++,
      className: object.className,
      parentId: parentId ?? null,
      typeId,
      params: params?.value == null ? null : String(params.value),
      alias: alias?.value == null ? object.className.split('.').at(-1)! : String(alias.value),
    };
    this.nodes.set(object, node);
    this.report({ level: 'native', message: `GameType instance #${node.id}: ${node.className} (parent ${node.parentId ?? 'root'}, type ${node.typeId})` });
    return jv('void', undefined);
  }
}
