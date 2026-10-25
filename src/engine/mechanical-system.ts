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
  boost = 0;
  manual = false;
  private shiftTimer = 0;
  private lastUp = false;
  private lastDown = false;
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
  reset() { this.rpm = this.block?.definition.mechanics?.values.rpm_idle ?? 900; this.gear = 1; this.boost = 0; this.manual = /TT_MANUAL|TT_SEMIAUTO/.test(this.transmission?.definition.mechanics?.transmissionType ?? ''); this.shiftTimer = 0; this.lastUp = this.lastDown = false; }
  private ratios() {
    const values = this.transmission?.definition.mechanics?.values ?? {};
    return Array.from({ length: Math.min(6, Math.max(0, values.gears ?? 6)) }, (_, i) => values[`ratio[${i + 1}]`] ?? 0);
  }
  private driveShares() {
    const all = /DT_4WD|DT_AWD/.test(this.drive) || this.drive.trim() === '3';
    const front = all || /DT_FWD/.test(this.drive) || this.drive.trim() === '1', rear = all || /DT_RWD/.test(this.drive) || this.drive.trim() === '2';
    if (front && rear) {
      const value = this.transmission?.definition.mechanics?.values.drive_front ?? this.transmission?.definition.mechanics?.values.def_drive_front ?? 0.5;
      const split = Math.max(0, Math.min(1, value)); return [split / 2, split / 2, (1 - split) / 2, (1 - split) / 2];
    }
    if (front) return [0.5, 0.5, 0, 0];
    return [0, 0, 0.5, 0.5];
  }
  private torqueAt(rpm: number) {
    const limit = this.block?.definition.mechanics?.values.RPM_limit ?? 6500;
    const peak = limit * 0.58, width = Math.max(1000, limit * 0.58);
    const shape = Math.max(0.2, 1 - 0.55 * ((rpm - peak) / width) ** 2);
    // The original DynoData.getTorque is native. This 9-bar BMEP curve is a bounded fallback.
    return this.displacement * 900000 / (4 * Math.PI) * shape * (1 + this.boost);
  }
  /** Rotational engine/clutch model. Wheel angular velocities are independent of chassis speed. */
  advance(dt: number, input: { throttle: number; clutch?: boolean; gearUp?: boolean; gearDown?: boolean }, wheelOmega: readonly number[]) {
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.1 || wheelOmega.length !== 4 || wheelOmega.some(v => !Number.isFinite(v))) throw new Error('Invalid drivetrain step');
    const throttle = Math.max(-1, Math.min(1, input.throttle)), gas = Math.abs(throttle), values = this.transmission?.definition.mechanics?.values ?? {};
    const idle = Math.max(100, this.block?.definition.mechanics?.values.rpm_idle ?? 900), limit = Math.max(idle + 500, this.block?.definition.mechanics?.values.RPM_limit ?? 6500);
    const ratios = this.ratios(), final = values.end_ratio ?? 1, shares = this.driveShares();
    this.power = Math.min(...[this.block, this.crank, this.head, this.transmission, this.clutch, this.fuel].map(p => this.health(p)));
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    const up = !!input.gearUp, down = !!input.gearDown;
    if ((up && !this.lastUp || down && !this.lastDown) && this.shiftTimer === 0) {
      this.manual = true; this.gear = Math.max(-1, Math.min(ratios.filter(r => r > 0).length, this.gear + Number(up) - Number(down))); this.shiftTimer = 0.22;
    }
    this.lastUp = up; this.lastDown = down;
    const mean = shares.reduce((sum, share, i) => sum + wheelOmega[i] * share, 0);
    if (!this.manual && this.shiftTimer === 0) {
      if (throttle < 0 && mean < 1.5) this.gear = -1;
      else if (throttle > 0 && mean > -1.5 && this.gear < 0) this.gear = 1;
      if (this.gear > 0 && !input.clutch && mean > 2) {
        const current = ratios[this.gear - 1] ?? 0, next = ratios[this.gear] ?? 0;
        if (next > 0 && this.rpm > limit * 0.88) { this.gear++; this.shiftTimer = 0.28; }
        else if (this.gear > 1 && this.rpm < Math.max(idle * 1.45, limit * 0.42) && mean * current * final * 60 / (2 * Math.PI) < limit * 0.65) { this.gear--; this.shiftTimer = 0.22; }
      }
    }
    const ratio = this.gear < 0 ? values['ratio[7]'] ?? -3.5 : this.gear > 0 ? ratios[this.gear - 1] ?? 0 : 0;
    const totalRatio = ratio * final, shaftOmega = mean * totalRatio;
    const targetBoost = this.engine.reduce((sum, part) => {
      const script = part.definition.script ?? '', profile = part.definition.mechanics?.values ?? {};
      if (!/turbocharger|supercharger/i.test(script) || !this.health(part)) return sum;
      const opt = profile.rpm_turbo_opt ?? limit * 0.7, range = Math.max(500, profile.rpm_turbo_range ?? opt * 0.5);
      const shape = Math.max(0, 1 - ((this.rpm - opt) / range) ** 2);
      const pressure = Math.min(profile.P_turbo_max ?? 0, profile.P_turbo_waste ?? profile.P_turbo_max ?? 0);
      return sum + Math.max(0, pressure) * shape * this.health(part);
    }, 0);
    const turbo = this.engine.some(part => /turbocharger/i.test(part.definition.script ?? '') && this.health(part));
    this.boost += (Math.min(2.5, targetBoost) - this.boost) * (1 - Math.exp(-dt / (turbo ? 0.35 : 0.06)));
    const omega = Math.max(idle, this.rpm) * Math.PI / 30;
    const firing = this.rpm < limit && this.power > 0;
    const idleControl = this.rpm < idle ? Math.min(80, 25 + (idle - this.rpm) * 0.25) : 0;
    const engineTorque = firing ? (this.torqueAt(this.rpm) * gas + idleControl) * this.power : 0;
    const drag = 14 + Math.max(0, this.rpm - idle) * 0.012;
    const directionBrake = this.gear > 0 && throttle < 0 || this.gear < 0 && throttle > 0;
    const clutchOpen = !!input.clutch || this.shiftTimer > 0 || !totalRatio || !this.power;
    const launch = Math.max(0.15, Math.min(1, (this.rpm - idle) / (idle * 0.55) + gas * 0.28));
    const capacity = clutchOpen ? 0 : (gas > 0 ? 220 * launch : 90 * Math.min(1, Math.abs(shaftOmega) / Math.max(1, omega))) * (this.clutch ? this.health(this.clutch) : 1);
    const clutchTorque = Math.max(-capacity, Math.min(capacity, (omega - shaftOmega) * 9));
    const inertia = 0.28 + Math.max(0, this.crank?.definition.mechanics?.values.inertia ?? 0) * 0.01;
    this.rpm = Math.max(idle * 0.65, Math.min(limit * 1.08, this.rpm + (engineTorque - drag - clutchTorque) / inertia * dt * 30 / Math.PI));
    return { torque: shares.map(share => clutchTorque * totalRatio * 0.82 * share), directionBrake };
  }
  /** Legacy static estimate used by component diagnostics; driving uses advance() and wheel slip. */
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
