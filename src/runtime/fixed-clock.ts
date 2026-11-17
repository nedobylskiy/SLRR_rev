/** Simulation time advances only in whole ticks. Rendering and wall-clock pauses cannot change dt. */
export class FixedClock {
  private accumulator = 0;
  tick = 0;
  readonly dt: number;
  get pendingSeconds(){return this.accumulator;}
  get requestedSeconds(){return this.tick*this.dt+this.accumulator;}
  /** Adopt a completed worker snapshot without advancing the simulation. */
  restore(tick:number,pendingSeconds=0){
    if(!Number.isInteger(tick)||tick<0||!Number.isFinite(pendingSeconds)||pendingSeconds<0)throw Error('Invalid fixed clock snapshot');
    this.tick=tick;this.accumulator=pendingSeconds;
  }
  constructor(readonly frequency = 60, readonly maxSteps = 8) {
    if (!Number.isFinite(frequency) || frequency <= 0 || !Number.isInteger(maxSteps) || maxSteps < 1) throw new Error('Invalid fixed clock parameters');
    this.dt = 1 / frequency;
  }
  advance(elapsedSeconds: number, update: (tick: number, dt: number) => void) {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) throw new Error('Invalid elapsed time');
    this.accumulator += elapsedSeconds;
    let steps = 0;
    const tolerance = this.dt * 1e-10;
    while (this.accumulator + tolerance >= this.dt && steps < this.maxSteps) {
      update(this.tick + 1, this.dt); this.tick++; this.accumulator = Math.max(0, this.accumulator - this.dt); steps++;
    }
    // Debt is reported and retained. A dedicated server must process it or pause/resync explicitly.
    return { steps, backlogTicks: Math.floor((this.accumulator + tolerance) / this.dt), alpha: Math.min(1, this.accumulator / this.dt) };
  }
}
