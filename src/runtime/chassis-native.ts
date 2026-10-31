import { jv, type JavaObject, type JavaValue, type SlrrJvm } from 'slrr-jvm';
import type { GameTypeNative } from './game-type-native';
import type { ResourceObject } from './resource-object';
import { createWheelRefState, registerWheelRefNatives, type WheelRefState } from './wheel-ref-native';

const projectedFields = [
  'engine_inertia', 'engine_mass', 'engine_rpm_idle', 'maxRPM', 'RPM_limit',
  'starter_torque', 'engine_friction_fwd', 'engine_friction_rev', 'gears',
  'rearend_ratio', 'ClutchF', 'tank_nitro', 'consumption_nitro',
  'C_drag', 'wheels', 'drive_type', 'diff_lock',
] as const;

export interface ChassisUpdateState {
  revision: number;
  parameters: Readonly<Record<string, number>>;
  ratios: readonly number[];
  descendantPartIds: readonly number[];
}

export interface ScriptSfxItem {
  resourceId: number; pack: string | null; pitch: number;
  minRpm: number; maxRpm: number; minVolume: number; maxVolume: number;
}
interface ScriptSfxTable { items: ScriptSfxItem[] }

/** Steering limits owned by each interpreted Chassis instance. */
export class ChassisNative {
  private readonly initialByClass = new Map<string, { maxSteer: number; ackermann: number }>();
  private readonly maxSteer = new WeakMap<JavaObject, number>();
  private readonly ackermann = new WeakMap<JavaObject, number>();
  private readonly updates = new WeakMap<JavaObject, ChassisUpdateState>();
  private readonly updating = new WeakSet<JavaObject>();
  private readonly wheels = new WeakMap<JavaObject, WheelRefState[]>();
  private readonly wheelHandles = new WeakMap<JavaObject, WheelRefState>();
  private readonly sfxTables = new WeakMap<JavaObject, Map<number, JavaValue>>();
  private readonly sfxTableStates = new WeakMap<JavaObject, ScriptSfxTable>();
  private readonly exhaustMinVolume = new WeakMap<JavaObject, number>();
  private readonly steerWheel = new WeakMap<JavaObject, [number, number]>();

  constructor(jvm: SlrrJvm, private readonly gameTypes: GameTypeNative) {
    const owner = 'java.game.parts.bodypart.Chassis';
    jvm.natives.register(owner, 'getSfxTable', ['int'], ({ receiver, args }) => {
      const id = Number(args[0].value);
      if (!Number.isInteger(id) || id < 0) return jv('SfxTable', null);
      const object = receiver.value as JavaObject;
      let tables = this.sfxTables.get(object);
      if (!tables) { tables = new Map(); this.sfxTables.set(object, tables); }
      let table = tables.get(id);
      if (!table) {
        const handle: JavaObject = { className: 'java.game.parts.SfxTable', fields: new Map() };
        table = jv('SfxTable', handle);
        this.sfxTableStates.set(handle, { items: [] });
        tables.set(id, table);
      }
      return table;
    });
    jvm.natives.register(owner, 'setSfxExhaustMinVol', ['float'], ({ receiver, args }) => {
      this.exhaustMinVolume.set(receiver.value as JavaObject, Number(args[0].value));
      return jv('void', undefined);
    });
    const sfx = 'java.game.parts.SfxTable';
    jvm.natives.register(sfx, 'getItems', [], ({ receiver }) =>
      jv('int', this.sfxTable(receiver).items.length));
    jvm.natives.register(sfx, 'clear', [], ({ receiver }) => {
      this.sfxTable(receiver).items.length = 0;
      return jv('void', undefined);
    });
    jvm.natives.register(sfx, 'addItem', ['ResourceRef', 'float', 'float', 'float', 'float', 'float'],
      ({ receiver, args }) => {
        const resource = this.gameTypes.getResource(args[0]);
        this.sfxTable(receiver).items.push({
          resourceId: resource?.resourceId ?? Number(args[0].resourceId ?? 0),
          pack: resource?.resourcePack ?? args[0].resource?.pack ?? null,
          pitch: Number(args[1].value), minRpm: Number(args[2].value), maxRpm: Number(args[3].value),
          minVolume: Number(args[4].value), maxVolume: Number(args[5].value),
        });
        return jv('void', undefined);
      });
    registerWheelRefNatives(jvm.natives, 'java.game.parts.WheelRef', receiver => {
      const state = this.wheelHandles.get(receiver.value as JavaObject);
      if (!state) throw new Error('WheelRef is not bound to a chassis wheel');
      return state;
    });
    jvm.natives.register(owner, 'getWheels', [], ({ receiver }) => jv('int', this.wheelCount(receiver)));
    jvm.natives.register(owner, 'getWheel', ['int'], ({ receiver, args }) => {
      const index = Number(args[0].value);
      const count = this.wheelCount(receiver);
      if (!Number.isInteger(index) || index < 0 || index >= count) return jv('WheelRef', null);
      const object = receiver.value as JavaObject;
      let states = this.wheels.get(object);
      if (!states) { states = []; this.wheels.set(object, states); }
      const state = states[index] ??= createWheelRefState();
      const wheel: JavaObject = { className: 'java.game.parts.WheelRef', fields: new Map() };
      this.wheelHandles.set(wheel, state);
      return jv('WheelRef', wheel);
    });
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
    jvm.natives.register(owner, 'setSteerWheel', ['float', 'float'], ({ receiver, args }) => {
      const values = args.map(arg => Number(arg.value)) as [number, number];
      if (values.some(value => !Number.isFinite(value))) throw new Error('Invalid steering wheel motion');
      this.steerWheel.set(receiver.value as JavaObject, values);
      return jv('void', undefined);
    });
    // Run the original Java recalculation, then expose its fields for the future wheel/part physics fold.
    jvm.natives.registerAsync(owner, 'forceUpdate', [], async ({ receiver }) => {
      const object = receiver.value as JavaObject;
      const chassis = this.gameTypes.get(receiver);
      if (!chassis) return jv('void', undefined);
      if (this.updating.has(object)) throw new Error('Recursive Chassis.forceUpdate');
      this.updating.add(object);
      try {
        if (Number(object.fields.get('suspend_update')?.value ?? 0) === 0)
          await jvm.invokeAsync(receiver, 'updatevariables');
        const parameters: Record<string, number> = {};
        for (const name of projectedFields) {
          const value = object.fields.get(name);
          if (value && typeof value.value === 'number' && Number.isFinite(value.value))
            parameters[name] = value.value;
        }
        const ratio = object.fields.get('ratio')?.value;
        const ratios = Array.isArray(ratio) ? ratio.map(value =>
          typeof value === 'number' ? value : Number((value as JavaValue).value)) : [];
        const descendantPartIds: number[] = [];
        const isPart = (node: ResourceObject): boolean => {
          for (let name: string | null = node.className; name; name = jvm.parent(name))
            if (name === 'java.game.parts.Part') return true;
          return false;
        };
        const visit = (node: ResourceObject): void => {
          for (const child of node.children) {
            if (isPart(child) && child.resourceId) descendantPartIds.push(child.resourceId);
            visit(child);
          }
        };
        visit(chassis);
        this.updates.set(object, {
          revision: (this.updates.get(object)?.revision ?? 0) + 1,
          parameters, ratios, descendantPartIds,
        });
        return jv('void', undefined);
      } finally { this.updating.delete(object); }
    });
  }

  updateState(receiver: JavaValue): ChassisUpdateState | undefined {
    return this.updates.get(receiver.value as JavaObject);
  }

  scriptSfx(receiver: JavaValue, id: number): readonly ScriptSfxItem[] {
    const table = this.sfxTables.get(receiver.value as JavaObject)?.get(id);
    return table ? [...this.sfxTable(table).items] : [];
  }

  scriptExhaustMinVolume(receiver: JavaValue): number {
    return this.exhaustMinVolume.get(receiver.value as JavaObject) ?? 0;
  }

  private sfxTable(receiver: JavaValue): ScriptSfxTable {
    const state = this.sfxTableStates.get(receiver.value as JavaObject);
    if (!state) throw new Error('SfxTable is not bound to a chassis');
    return state;
  }

  wheelState(receiver: JavaValue, index: number): WheelRefState | undefined {
    return this.wheels.get(receiver.value as JavaObject)?.[index];
  }

  private wheelCount(receiver: JavaValue): number {
    if (!this.gameTypes.get(receiver)) return 0;
    const count = Number((receiver.value as JavaObject).fields.get('wheels')?.value ?? 0);
    return Number.isInteger(count) && count > 0 ? count : 0;
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
