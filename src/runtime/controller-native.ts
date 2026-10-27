import { jv, type JavaObject, type JavaValue, type SlrrJvm } from 'slrr-jvm';

interface AxisBinding {
  virtualAxis: number;
  device: number;
  physicalAxis: number;
  fromMin: number;
  fromMax: number;
  toMin: number;
  toMax: number;
}

interface AxisProperties {
  centerRange: number;
  factorCenter: number;
  factorOpposite: number;
  factorSame: number;
  power: number;
  speed: number;
  forceCenter: number;
  force: number;
}

interface ControllerState {
  bindings: AxisBinding[];
  properties: Map<number, AxisProperties>;
}

const voidValue = () => jv('void', undefined);
const defaults = (): AxisProperties => ({ centerRange: 0.1, factorCenter: 1,
  factorOpposite: 1, factorSame: 1, power: 1, speed: 1, forceCenter: 0, force: 0 });

/** Active mappings belong to each Controller instance, not to the saved ControlSet file. */
export class ControllerNative {
  private readonly states = new WeakMap<JavaObject, ControllerState>();

  constructor(jvm: SlrrJvm, private readonly physicalAxis: (device: number, axis: number) => number = () => 0) {
    const owner = 'java.io.Controller';
    jvm.natives.register(owner, 'user_Reset', [], ({ receiver }) => {
      const state = this.state(receiver);
      state.bindings = [];
      state.properties.clear();
      return voidValue();
    });
    jvm.natives.register(owner, 'user_Add', ['int', 'int', 'int', 'float', 'float', 'float', 'float'],
      ({ receiver, args }) => {
        const [virtualAxis, device, physicalAxis] = args.map(arg => Number(arg.value));
        if (device < 0 || physicalAxis < 0) return jv('int', -1);
        const state = this.state(receiver);
        if (state.bindings.length >= 152) return jv('int', 0);
        state.bindings.push({ virtualAxis, device, physicalAxis,
          fromMin: Number(args[3].value), fromMax: Number(args[4].value),
          toMin: Number(args[5].value), toMax: Number(args[6].value) });
        return jv('int', state.bindings.length);
      });
    jvm.natives.register(owner, 'user_Del', ['int', 'int', 'int'], ({ receiver, args }) => {
      const [virtualAxis, device, physicalAxis] = args.map(arg => Number(arg.value));
      const bindings = this.state(receiver).bindings;
      const index = bindings.findIndex(binding => binding.virtualAxis === virtualAxis
        && binding.device === device && binding.physicalAxis === physicalAxis);
      if (index >= 0) bindings.splice(index, 1);
      return jv('int', 0);
    });
    jvm.natives.register(owner, 'user_SetAxisSmooth', ['int', 'float', 'float', 'float', 'float', 'float'],
      ({ receiver, args }) => {
        const properties = this.axis(receiver, Number(args[0].value));
        [properties.centerRange, properties.factorCenter, properties.factorOpposite,
          properties.factorSame, properties.power] = args.slice(1).map(arg => Number(arg.value));
        return jv('int', 1);
      });
    jvm.natives.register(owner, 'user_SetAxisSpeed', ['int', 'float'], ({ receiver, args }) => {
      this.axis(receiver, Number(args[0].value)).speed = Number(args[1].value);
      return voidValue();
    });
    jvm.natives.register(owner, 'user_SetAxisForce', ['int', 'float', 'float'], ({ receiver, args }) => {
      const properties = this.axis(receiver, Number(args[0].value));
      properties.forceCenter = Number(args[1].value);
      properties.force = Number(args[2].value);
      return voidValue();
    });
    jvm.natives.register(owner, 'user_GetAxisVal', ['int'], ({ receiver, args }) =>
      jv('float', this.read(receiver, Number(args[0].value))));
  }

  bindings(receiver: JavaValue): readonly Readonly<AxisBinding>[] { return this.state(receiver).bindings; }

  read(receiver: JavaValue, virtualAxis: number): number {
    const state = this.state(receiver);
    const force = state.properties.get(virtualAxis)?.force ?? 0;
    if (force !== 0) return force;
    let value = 0;
    for (const binding of state.bindings) {
      if (binding.virtualAxis !== virtualAxis) continue;
      const raw = this.physicalAxis(binding.device, binding.physicalAxis);
      const span = binding.fromMax - binding.fromMin;
      if (!Number.isFinite(raw) || span === 0) continue;
      const fraction = Math.max(0, Math.min(1, (raw - binding.fromMin) / span));
      value += binding.toMin + fraction * (binding.toMax - binding.toMin);
    }
    return value;
  }

  private axis(receiver: JavaValue, virtualAxis: number): AxisProperties {
    const properties = this.state(receiver).properties;
    let axis = properties.get(virtualAxis);
    if (!axis) { axis = defaults(); properties.set(virtualAxis, axis); }
    return axis;
  }

  private state(receiver: JavaValue): ControllerState {
    const object = receiver.value as JavaObject | null;
    if (!object || !(object.fields instanceof Map) || !object.className)
      throw new Error(`Controller receiver is not a Java object: ${receiver.type}`);
    let state = this.states.get(object);
    if (!state) { state = { bindings: [], properties: new Map() }; this.states.set(object, state); }
    return state;
  }
}
