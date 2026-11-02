import { jv, type JavaObject, type JavaValue, type SlrrJvm } from 'slrr-jvm';
import type { GameTypeNative } from './game-type-native';

export interface ViewportSize { width: number; height: number }
interface ViewportState { priority: number; left: number; top: number; width: number; height: number; active: boolean }

/** Java Viewport handles refer to regions of the existing WebGL canvas. */
export class ViewportNative {
  private readonly states = new WeakMap<JavaObject, ViewportState>();

  constructor(jvm: SlrrJvm, private readonly resources: GameTypeNative,
    private readonly size: () => ViewportSize) {
    const owner = 'java.render.Viewport';
    const voidValue = () => jv('void', undefined);
    jvm.natives.register(owner, 'create', ['int', 'float', 'float', 'float', 'float'], ({ receiver, args }) => {
      const resource = this.resources.getResource(receiver);
      if (!resource) throw new Error('Viewport.create requires a ResourceRef handle');
      resource.resourceId = resource.id;
      resource.resourceType = 18;
      this.states.set(this.object(receiver), { priority: Number(args[0].value), left: Number(args[1].value),
        top: Number(args[2].value), width: Number(args[3].value), height: Number(args[4].value), active: false });
      return voidValue();
    });
    jvm.natives.register(owner, 'destroy', [], ({ receiver }) => {
      this.states.delete(this.object(receiver));
      const resource = this.resources.getResource(receiver);
      if (resource) { resource.resourceId = 0; resource.resourceType = 0; }
      return voidValue();
    });
    jvm.natives.register(owner, 'activate', ['int'], ({ receiver }) => {
      this.require(receiver).active = true; return voidValue();
    });
    jvm.natives.register(owner, 'deactivate', [], ({ receiver }) => {
      this.require(receiver).active = false; return voidValue();
    });
    jvm.natives.register(owner, 'resize', ['float', 'float', 'float', 'float'], ({ receiver, args }) => {
      const state = this.require(receiver);
      [state.left, state.top, state.width, state.height] = args.map(arg => Number(arg.value));
      return voidValue();
    });
    for (const [name, key] of [['getLeft', 'left'], ['getTop', 'top'], ['getWidth', 'width'],
      ['getHeight', 'height']] as const)
      jvm.natives.register(owner, name, [], ({ receiver }) => jv('float', this.require(receiver)[key]));
    jvm.natives.register(owner, 'getAspect', [], ({ receiver }) => {
      const { width, height } = this.size();
      const state = this.require(receiver);
      const pixelWidth = Math.max(0, width) * state.width;
      const pixelHeight = Math.max(0, height) * state.height;
      return jv('float', pixelHeight > 0 ? pixelWidth / pixelHeight : 1);
    });
  }

  get(receiver: JavaValue): Readonly<ViewportState> | undefined { return this.states.get(this.object(receiver)); }

  private require(receiver: JavaValue): ViewportState {
    const state = this.get(receiver);
    if (!state) throw new Error('Viewport has not been created');
    return state;
  }

  private object(receiver: JavaValue): JavaObject {
    const object = receiver.value as JavaObject | null;
    if (!object || !(object.fields instanceof Map) || !object.className)
      throw new Error(`Viewport receiver is not a Java object: ${receiver.type}`);
    return object;
  }
}
