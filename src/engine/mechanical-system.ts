import type { EnginePart } from './world';

export interface CornerMechanics { strut?: EnginePart; spring?: EnginePart; shock?: EnginePart; brake?: EnginePart; sway?: EnginePart }
const attached = (part: EnginePart | undefined, root: EnginePart): number => {
  if (!part) return 0;
  let health = part.condition;
  for (let p = part.parent; p && p !== root; p = p.parent) health = Math.min(health, p.condition);
  for (let p: EnginePart | undefined = part; p; p = p.parent) if (p === root) return health;
  return 0;
};

/** Explicit installed components, connected through CFG slots. Numeric tuning comes from selected original Java scripts. */
export class MechanicalSystem {
  readonly corners: CornerMechanics[] = [{}, {}, {}, {}];
  readonly engine: EnginePart[] = [];
  readonly block?: EnginePart;
  readonly crank?: EnginePart;
  readonly head?: EnginePart;
  readonly transmission?: EnginePart;
  readonly clutch?: EnginePart;
  readonly fuel?: EnginePart;
  readonly displacement: number;
  readonly drive: string;
  rpm = 0;
  gear = 1;
  power = 0;
  constructor(readonly root: EnginePart) {
    for (const part of root.world.parts.values()) {
      const profile = part.definition.mechanics;
      if (!profile) continue;
      if (profile.kind === 'engine') { this.engine.push(part); continue; }
      if (profile.kind === 'sway') {
        const rear = (part.parentSlot ?? 0) % 100 === 2;
        this.corners[rear ? 2 : 0].sway = this.corners[rear ? 3 : 1].sway = part;
        continue;
      }
      let p: EnginePart | undefined = part;
      while (p?.parent && p.parent !== root) p = p.parent;
      // Original wheel hardware slots use the corner suffix 1..4 (111 brakes,
      // 121 struts, 301 shocks, 311 springs). The ancestry handles nested parts.
      const index = (p?.parentSlot ?? 0) % 10 - 1;
      if (index >= 0 && index < 4) this.corners[index][profile.kind === 'suspension' ? 'strut' : profile.kind] = part;
    }
    const find = (f: (part: EnginePart) => boolean) => this.engine.find(f);
    this.block = find(p => !!p.definition.mechanics?.values.cylinders);
    this.crank = find(p => !!p.definition.mechanics?.values.stroke);
    this.head = find(p => !!p.definition.mechanics?.values.intake_valve_diam);
    this.transmission = find(p => !!p.definition.mechanics?.values.gears);
    this.clutch = find(p => /clutch/i.test(p.definition.script ?? ''));
    this.fuel = find(p => /fuel_rail/i.test(p.definition.script ?? ''));
    const bore = this.block?.definition.mechanics?.values.bore ?? 0, stroke = this.crank?.definition.mechanics?.values.stroke ?? 0, cylinders = this.block?.definition.mechanics?.values.cylinders ?? 0;
    this.displacement = Math.PI / 4 * (bore / 1000) ** 2 * stroke / 1000 * cylinders;
    this.drive = this.transmission?.definition.mechanics?.drive ?? 'DT_RWD';
  }
  health(part?: EnginePart) { return attached(part, this.root); }
  component(index: number, kind: keyof CornerMechanics) { return this.health(this.corners[index][kind]); }
  spring(index: number) {
    const part = this.corners[index].spring;
    return (part?.definition.mechanics?.values.force ?? 0) * this.component(index, 'spring') * this.component(index, 'strut');
  }
  damper(index: number) {
    const part = this.corners[index].shock;
    return (part?.definition.mechanics?.values.damping ?? 0) * this.component(index, 'shock') * this.component(index, 'strut');
  }
  support(index: number) { return Math.min(this.component(index, 'strut'), this.component(index, 'spring')); }
  brake(index: number) { return this.component(index, 'brake') * this.component(index, 'strut'); }
  sway(index: number) {
    const part = this.corners[index].sway, values = part?.definition.mechanics?.values;
    const health = this.health(part);
    return { force: (values?.force ?? 0) * health, damping: (values?.damping ?? 0) * health };
  }
  /** Estimated wheel force from original displacement and ratios; combustion and gear shifting remain a prototype. */
  driveForce(index: number, speed: number, wheelRadius: number, throttle: number) {
    const required = [this.block, this.crank, this.head, this.transmission, this.clutch, this.fuel];
    this.power = Math.min(...required.map(p => this.health(p)));
    const transmission = this.transmission?.definition.mechanics?.values ?? {}, idle = this.block?.definition.mechanics?.values.rpm_idle ?? 900, limit = this.block?.definition.mechanics?.values.RPM_limit ?? 6500;
    const final = transmission.end_ratio ?? 1;
    const ratios = [1, 2, 3, 4, 5].map(n => transmission[`ratio[${n}]`] ?? 0).filter(n => n > 0);
    this.gear = 1;
    for (let i = 0; i < ratios.length - 1; i++) if (Math.abs(speed) / wheelRadius * ratios[i] * final * 60 / (2 * Math.PI) > limit * 0.72) this.gear = i + 2;
    const ratio = ratios[this.gear - 1] ?? 0;
    this.rpm = Math.min(limit, Math.max(idle, Math.abs(speed) / wheelRadius * ratio * final * 60 / (2 * Math.PI)));
    if (!this.power || !ratio || !this.displacement || !this.support(index)) return 0;
    const driven = this.drive === 'DT_FWD' ? index < 2 : this.drive === 'DT_4WD' || this.drive === 'DT_AWD' ? true : index >= 2;
    if (!driven) return 0;
    // 9 bar BMEP is a stated prototype assumption, not a measured SLRR torque curve.
    const torque = this.displacement * 900000 / (4 * Math.PI) * Math.max(0.35, 1 - (this.rpm / limit) ** 3 * 0.65);
    const drivenCount = this.drive === 'DT_4WD' || this.drive === 'DT_AWD' ? 4 : 2;
    return throttle * torque * ratio * final * 0.82 / wheelRadius / drivenCount * this.power;
  }
}
