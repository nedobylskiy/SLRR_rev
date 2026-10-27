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

/** Steering limits owned by each interpreted Chassis instance. */
export class ChassisNative {
  private readonly initialByClass = new Map<string, { maxSteer: number; ackermann: number }>();
  private readonly maxSteer = new WeakMap<JavaObject, number>();
  private readonly ackermann = new WeakMap<JavaObject, number>();
  private readonly updates = new WeakMap<JavaObject, ChassisUpdateState>();
  private readonly updating = new WeakSet<JavaObject>();
  private readonly wheels = new WeakMap<JavaObject, WheelRefState[]>();
  private readonly wheelHandles = new WeakMap<JavaObject, WheelRefState>();

  constructor(jvm: SlrrJvm, private readonly gameTypes: GameTypeNative) {
    const owner = 'java.game.parts.bodypart.Chassis';
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
