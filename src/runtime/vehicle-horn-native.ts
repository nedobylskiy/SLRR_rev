import { jv, type JavaObject, type JavaValue, type SlrrJvm } from 'slrr-jvm';
import type { ControllerNative } from './controller-native';
import type { GameTypeNative } from './game-type-native';
import type { GameObject } from './game-object';

interface HornState { physical: boolean; revision: number; on: boolean }
export interface HornSettings { resource: {pack:string;id:number} | null; pitch: number }
interface HornSound { start(settings?: HornSettings): number; stop(handle: number): void }

/** Java owns horn input and sethorn commands; audio only reflects the resulting state. */
export class VehicleHornNative {
  private readonly states = new WeakMap<GameObject, HornState>();
  private readonly sounds = new WeakMap<GameObject, Map<number,HornSettings>>();
  private soundKey?: string;
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
    jvm.natives.register('java.game.parts.bodypart.Chassis','setHornSFX',['ResourceRef','float','int'],({receiver,args})=>{
      const node = this.objects.get(receiver);
      if (!node) throw new Error('Chassis.setHornSFX has no chassis instance');
      const sound = this.objects.getResource(args[0]), pitch = Number(args[1].value), index = Number(args[2].value);
      if (!Number.isFinite(pitch) || pitch <= 0 || !Number.isInteger(index) || index < 0 || index > 3)
        throw new Error('Invalid chassis horn settings');
      let sounds = this.sounds.get(node);
      if (!sounds) { sounds=new Map(); this.sounds.set(node,sounds); }
      // ResourceRef handles are reused and cleared by updatevariables; snapshot the binding.
      sounds.set(index,{resource:sound?.resourceId ? {pack:sound.resourcePack ?? 'sound.rpk',id:sound.resourceId & 0xffff}:null,pitch});
      return jv('void',undefined);
    });
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
    const settings = node ? this.sounds.get(node)?.get(node.hornIndex || 1) : undefined;
    const key = settings ? `${settings.resource?.pack}:${settings.resource?.id}:${settings.pitch}` : 'default';
    if (this.voice !== undefined && (!on || node !== this.sounding || key !== this.soundKey)) {
      this.sound.stop(this.voice); this.voice = undefined; this.sounding = undefined;
    }
    if (on && this.voice === undefined && settings?.resource !== null) {
      this.voice = this.sound.start(settings); this.sounding = node; this.soundKey = key;
    }
  }
  dispose() {
    if (this.voice !== undefined) this.sound.stop(this.voice);
    this.voice = undefined; this.sounding = undefined;
  }
}
