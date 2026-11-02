import { ResourceObject } from './resource-object';
import type { OrientationState, Vector3State } from './game-object';

/** One visual instance created from a RenderRef resource type. */
export class RenderObject extends ResourceObject {
  position: Vector3State = { x: 0, y: 0, z: 0 };
  orientation: OrientationState = { y: 0, p: 0, r: 0 };
  renderResource: { pack: string; id: number } | null = null;

  constructor(id: number, className: string, public renderType: ResourceObject | null,
    alias: string) {
    super(id, className, renderType?.resourceId ?? 0, null, alias);
    this.resourceId = renderType?.resourceId ?? id;
    this.resourceType = 3;
  }

  setMatrix(position: Vector3State, orientation: OrientationState): void {
    this.position = { ...position };
    this.orientation = { ...orientation };
  }
}
