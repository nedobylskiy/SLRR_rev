import { JavaNativeRegistry, jv, type JavaValue } from 'slrr-jvm';

/** Values written by the original Tyre.java through WheelRef native methods. */
export interface WheelRefState {
  drive: number;
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
  return { drive: 0, instantCenter: [0, 0, 0, 0, 0, 0],
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
  registry.register(owner, 'getDrive', [], ({ receiver }) => jv('float', stateFor(receiver).drive));
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
