import { jv, type JavaObject, type JavaValue, type SlrrJvm } from 'slrr-jvm';
import type { GameTypeNative } from './game-type-native';
import type { ViewportNative } from './viewport-native';

interface CameraState {
  viewport: JavaValue;
  priority: number;
  halfAov: number;
  near: number;
  far: number;
  lodBias: number;
  lodAmp: number;
  culling: number;
  planeTest: number;
}

/** Script-facing camera resource; the active Three.js camera can consume this state later. */
export class CameraNative {
  private readonly cameras = new WeakMap<JavaObject, CameraState>();

  constructor(jvm: SlrrJvm, resources: GameTypeNative, viewports: ViewportNative) {
    const voidValue = () => jv('void', undefined);
    jvm.natives.register('java.render.Camera', 'create',
      ['ResourceRef', 'Viewport', 'int', 'float', 'float', 'float', 'float', 'float', 'int', 'int'],
      ({ receiver, args }) => {
        const resource = resources.getResource(receiver);
        if (!resource) throw new Error('Camera.create requires a ResourceRef handle');
        if (!viewports.get(args[1])) throw new Error('Camera.create requires a created Viewport');
        resources.createRender(receiver, args[0], null, 's_renderref_camera');
        this.cameras.set(this.object(receiver), {
          viewport: args[1], priority: Number(args[2].value), halfAov: Number(args[3].value),
          near: Number(args[4].value), far: Number(args[5].value), lodBias: Number(args[6].value),
          lodAmp: Number(args[7].value), culling: Number(args[8].value), planeTest: Number(args[9].value),
        });
        return voidValue();
      });
    jvm.natives.register('java.render.Camera', 'destroy', [], ({ receiver }) => {
      this.cameras.delete(this.object(receiver));
      const resource = resources.getResource(receiver);
      if (resource) {
        resource.resourceId = 0; resource.resourceType = 0; resource.setParent(null);
        const render = resources.getRender(receiver);
        if (render) resources.notifyRenderChanged(render);
      }
      return voidValue();
    });
  }

  get(receiver: JavaValue): Readonly<CameraState> | undefined { return this.cameras.get(this.object(receiver)); }

  private object(receiver: JavaValue): JavaObject {
    const object = receiver.value as JavaObject | null;
    if (!object || !(object.fields instanceof Map) || !object.className)
      throw new Error(`Camera receiver is not a Java object: ${receiver.type}`);
    return object;
  }
}
