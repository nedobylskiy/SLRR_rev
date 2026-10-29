import { jv, type JavaValue, type SlrrJvm } from 'slrr-jvm';
import type { GameTypeNative } from './game-type-native';
import type { OrientationState, Vector3State } from './game-object';
import type { ResourceObject } from './resource-object';

export interface RenderLightSettings { diffuse: number; ambient: number; specular: number }
export interface RenderFlareSettings { color: number; minSize: number; maxSize: number; flareCount: number; rayCount: number }
export interface RenderFlareSource extends RenderFlareSettings {
  path: string; bytes: Uint8Array; sunDirection?: { x: number; y: number; z: number };
}

const origin = (): Vector3State => ({ x: 0, y: 0, z: 0 });
const zeroRotation = (): OrientationState => ({ y: 0, p: 0, r: 0 });

/** Java RenderRef methods over visual instances in the host resource tree. */
export class RenderRefNative {
  constructor(jvm: SlrrJvm, private readonly resources: GameTypeNative,
    private readonly setTextMatrix?: (receiver: JavaValue, position: Vector3State) => boolean,
    private readonly setSceneLight?: (settings: RenderLightSettings) => void,
    private readonly setSceneFlare?: (texture: ResourceObject, light: ResourceObject,
      settings: RenderFlareSettings) => Promise<void> | void) {
    const owner = 'java.util.resource.RenderRef';
    const voidValue = () => jv('void', undefined);
    jvm.natives.register(owner, 'create', ['ResourceRef', 'RenderRef', 'String'], ({ receiver, args }) => {
      this.resources.createRender(receiver, args[0], args[1],
        args[2].value == null ? null : String(args[2].value));
      return voidValue();
    });
    jvm.natives.register(owner, 'setMatrix', ['Vector3', 'Ypr'], ({ receiver, args }) => {
      const render = this.resources.getRender(receiver);
      if (!render) {
        if (this.setTextMatrix?.(receiver, this.vector(jvm, args[0]))) return voidValue();
        throw new Error('RenderRef.setMatrix has no render instance');
      }
      render.setMatrix(this.vector(jvm, args[0]), this.orientation(jvm, args[1]));
      this.resources.notifyRenderChanged(render);
      return voidValue();
    });
    jvm.natives.register(owner, 'getTypeID', [], ({ receiver }) =>
      jv('int', this.resources.getRender(receiver)?.typeId ?? 0));
    jvm.natives.register(owner, 'setType', ['ResourceRef'], ({ receiver, args }) => {
      const render = this.resources.getRender(receiver);
      if (!render) return voidValue();
      const type = args[0].value == null ? null : this.resources.getResource(args[0]);
      render.renderType = type ?? null;
      render.typeId = type?.resourceId ?? 0;
      this.resources.notifyRenderChanged(render);
      return voidValue();
    });
    jvm.natives.register(owner, 'setLight', ['int', 'int', 'int'], ({ receiver, args }) => {
      if (!this.resources.getResource(receiver)) throw new Error('RenderRef.setLight has no resource');
      this.setSceneLight?.({ diffuse: Number(args[0].value) & 0xffffff,
        ambient: Number(args[1].value) & 0xffffff,
        specular: Number(args[2].value) & 0xffffff });
      return voidValue();
    });
    jvm.natives.registerAsync(owner, 'setFlare', ['ResourceRef', 'int', 'float', 'float', 'int', 'int'], async ({ receiver, args }) => {
      const light = this.resources.getResource(receiver);
      if (!light) throw new Error('RenderRef.setFlare has no resource');
      const texture = this.resources.getResource(args[0]);
      if (!texture) throw new Error('RenderRef.setFlare has no texture resource');
      await this.setSceneFlare?.(texture, light, { color: Number(args[1].value) >>> 0,
        minSize: Number(args[2].value), maxSize: Number(args[3].value),
        flareCount: Number(args[4].value), rayCount: Number(args[5].value) });
      return voidValue();
    });
    // MOCK: Dynamic SkidMark lines are tracked as resources but have no visible geometry yet.
    // This lets Navigator construct and release its route without blocking Track.enter.
    jvm.natives.register(owner, 'lineCreate', ['ResourceRef', 'ResourceRef'], ({ receiver, args }) => {
      const line = this.resources.getResource(receiver);
      const parent = args[0].value == null ? null : this.resources.getResource(args[0]);
      if (!line || (args[0].value != null && !parent))
        throw new Error('RenderRef.lineCreate has no resource or parent');
      line.setParent(parent ?? null);
      return jv('int', 1);
    });
    // MOCK: Route/skid points are intentionally discarded until dynamic line rendering is implemented.
    jvm.natives.register(owner, 'lineAdd', ['Vector3', 'Vector3', 'int', 'float'], () => voidValue());
  }

  private vector(jvm: SlrrJvm, value: JavaValue): Vector3State {
    if (value.value == null) return origin();
    return { x: Number(jvm.get(value, 'x').value), y: Number(jvm.get(value, 'y').value),
      z: Number(jvm.get(value, 'z').value) };
  }

  private orientation(jvm: SlrrJvm, value: JavaValue): OrientationState {
    if (value.value == null) return zeroRotation();
    return { y: Number(jvm.get(value, 'y').value), p: Number(jvm.get(value, 'p').value),
      r: Number(jvm.get(value, 'r').value) };
  }
}
