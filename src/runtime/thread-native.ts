import { jv, type JavaValue, type SlrrJvm } from 'slrr-jvm';

interface ThreadState {
  alive: boolean;
  stopped: boolean;
  priority: number;
  daemon: boolean;
  pending?: { resolve: (value: JavaValue) => void; reject: (error: Error) => void };
}

/** Cooperative Java threads share one JVM heap and yield at wait/sleep native calls. */
export class ThreadNative {
  private readonly states = new WeakMap<object, ThreadState>();

  constructor(private readonly jvm: SlrrJvm, private readonly report: (message: string) => void,
    owner = 'java.lang.Thread') {
    const nil = () => jv('void', undefined);
    jvm.natives.register(owner, 'init', ['String'], ({ receiver }) => { this.state(receiver); return nil(); });
    jvm.natives.register(owner, 'start', [], ({ receiver }) => {
      const state = this.state(receiver);
      if (state.alive || state.stopped) return nil();
      state.alive = true;
      queueMicrotask(() => {
        const target = this.jvm.get(receiver, 'target');
        void this.jvm.invokeAsync(target, 'run').catch(error => {
          if (!state.stopped) this.report(`Thread.run: ${error instanceof Error ? error.message : String(error)}`);
        }).finally(() => { state.alive = false; state.pending = undefined; });
      });
      return nil();
    });
    jvm.natives.register(owner, 'stop', [], ({ receiver }) => {
      const state = this.state(receiver);
      state.stopped = true;
      state.pending?.reject(new Error('Java thread stopped'));
      state.pending = undefined;
      return nil();
    });
    jvm.natives.register(owner, 'isAlive', [], ({ receiver }) => jv('int', Number(this.state(receiver).alive)));
    jvm.natives.register(owner, 'getPriority', [], ({ receiver }) => jv('int', this.state(receiver).priority));
    jvm.natives.register(owner, 'setPriority', ['int'], ({ receiver, args }) => {
      this.state(receiver).priority = Number(args[0].value);
      return nil();
    });
    jvm.natives.register(owner, 'setDaemon', ['int'], ({ receiver, args }) => {
      this.state(receiver).daemon = Boolean(args[0].value);
      return nil();
    });
    jvm.natives.registerAsync(owner, 'wait', [], ({ receiver }) => new Promise<JavaValue>((resolve, reject) => {
      const state = this.state(receiver);
      if (state.stopped) { reject(new Error('Java thread stopped')); return; }
      state.pending = { resolve, reject };
    }));
    jvm.natives.register(owner, 'notify', [], ({ receiver }) => {
      const state = this.state(receiver);
      state.pending?.resolve(nil());
      state.pending = undefined;
      return nil();
    });
    jvm.natives.registerAsync(owner, 'sleep', ['float'], ({ args }) => new Promise<JavaValue>(resolve => {
      setTimeout(() => resolve(nil()), Math.max(0, Number(args[0].value)));
    }));
  }

  private state(receiver: JavaValue): ThreadState {
    const object = receiver.value;
    if (!object || typeof object !== 'object') throw new Error('Java Thread receiver unavailable');
    let state = this.states.get(object);
    if (!state) {
      state = { alive: false, stopped: false, priority: 0, daemon: false };
      this.states.set(object, state);
    }
    return state;
  }
}
