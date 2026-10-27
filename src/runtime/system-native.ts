import { jv, type SlrrJvm } from 'slrr-jvm';
import type { BootEvent } from './game-boot';

/** Host services used by the original java.lang.System and Debug sources. */
export class SystemNative {
  private readonly startedAt: number;
  private simulationSeconds = 0;
  private gameTimeSeconds = 0;
  private lastSample: number;
  private warp = 1;

  constructor(jvm: SlrrJvm, private readonly report: (event: BootEvent) => void,
    private readonly now: () => number = () => performance.now()) {
    this.startedAt = this.now();
    this.lastSample = this.startedAt;
    const owner = 'java.lang.System';
    jvm.natives.register(owner, 'currentTime', [], () => jv('float', Math.fround((this.now() - this.startedAt) / 1000)));
    jvm.natives.register(owner, 'simTime', [], () => jv('float', Math.fround(this.sampleSimulation())));
    jvm.natives.register(owner, 'syncGameTime', ['float'], ({ args }) => {
      this.gameTimeSeconds = Number(args[0].value);
      return jv('void', undefined);
    });
    jvm.natives.register(owner, 'buildNumber', [], () => jv('int', 940));
    jvm.natives.register(owner, 'timeWarp', ['float'], ({ args }) => {
      this.sampleSimulation();
      const previous = this.warp;
      const requested = Number(args[0].value);
      if (requested >= 0) this.warp = requested;
      return jv('float', Math.fround(previous));
    });
    for (const name of ['gc', 'runFinalization'])
      jvm.natives.register(owner, name, [], () => jv('int', 0));
    jvm.natives.register(owner, 'compileAll', ['String'], () => jv('int', 0));
    jvm.natives.register(owner, 'log', ['String'], ({ args }) => {
      this.report({ level: 'info', message: String(args[0].value ?? '') });
      return jv('void', undefined);
    });

    const debug = 'java.lang.Debug';
    jvm.natives.register(debug, 'writeFile', ['String', 'String'], ({ args }) => {
      this.report({ level: 'info', message: `[${String(args[1].value ?? 'log')}] ${String(args[0].value ?? '')}` });
      return jv('void', undefined);
    });
    jvm.natives.register(debug, 'giveWarning', ['String'], ({ args }) => {
      this.report({ level: 'info', message: `Warning: ${String(args[0].value ?? '')}` });
      return jv('void', undefined);
    });
    jvm.natives.register(debug, 'errorEX', ['String'], ({ args }) => {
      this.report({ level: 'error', message: String(args[0].value ?? '') });
      return jv('void', undefined);
    });
  }

  private sampleSimulation(): number {
    const now = this.now();
    this.simulationSeconds += Math.max(0, now - this.lastSample) / 1000 * this.warp;
    this.lastSample = now;
    return this.simulationSeconds;
  }

  gameTime(): number { return this.gameTimeSeconds; }
}
