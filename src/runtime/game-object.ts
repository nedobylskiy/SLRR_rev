export interface Vector3State { x: number; y: number; z: number }
export interface OrientationState { y: number; p: number; r: number }
export interface QueuedGameEvent { sourceId: number | null; type: number; payload: string | number | null }

const zeroVector = (): Vector3State => ({ x: 0, y: 0, z: 0 });
const zeroOrientation = (): OrientationState => ({ y: 0, p: 0, r: 0 });

/** Host counterpart of one GameRef/GameType instance. Simulation systems may bind to this state later. */
export class GameObject extends ResourceObject {
  readonly events: QueuedGameEvent[] = [];
  eventMask = 0;
  flags = 0;
  worldTreeRoot = false;
  collisionActivationQueued = false;
  collisionEnabled = false;
  position = zeroVector();
  orientation = zeroOrientation();
  velocity = zeroVector();
  angularVelocity = zeroVector();

  constructor(id: number, className: string, typeId: number, params: string | null, alias: string) {
    super(id, className, typeId, params, alias);
  }

  setFlags(mask: number): void {
    this.flags |= mask;
    if (mask & 0x10) this.worldTreeRoot = true;
  }

  clearFlags(mask: number): void {
    this.flags &= ~mask;
  }

  setMatrix(position: Vector3State, orientation: OrientationState): void {
    this.position = { ...position };
    this.orientation = { ...orientation };
    this.velocity = zeroVector();
    this.angularVelocity = zeroVector();
  }

  setState(position: Vector3State, orientation: OrientationState, velocity: Vector3State, angularVelocity: Vector3State): void {
    this.position = { ...position };
    this.orientation = { ...orientation };
    this.velocity = { ...velocity };
    this.angularVelocity = { ...angularVelocity };
  }

  queueEvent(event: QueuedGameEvent): void { this.events.push(event); }

  setEventMask(mask: number): void { this.eventMask |= mask; }

  clearEventMask(mask: number): void { this.eventMask &= ~mask; }

  acceptsEvent(type: number): boolean { return (this.eventMask & type) !== 0; }

  requestActiveCollision(): void {
    if (this.collisionActivationQueued) return;
    this.collisionActivationQueued = true;
    this.flags |= 0x10000000;
  }

  /** Called by the physics step after processing the queued activation. */
  consumeCollisionActivation(): boolean {
    if (!this.collisionActivationQueued) return false;
    this.collisionActivationQueued = false;
    this.flags &= ~0x10000000;
    this.collisionEnabled = true;
    return true;
  }
}
import { ResourceObject } from './resource-object';

