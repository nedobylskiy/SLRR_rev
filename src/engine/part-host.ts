import { NativeRegistry, type ScriptObject, type ScriptValue } from '../runtime/native-registry';
import { EnginePart, EngineWorld } from './world';

export const PART_CLASS = 'java.game.parts.Part';
/** Descriptors checked against the installed Part.class, including its dotted class names. */
export const PART_TOPOLOGY_NATIVES = [
  ['getSlots', '()I'], ['getSlotID', '(I)I'],
  ['partOnSlot', '(I)Ljava.game.parts.Part;'], ['slotIDOnSlot', '(I)I'],
] as const;

/** A script handle is a view of an existing world instance, never a second part tree. */
export class PartHost {
  readonly natives = new NativeRegistry();
  private handles = new WeakMap<EnginePart, ScriptObject>();
  private instances = new WeakMap<ScriptObject, EnginePart>();
  private disposed = false;
  constructor(readonly world: EngineWorld) {
    const methods = [
      (part: EnginePart) => part.definition.config.slots.length,
      (part: EnginePart, arg: number) => {
        if (arg === -1) return part.ownSlot ?? 0;
        const slot = part.definition.config.slots[arg];
        if (!slot) throw new Error(`Slot index out of range: ${arg}`);
        return slot.id;
      },
      (part: EnginePart, arg: number) => {
        const other = part.ownSlot === arg ? part.parent : part.children.get(arg);
        return other ? this.bind(other) : null;
      },
      (part: EnginePart, arg: number) => part.ownSlot === arg ? part.parentSlot ?? 0 : part.children.get(arg)?.ownSlot ?? 0,
    ];
    PART_TOPOLOGY_NATIVES.forEach(([name, signature], index) => {
      this.natives.register(PART_CLASS, name, signature, (receiver, args) => {
        const part = this.resolve(receiver);
        if (args.length !== (index === 0 ? 0 : 1)) throw new Error(`Invalid ${name} arguments`);
        const arg = index === 0 ? 0 : args[0];
        if (typeof arg !== 'number' || !Number.isInteger(arg) || arg < -0x80000000 || arg > 0x7fffffff) throw new Error('Java int argument required');
        return methods[index](part, arg);
      });
    });
  }
  bind(part: EnginePart): ScriptObject {
    this.live(part);
    let handle = this.handles.get(part);
    if (!handle) {
      // Class construction and inherited method dispatch remain VM responsibilities.
      handle = { className: PART_CLASS, fields: new Map<string, ScriptValue>() };
      this.handles.set(part, handle); this.instances.set(handle, part);
    }
    return handle;
  }
  private live(part: EnginePart) {
    if (this.disposed || this.world.disposed || part.world !== this.world || this.world.parts.get(part.id) !== part) throw new Error('Part host: instance outside live world');
  }
  private resolve(handle: ScriptObject | null) {
    const part = handle && this.instances.get(handle);
    if (!part) throw new Error('Part host: unknown script handle');
    this.live(part); return part;
  }
  dispose() { this.disposed = true; this.handles = new WeakMap(); this.instances = new WeakMap(); }
}
