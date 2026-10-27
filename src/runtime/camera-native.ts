import { jv, type JavaObject, type JavaValue, type SlrrJvm } from 'slrr-jvm';
import type { GameTypeNative } from './game-type-native';
import type { Vector3State, OrientationState } from './game-object';
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
  position: Vector3State;
  orientation: OrientationState;
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
        resource.resourceId = resource.id;
        resource.resourceType = 3;
        resource.setParent(args[0].value == null ? null : resources.getResource(args[0]) ?? null);
        this.cameras.set(this.object(receiver), {
          viewport: args[1], priority: Number(args[2].value), halfAov: Number(args[3].value),
          near: Number(args[4].value), far: Number(args[5].value), lodBias: Number(args[6].value),
          lodAmp: Number(args[7].value), culling: Number(args[8].value), planeTest: Number(args[9].value),
          position: { x: 0, y: 0, z: 3 }, orientation: { y: 0, p: 0, r: 0 },
        });
        return voidValue();
      });
    jvm.natives.register('java.render.Camera', 'destroy', [], ({ receiver }) => {
      this.cameras.delete(this.object(receiver));
      const resource = resources.getResource(receiver);
      if (resource) { resource.resourceId = 0; resource.resourceType = 0; resource.setParent(null); }
      return voidValue();
    });
    jvm.natives.register('java.util.resource.RenderRef', 'setMatrix', ['Vector3', 'Ypr'], ({ receiver, args }) => {
      const camera = this.cameras.get(this.object(receiver));
      if (!camera) throw new Error('RenderRef.setMatrix has no render instance');
      camera.position = { x: Number(jvm.get(args[0], 'x').value), y: Number(jvm.get(args[0], 'y').value),
        z: Number(jvm.get(args[0], 'z').value) };
      if (args[1].value != null) camera.orientation = { y: Number(jvm.get(args[1], 'y').value),
        p: Number(jvm.get(args[1], 'p').value), r: Number(jvm.get(args[1], 'r').value) };
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
