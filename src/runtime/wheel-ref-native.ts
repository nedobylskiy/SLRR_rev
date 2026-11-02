import { JavaNativeRegistry, jv, type JavaValue } from 'slrr-jvm';

/** Values written by the original Tyre.java through WheelRef native methods. */
export interface WheelRefState {
  drive: number;
  brake: number;
  handBrake: number;
  force: number;
  damping: [number, number];
  restLength: number;
  minLength: number;
  maxLength: number;
  steer: number;
  position: [number, number, number];
  orientation: [number, number, number];
  arm: number[];
  hub: number[];
  instantCenter: [number, number, number, number, number, number];
  pacejka: number[];
  sliction: number;
  friction: number;
  stiffness: number;
  maxLoad: number;
  frictionX: number;
  loadSmooth: number;
  radius: number;
  width: number;
  rollResistance: number;
  bearing: number;
  contactPatch: [number, number, number];
}

export function createWheelRefState(): WheelRefState {
  return { drive: 0, brake: 0, handBrake: 0, force: 0, damping: [0, 0], restLength: 0,
    minLength: 0, maxLength: 0, steer: 0, position: [0, 0, 0], orientation: [0, 0, 0],
    arm: [], hub: [], instantCenter: [0, 0, 0, 0, 0, 0],
    pacejka: Array(17).fill(0), sliction: 1, friction: 1, stiffness: 10,
    maxLoad: 5000, frictionX: 1, loadSmooth: 0.5, radius: 0.32, width: 0.205,
    rollResistance: 0, bearing: 0, contactPatch: [0, 0, 0] };
}

export function registerWheelRefNatives(registry: JavaNativeRegistry, owner = 'WheelRef',
  stateFor: (receiver: JavaValue) => WheelRefState = receiver => receiver.value as WheelRefState): void {
  const one = (name: string, write: (wheel: WheelRefState, value: number) => void) =>
    registry.register(owner, name, ['float'], ({ receiver, args }) => {
      const value = Number(args[0].value);
      if (!Number.isFinite(value)) throw new Error(`Invalid WheelRef.${name} value`);
      write(stateFor(receiver), value);
      return jv('void', undefined);
    });
  one('setDrive', (w, x) => { w.drive = Math.fround(x); });
  one('setBrake', (w, x) => { w.brake = Math.fround(x); });
  one('setHBrake', (w, x) => { w.handBrake = Math.fround(x); });
  one('setForce', (w, x) => { w.force = Math.fround(x); });
  one('setDamping', (w, x) => { w.damping = [Math.fround(x), Math.fround(x)]; });
  one('setRestLen', (w, x) => { w.restLength = Math.fround(x); });
  one('setMinLen', (w, x) => { w.minLength = Math.fround(x); });
  one('setMaxLen', (w, x) => { w.maxLength = Math.fround(x); });
  one('setSteer', (w, x) => { w.steer = Math.fround(x); });
  registry.register(owner, 'setDamping', ['float', 'float'], ({ receiver, args }) => {
    stateFor(receiver).damping = [Math.fround(Number(args[0].value)), Math.fround(Number(args[1].value))];
    return jv('void', undefined);
  });
  for (const [name, count, field] of [['setArm', 7, 'arm'], ['setHub', 10, 'hub']] as const)
    registry.register(owner, name, Array(count).fill('float'), ({ receiver, args }) => {
      const values = args.map(arg => Number(arg.value));
      if (values.some(value => !Number.isFinite(value))) throw new Error(`Invalid WheelRef.${name} values`);
      stateFor(receiver)[field] = values.map(Math.fround);
      return jv('void', undefined);
    });
  registry.register(owner, 'getDrive', [], ({ receiver }) => jv('float', stateFor(receiver).drive));
  registry.register(owner, 'getSteer', [], ({ receiver }) => jv('float', stateFor(receiver).steer));
  registry.register(owner, 'getRadius', [], ({ receiver }) => jv('float', stateFor(receiver).radius));
  const vector = (value: JavaValue, names: string[]): [number, number, number] => {
    const fields = (value.value as { fields?: Map<string, JavaValue> } | null)?.fields;
    const result = names.map(name => Number(fields?.get(name)?.value));
    if (result.some(number => !Number.isFinite(number))) throw new Error('Invalid WheelRef vector');
    return result as [number, number, number];
  };
  const object = (type: string, names: string[], values: number[]) => jv(type, {
    className: `java.lang.${type}`, fields: new Map(names.map((name, index) => [name, jv('float', values[index])])),
  });
  registry.register(owner, 'setPos', ['Vector3'], ({ receiver, args }) => {
    stateFor(receiver).position = vector(args[0], ['x', 'y', 'z']); return jv('void', undefined);
  });
  registry.register(owner, 'setYpr', ['Ypr'], ({ receiver, args }) => {
    stateFor(receiver).orientation = vector(args[0], ['y', 'p', 'r']); return jv('void', undefined);
  });
  registry.register(owner, 'getPos', [], ({ receiver }) => object('Vector3', ['x', 'y', 'z'], stateFor(receiver).position));
  registry.register(owner, 'getYpr', [], ({ receiver }) => object('Ypr', ['y', 'p', 'r'], stateFor(receiver).orientation));
  registry.register(owner, 'setInstantCenter', Array(6).fill('float'), ({ receiver, args }) => {
    const values = args.map(arg => Number(arg.value));
    if (values.some(value => !Number.isFinite(value))) throw new Error('Invalid WheelRef instant center');
    stateFor(receiver).instantCenter = values as WheelRefState['instantCenter'];
    return jv('void', undefined);
  });
  one('setSliction', (w, x) => { w.sliction = x; w.pacejka[0] = x; });
  one('setFriction', (w, x) => { w.friction = x; w.pacejka[2] = x; });
  one('setStiffness', (w, x) => { w.stiffness = x; w.pacejka[4] = x; });
  one('setMaxLoad', (w, x) => { w.maxLoad = x; w.pacejka[11] = x; });
  one('setFrictn_x', (w, x) => { w.frictionX = x; w.pacejka[12] = x; });
  one('setLoadSmooth', (w, x) => { w.loadSmooth = x; w.pacejka[16] = x; });
  one('setRadius', (w, x) => { w.radius = x; });
  one('setWidth', (w, x) => { w.width = x; });
  one('setRollRes', (w, x) => { w.rollResistance = x; });
  one('setBearing', (w, x) => { w.bearing = x; });
  registry.register(owner, 'setPacejka', ['int', 'float'], ({ receiver, args }) => {
    const index = Number(args[0].value), value = Number(args[1].value);
    if (!Number.isFinite(value)) throw new Error('Invalid WheelRef Pacejka value');
    if (!Number.isInteger(index) || index < 0 || index >= 17) return jv('void', undefined);
    const wheel = stateFor(receiver);
    wheel.pacejka[index] = value;
    if (index === 0) wheel.sliction = value;
    if (index === 2) wheel.friction = value;
    if (index === 4) wheel.stiffness = value;
    if (index === 11) wheel.maxLoad = value;
    if (index === 12) wheel.frictionX = value;
    if (index === 14) wheel.loadSmooth = value;
    return jv('void', undefined);
  });
  registry.register(owner, 'setCPatch', ['float', 'float', 'float'], ({ receiver, args }) => {
    stateFor(receiver).contactPatch = [Math.abs(Number(args[0].value)), Math.sin(Math.abs(Number(args[1].value))), Number(args[2].value)];
    return jv('void', undefined);
  });
}

export function callWheelRefNative(registry: JavaNativeRegistry, receiver: JavaValue, name: string, args: JavaValue[]): JavaValue {
  const signature = name === 'setPacejka' ? ['int', 'float'] : name === 'setCPatch' ? ['float', 'float', 'float'] : ['float'];
  const result = registry.invoke('WheelRef', name, receiver, args.map((arg, index) => jv(signature[index], Number(arg.value))));
  if (!result) throw new Error(`Unsupported WheelRef call: ${name}`);
  return result;
}
