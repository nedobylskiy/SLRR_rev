import { JavaNativeRegistry, JavaSourceMachine, jv, parseSourceClass, type JavaHost, type JavaValue } from 'slrr-jvm';
import { callWheelRefNative, createWheelRefState, registerWheelRefNatives, type WheelRefState } from './wheel-ref-native';

/** Execute the original Tyre.java calculation methods against a WheelRef host object. */
export function executeTyreSource(source: string, setup: readonly number[] | string, wheelId: number): WheelRefState {
  if (typeof setup !== 'string' && (setup.length !== 6 || setup.some(value => !Number.isFinite(value)))) throw new Error('Invalid original SetupTyre arguments');
  const parsed = parseSourceClass(source, new Set(['SetupTyre', 'SetupRubber', 'SetInflation']), 'Tyre');
  const subclassName = typeof setup === 'string' ? /\bclass\s+(\w+)\s+extends\s+Tyre\b/.exec(setup)?.[1] : undefined;
  if (typeof setup === 'string' && !subclassName) throw new Error('Original tyre subclass missing');
  const subclass = subclassName ? parseSourceClass(setup as string, new Set([subclassName]), subclassName) : undefined;
  const wheel = createWheelRefState(), fields = new Map<string, JavaValue>();
  const natives = new JavaNativeRegistry(); registerWheelRefNatives(natives);
  const self = jv('Tyre', fields), wheelRef = jv('WheelRef', wheel);
  let machine: JavaSourceMachine;
  const host: JavaHost = {
    global(name) { const constant = parsed.constants.get(name); if (constant) return constant; throw new Error(`Unknown tyre global ${name}`); },
    get(receiver, name) {
      if (receiver.type !== 'Tyre') throw new Error(`Missing Java field ${receiver.type}.${name}`);
      const value = fields.get(name) ?? parsed.constants.get(name);
      if (value) return value;
      if (name === 'name_prefix' || name === 'name' || name === 'tyre_size_label') return jv('String', '');
      if (['value', 'brand_new_prestige_value', 'police_check_fine_value'].includes(name)) return jv('float', 0);
      throw new Error(`Missing Java field Tyre.${name}`);
    },
    set(receiver, name, value) { if (receiver.type !== 'Tyre') throw new Error(`Unknown tyre assignment ${receiver.type}.${name}`); fields.set(name, value); },
    call(receiver, name, args) {
      if (receiver.type === 'WheelRef') return callWheelRefNative(natives, receiver, name, args);
      if (receiver.type !== 'Tyre') throw new Error(`Unknown tyre receiver ${receiver.type}`);
      const method = subclass?.methods.find(m => m.name === name && m.parameters.length === args.length)
        ?? parsed.methods.find(m => m.name === name && m.parameters.length === args.length);
      if (method) return machine.invoke(method, self, args);
      if (name === 'getWheel') return wheelRef;
      if (name === 'getWheelID') return jv('int', wheelId);
      if (name === 'HUF2USD') return jv('float', Number(args[0].value));
      if (name === 'clampTo') return jv('float', Math.max(Number(args[1].value), Math.min(Number(args[2].value), Number(args[0].value))));
      if (name === 'setMaxWear' || name === 'setSlotPos' || name === 'calcStuffs') return jv('void', undefined);
      throw new Error(`Unsupported Tyre native ${name}(${args.length})`);
    },
    construct(name, args) { if (name === 'Vector3' || name === 'Ypr') return jv(name, args.map(arg => arg.value)); throw new Error(`Unsupported tyre constructor ${name}`); },
    constructorCall(receiver, fromClass, target, args) {
      const name = target === 'this' ? fromClass : fromClass === subclassName ? 'Tyre' : undefined;
      const method = name && (name === 'Tyre' ? parsed : subclass)?.methods.find(m => m.name === name && m.parameters.length === args.length);
      if (method) return machine.invoke(method, receiver, args);
      if (target === 'super' && args.length === 0) return jv('void', undefined);
      throw new Error(`Unsupported tyre constructor call ${fromClass}.${target}(${args.length})`);
    },
    parent() { return null; },
    isInstance(receiver, name) { return receiver.value !== null && receiver.type === 'Tyre' && (name === 'Tyre' || name === subclassName); },
  };
  machine = new JavaSourceMachine(host);
  machine.initializeFields(parsed, self, true);
  machine.initializeFields(parsed, self);
  if (subclass) {
    machine.initializeFields(subclass, self, true);
    machine.initializeFields(subclass, self);
    const constructor = subclass.methods.find(m => m.name === subclass.name && m.parameters.length === 1);
    if (!constructor) throw new Error(`Original tyre constructor missing: ${subclass.name}`);
    machine.invoke(constructor, self, [jv('int', 0)]);
  } else {
    const method = parsed.methods.find(m => m.name === 'SetupTyre' && m.parameters.length === 6);
    if (!method) throw new Error('Original Tyre.SetupTyre(float,float,float,float,int,float) missing');
    machine.invoke(method, self, (setup as readonly number[]).map((value, index) => jv(index === 4 ? 'int' : 'float', value)));
  }
  return wheel;
}
