import { jv, type JavaValue, type SlrrJvm } from 'slrr-jvm';
import type { GameTypeNative } from './game-type-native';
import type { OrientationState, Vector3State } from './game-object';

const origin = (): Vector3State => ({ x: 0, y: 0, z: 0 });
const zeroRotation = (): OrientationState => ({ y: 0, p: 0, r: 0 });

/** Java RenderRef methods over visual instances in the host resource tree. */
export class RenderRefNative {
  constructor(jvm: SlrrJvm, private readonly resources: GameTypeNative,
    private readonly setTextMatrix?: (receiver: JavaValue, position: Vector3State) => boolean) {
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
