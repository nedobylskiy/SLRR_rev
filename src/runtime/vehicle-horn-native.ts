import { jv, type JavaObject, type JavaValue, type SlrrJvm } from 'slrr-jvm';
import type { ControllerNative } from './controller-native';
import type { GameTypeNative } from './game-type-native';
import type { GameObject } from './game-object';

interface HornState { physical: boolean; revision: number; on: boolean }
interface HornSound { start(): number; stop(handle: number): void }

/** Java owns horn input and sethorn commands; audio only reflects the resulting state. */
export class VehicleHornNative {
  private readonly states = new WeakMap<GameObject, HornState>();
  private voice?: number;
  private sounding?: GameObject;
  constructor(private readonly jvm: SlrrJvm, private readonly objects: GameTypeNative,
    private readonly controllers: ControllerNative, private readonly sound: HornSound,
    private readonly player = (): { car: JavaValue; controller: JavaValue } | undefined => {
      try {
        const player = jvm.get(jv('class', 'java.game.GameLogic'), 'player');
        if (player.value == null) return;
        return { car: jvm.get(player, 'car'), controller: jvm.get(player, 'controller') };
      } catch { return; } // Minimal boot/test scripts may not have a player yet.
    }) {
    jvm.natives.register('java.game.Vehicle', 'getHorn', [], ({ receiver }) => jv('int', Number(this.read(receiver))));
  }
  private node(car: JavaValue): GameObject | undefined {
    if (car.value == null) return;
    const chassis = (car.value as JavaObject).fields?.get('chassis');
    return this.objects.get(chassis?.value != null ? chassis : car);
  }
  read(car: JavaValue): boolean {
    if (car.value == null) return false;
    const node = this.node(car);
    if (!node) return false;
    const player = this.player();
    const physical = !!player && this.node(player.car) === node && player.controller.value != null
      && this.controllers.read(player.controller, 54) > .2; // Original Input.AXIS_HORN.
    let state = this.states.get(node);
    if (!state) {
      state = { physical: false, revision: 0, on: false };
      this.states.set(node, state);
    }
    if (physical !== state.physical) state.on = physical;
    state.physical = physical;
    if (state.revision !== node.hornCommandRevision) {
      state.revision = node.hornCommandRevision;
      state.on = node.hornInput;
    }
    // A script consuming sethorn 0 stays authoritative until the next physical press.
    return state.on;
  }
  update() {
    const car = this.player()?.car, node = car?.value != null ? this.node(car) : undefined;
    const on = !!car && this.read(car);
    if (this.voice !== undefined && (!on || node !== this.sounding)) {
      this.sound.stop(this.voice); this.voice = undefined; this.sounding = undefined;
    }
    if (on && this.voice === undefined) { this.voice = this.sound.start(); this.sounding = node; }
  }
  dispose() {
    if (this.voice !== undefined) this.sound.stop(this.voice);
    this.voice = undefined; this.sounding = undefined;
  }
}
